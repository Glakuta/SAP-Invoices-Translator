# Refactoring TODO — SAP Invoices Translator

**Date:** 2026-10-11
**Basis:** Full codebase review against conspect requirements 3.1–3.9.
**Verified build state:** `npx tsc --noEmit` fails with **9 errors** (see Phase 0). The claim in `CHANGES.md` that the project compiles cleanly is outdated.

**Stack identified:** SAP CAP (Node.js + TypeScript), SAP B1 Service Layer REST (+ partial S/4HANA OData path), nodemailer (SMTP), Puppeteer + Handlebars (local PDF), i18next, CDS SQLite (dev), Jest.

**Legend:** `P0` = blocking/critical · `P1` = required for spec compliance · `P2` = quality/maintainability

---

## Phase 0 — Stop the bleeding (P0)

- [ ] **0.1 Fix or delete `srv/pdf/baseSapPdfGenerator.ts`** — dead, broken duplicate of `SapS4PdfGenerator.ts` with 6 compile errors (`requestOutputGeneration` missing, `PdfMetadata`/`S4OutputResponse`/`buffer` undefined, `getAuthHeaders` missing). Not imported anywhere except implicitly broken. *Recommendation: delete; extract shared base properly only if S/4 is kept.*
- [ ] **0.2 Fix `srv/pdf/SapB1PdfGenerator.ts`** — references `this.client` (lines 100, 140, 186) which is never defined; only `authProvider` exists. Wire a real axios instance (own or from auth provider) and expose `getAuthHeaders()` consistently.
- [ ] **0.3 Untrack `.env` from git** — it is committed and modified (`git status`: `M .env`) with SAP/SMTP credential keys. Add `.env` to `.gitignore`, commit `.env.example` with placeholders only, rotate any real credentials ever used.
- [ ] **0.4 Remove `coverage/` from git** — test coverage artifacts are committed; add `coverage/` to `.gitignore`.
- [ ] **0.5 Remove silent Ethereal fallback in `srv/sendEmail.ts:36-41`** — when SMTP config is incomplete the app silently "sends" via a fake `smtp.ethereal.email` account with `test/test` credentials. Must fail fast with a clear config error (3.9: mail server access errors must be visible in the register).
- [ ] **0.6 Fix or delete `srv/server.ts`** — 7-line broken stub (`const { InvoiceService } = cds.services;}` syntax garbage, `dotenv.config()` after bootstrap). CAP boots without it; delete or replace with a proper `cds.on('bootstrap')` hook if needed.
- [ ] **0.7 Resolve duplicate/conflicting service implementations** — `srv/service.ts` (class `InvoicesService`) and `srv/invoiceHandler.ts` (`module.exports = cds.service.impl`) both register handlers for `processInvoice`, `retryInvoice`, `resetInvoice`, `sendInvoiceEmail`. `invoiceHandler.ts` is excluded from `tsconfig.json` but still present and half-JS style. *Pick one (recommend `service.ts`), delete `invoiceHandler.ts`, drop the tsconfig exclusion hack.*

---

## Phase 1 — Service contract & wiring (P0)

- [ ] **1.1 Align `srv/service.cds` with reality** — CDS declares only `validateInvoice`, `processInvoice`, `retryInvoice`, `resetInvoice` (params `invoiceDocEntry`/`invoiceDocNum`), but `service.ts` registers handlers for undeclared actions: `sendInvoiceEmail`, `translateInvoice`, `generatePDF`, `fetchAndGeneratePDF`, `getDispatchLog`, `getDispatchLogsByStatus`. Undeclared handlers never fire. Declare all kept actions in CDS or remove the handlers.
- [ ] **1.2 Unify parameter names** — handlers read `req.data.docEntry`/`req.data.invoiceData` while CDS passes `invoiceDocEntry`/`invoiceDocNum`. Even declared actions are broken as wired.
- [ ] **1.3 Fix schema mismatch in event handler** — `invoiceHandler.ts:18-24` INSERTs into `Invoice` with `pdfUrl`, `status`, `processedAt` fields that do **not exist** in `db/schema.cds`. Either extend the entity or (better) stop denormalizing into `Invoice` — `DispatchLog` is the register.
- [ ] **1.4 Secure the actions** — `processInvoice`, `retryInvoice`, `resetInvoice`, `sendInvoiceEmail` are unauthenticated/unrestricted CAP actions callable by anyone with service access. Add `@requires` restricted role(s) (admin-only for reset/re-send per 3.7).
- [ ] **1.5 Fix `handleError` type lie** — `srv/handleError.ts:55-61` passes `invoiceData` into `dispatchLogService.logEntry()` via `as DispatchLogEntry` cast; the field is silently dropped. Decide what belongs in the register and type it honestly.
- [ ] **1.6 Decide how invoices enter the pipeline** — only triggers are manual CAP actions and a phantom `sap.s4.invoice.created` event (no mesh subscription, no DI API hook, no scheduler). Define the real trigger mechanism (see Open Questions) and implement it; delete dead paths.

---

## Phase 2 — Requirement 3.1: Invoice selection (foreign BPs only)

**Current status: ⚠️ partial** — `srv/validationService.ts` correctly computes `PL → KSEF / else → TRANSLATED_PDF` and language, but **nothing in the processing pipeline calls it**. `processInvoiceService.processInvoice()` will happily generate PDF + send email for a Polish partner.

- [ ] **2.1 Wire validation into the pipeline** — call `invoiceValidationService.validate()` as the first step of `processInvoiceService.processInvoice()`; if `destination === 'KSEF'` (country = PL), stop, log `SKIPPED_KSEF` in `DispatchLog`, do not generate PDF, do not send.
- [ ] **2.2 Add `SKIPPED` (and optionally `KSEF`) to `processStatus` enum** in `db/schema.cds` — currently NEW/PROCESSING/ERROR/PDF_GENERATED/SENT has no terminal state for intentionally skipped Polish invoices.
- [ ] **2.3 Single source of truth for country** — precedence today is scattered: `validationService.extractCountry()` (billToCountry → contractor.country → shipToCountry), `processInvoiceService` log uses contractor → billTo → shipTo. Consolidate into one helper and document the rule.
- [ ] **2.4 Handle missing country as ERROR in register** — validation flags it, but pipeline never runs validation (see 2.1); after wiring, missing country must land in `DispatchLog` with a clear message.
- [ ] **2.5 Safer criterion recommendation** — BP master `Country` (ShipTo default) is the preferred recognition criterion; also consider `ShipToCountry` per document when drop-ship differs. Confirm with business whether mixed cases (PL company, foreign ship-to) should go to KSeF or PDF. Document the decision.

---

## Phase 3 — Requirement 3.2: PDF generation (SAP print layout, no user session)

**Current status: ⚠️ partial** — three generators exist; none demonstrably uses the *BP-assigned* SAP layout, and the B1 one is compile-broken.

- [ ] **3.1 Verify B1 reporting mechanism** — `SapB1PdfGenerator` calls `POST /b1s/v1/Reports` with `ReportPath` + `Params.DocEntry` and polls for `ContentUrl`. **Needs verification:** does this endpoint exist in the target B1 version/patch, or is it a PLD/Crystal Reports agent job? Confirm with SAP team before building on it.
- [ ] **3.2 Implement BP-assigned layout selection** — layout is a static env var `SAP_B1_REPORT_PATH` (`SalesInvoice.rpt`). Requirement: layout per business partner (or other agreed determination). Implement determination (read from BP master / doc printing settings / agreed mapping table) with fallback to default layout; missing layout → `MISSING_LAYOUT` error in register (`InvoiceErrorType.MISSING_LAYOUT` is defined in `handleError.ts` but **never thrown** anywhere).
- [ ] **3.3 Decide fate of `LocalPdfGenerator`** — Puppeteer + `templates/invoiceTemplate.html` renders our own HTML, **not** the SAP print layout; this deviates from 3.2. Keep only as explicit dev/test mode (`PDF_GENERATOR_MODE=local`) with a loud warning, or remove. It also launches a new Chrome instance per invoice (perf).
- [ ] **3.4 Decide fate of S/4HANA path** — `SapS4PdfGenerator` + `mapS4Invoice` reuse B1 field names (`CardCode`, `DocEntry`, `BusinessPartners`…), which are almost certainly wrong for S/4 billing documents. The conspect is B1-only. Either remove the S/4 path entirely (recommended) or fix mapping and get proper requirements.
- [ ] **3.5 Delete duplicate `baseSapPdfGenerator.ts`** (see 0.1) and extract a **real** shared base only after the generator strategy is settled (auth retry, polling, save, path building are copy-pasted 3×).
- [ ] **3.6 Sessionless requirement** — confirm chosen mechanism runs without active SAP GUI/RDP user session (Service Layer is fine; any PLD/DI-API local agent is not). Document the conclusion.

---

## Phase 4 — Requirement 3.3: PDF storage

**Current status: ⚠️ partial** — naming concept is right, details are wrong/duplicated.

- [ ] **4.1 Use invoice date for the year folder** — `buildFilePath()` (in `LocalPdfGenerator`, `SapB1PdfGenerator`, `SapS4PdfGenerator`, `baseSapPdfGenerator` — 4 copies!) uses `new Date().getFullYear()`, i.e. *processing* year. Spec example `YYYY\CardCode\DocNum_DocEntry.pdf` implies **document date** year. Use `invoiceData.docDate`.
- [ ] **4.2 Extract single `PdfStorage`/`pathBuilder` component** — one implementation of `buildFilePath` + `savePdf` + directory creation + error mapping (EACCES/ENOSPC/ENOENT), used by all generators. Error detail for save failures currently only exists in `LocalPdfGenerator.savePdf`, not in the B1/S4 generators.
- [ ] **4.3 Configure output location as network share** — `PDF_OUTPUT_DIR` supports UNC paths in principle; document supported forms, verify write-permission behavior and that "no access to save directory" surfaces as ERROR in `DispatchLog` (3.9).
- [ ] **4.4 Record full PDF path + generation timestamp in register** — done (`pdfFilePath`, `pdfGeneratedAt`), keep; ensure webshop panel consumers can resolve `CardCode`/`DocEntry` from the path (naming already allows it).

---

## Phase 5 — Requirement 3.4: Recipient e-mail

**Current status: ✅ mostly done** — `sapService.mapB1BusinessPartner` reads `data.Email` (BP General tab), pipeline validates presence (`MISSING_EMAIL`) and format (regex `isValidEmail`), errors go through `handleError` → `DispatchLog`.

- [ ] **5.1 Consolidate duplicate email validators** — regex validation exists twice (`processInvoiceService.isValidEmail` and `handleError.validateEmail`, latter unused). Keep one.
- [ ] **5.2 Clarify B1 field** — confirm `Email` maps to the intended BP General-tab E-Mail field via Service Layer (it does for standard SL), and confirm behavior for multiple comma-separated addresses (reject or take first? spec says one address at this stage).
- [ ] **5.3 Tests** — add unit tests for missing/invalid email paths asserting ERROR lands in register.

---

## Phase 6 — Requirement 3.5: E-mail content (DE/EN, configurable)

**Current status: ❌ missing / wrong** — this is the most blatant spec violation.

- [ ] **6.1 Remove hardcoded Polish email** — `processInvoiceService.generateEmailHtml()` returns Polish body ("Szanowni Państwo…") and subject is hardcoded Polish `` `Faktura ${docNum}` `` (line 278). Spec requires DE for Germany, EN for everyone else. Replace entirely.
- [ ] **6.2 Implement language rule per spec** — spec: **Germany → DE; all others → EN.** Current `validationService`/`translationService` treat AT/CH/LI/LU as DE too. Confirm with client (DACH vs Germany-only), then implement one shared `resolveEmailLanguage()` used by both PDF labels and email.
- [ ] **6.3 Make subject/body configurable without code changes** — `EmailTemplate` entity already exists in `db/schema.cds` (language + subject + body) but is **never used**. Implement: load template per resolved language from `EmailTemplate` (seeded via CSV migration), render with Handlebars variables: invoice number, invoice date, partner name, CardCode, gross amount, currency. Fallback to locale files only if row missing (and log a warning).
- [ ] **6.4 Obtain final EN/DE copy from client** — placeholder templates must be clearly marked; do not ship Polish-only copy.
- [ ] **6.5 Align PDF label locales with email language** — `srv/locales/{en,de,pl}.json` feed the local PDF generator via i18next; `pl` is unused for emails and unneeded if PDF is SAP layout. Keep only what's needed after 3.3 decision.

---

## Phase 7 — Requirement 3.6: E-mail sending

**Current status: ⚠️ partial** — nodemailer SMTP works in principle; config and robustness gaps.

- [ ] **7.1 Confirm channel** — currently SMTP via nodemailer. Confirm with client that SMTP (not SAP mail / Exchange Graph) is the agreed mechanism; document the decision.
- [ ] **7.2 Client-maintainable mail config** — SMTP settings live only in env vars. For "maintainable by the client", document a runbook, or expose via BTP destination / CDS config (`cds.xsjson` / mta properties) that ops can change without code deploy.
- [ ] **7.3 Remove fallback sender `noreply@example.com`** (`sendEmail.ts:78`) — missing `SMTP_FROM` must be a startup config error, not a silent bogus sender.
- [ ] **7.4 Store `messageId` in `DispatchLog`** — nodemailer returns it; register currently doesn't capture it. Add column + write on success.
- [ ] **7.5 Retry/backoff for transient SMTP failures** — distinguish permanent (5xx recipient rejected) vs transient (timeout) and retry only the latter; count attempts in `numberOfAttempts`.
- [ ] **7.6 Attachment filename language** — `Faktura_${docNum}.pdf` is Polish; use language-resolved prefix or neutral `Invoice_`/`Rechnung_`.

---

## Phase 8 — Requirement 3.7: Duplicate-send protection

**Current status: ⚠️ partial and fragile**

- [ ] **8.1 Replace in-memory `processedInvoices` Set** (`processInvoiceService.ts:23`) — lost on restart, useless across instances, and it *lies* to the caller: on "already processed" it returns `success: true` and the event handler then INSERTs invalid rows (see 1.3). Remove it; the register is the idempotency store.
- [ ] **8.2 DB-level uniqueness** — add unique index/constraint on `DispatchLog.docEntry` (currently plain `cuid` entity, no key on docEntry). This is the real duplicate guard for concurrent workers.
- [ ] **8.3 Check-and-set under concurrency** — before processing, atomically claim the row (`UPDATE … SET status='PROCESSING' WHERE docEntry=? AND status IN ('NEW','ERROR','PDF_GENERATED')`); if 0 rows affected, someone else has it → skip. Same guard before send: only from `PDF_GENERATED` → `SENT`.
- [ ] **8.4 Keep the multi-layer status check but make it consistent** — today: in-memory Set + `DispatchLog.status_code` + SAP UDF `U_InvoiceStatus` (second full SAP round-trip at `processInvoiceService.ts:130`, wasteful). Decide single source of truth (recommend DispatchLog; SAP UDF optional mirror) — see 8.6.
- [ ] **8.5 Admin resend = deliberate reset only** — `resetInvoice` exists; add audit trail: who triggered reset, when, previous status (append to register or separate audit field). Also fix: `dispatchLogService.updateEntry` **cannot clear** `errorMessage` (`if (updates.errorMessage)` skips empty string/undefined — reset leaves stale errors).
- [ ] **8.6 Verify SAP UDFs exist** — `sapService.updateInvoiceStatus/resetInvoice` write `U_InvoiceStatus`, `U_PDFUrl`, `U_ProcessedDate`. **Needs verification** that these user-defined fields exist on OINV in the target system; if not, every processing run fails at the SAP-update step. Document as required B1 precondition or remove the writes.

---

## Phase 9 — Requirement 3.8: Log / send register

**Current status: ⚠️ partial** — `DispatchLog` covers most preferred fields, but the read/update semantics are buggy.

- [ ] **9.1 Fix row-per-attempt vs row-per-invoice confusion** — `logEntry` INSERTs a new `cuid` row on every processing run; `getEntry` does `SELECT.one WHERE docEntry` (arbitrary row); `updateEntry` UPDATEs **all** rows for that docEntry. Choose: (a) one row per invoice + `numberOfAttempts` + attempt history table, or (b) rows per attempt + `getLatestByDocEntry`. Implement consistently.
- [ ] **9.2 Complete `updateEntry` whitelist** — currently cannot update `contractorCountry`, `cardCode`, `cardName`, `docNum`, `invoiceNumber`, `sentAt` is fine but the omission means register rows stay half-empty after BP fetch (code calls `updateEntry` with those fields — they're silently dropped).
- [ ] **9.3 Extend schema** — add `correlationId` (trace pipeline logs ↔ register row), `messageId`, `layoutName`; widen `errorMessage` (CDS `String` may truncate long axios errors — use `LargeString` or store summary + full text in `pdfMetadata`-like field).
- [ ] **9.4 Ensure all 3.9 error cases land in the register with type prefix** — `[TYPE] message` format from `handleError` is good; audit each producer actually calls `handleError` (PDF save errors from B1/S4 generators currently just `throw` and get wrapped as generic `UNKNOWN` in `processInvoice` catch — map `SapPdfError.code` → `InvoiceErrorType`).
- [ ] **9.5 Operator visibility** — expose `DispatchLogs` via a read-only Fiori Elements list page or at least documented API (`getDispatchLog`/`getDispatchLogsByStatus` actions, after 1.1 wiring) so support can answer "was invoice X sent?".
- [ ] **9.6 Do not modify standard SAP tables** — currently only UDF patches on OINV (OK practice); keep it that way; note in README.

---

## Phase 10 — Requirement 3.9: Error handling (full coverage)

**Current status: ⚠️ partial** — taxonomy exists (`InvoiceErrorType`, `SapPdfError` hierarchy, classified SMTP errors) but is inconsistent and incomplete.

- [ ] **10.1 Unify error layers** — three parallel systems: `InvoiceErrorType` enum, `SapPdfError` subclasses, ad-hoc strings in `sendEmail`. Map SAP PDF errors to register types (`AUTH_FAILED → SAP_ERROR`, `REPORT_FAILED/OUTPUT_DETERMINATION_FAILED → MISSING_LAYOUT or PDF_GENERATION_FAILED`, `POLLING_TIMEOUT → PDF_GENERATION_FAILED`, `CONNECTION_FAILED → SAP_ERROR`).
- [ ] **10.2 Throw `MISSING_LAYOUT`** — enum member exists, never used (see 3.2).
- [ ] **10.3 Cover all 9 spec cases explicitly** (check each is typed + in register): missing email ✅ · invalid email ✅ · missing layout ❌ · PDF generation error ⚠️ (generic UNKNOWN) · PDF save error ⚠️ (local only) · email send error ✅ · reprocess already-sent ✅ (but see 8.x) · no access to save dir ⚠️ (local only) · no access to mail server ⚠️ (message mapped, but 0.5 fallback may hide it).
- [ ] **10.4 Stop swallowing errors in `dispatchLogService`** — `logEntry`/`updateEntry` catch and only log; if the register write fails, processing continues blind. At minimum escalate loudly / fail the run for ERROR-status writes.
- [ ] **10.5 Fix error-return inconsistency** — `processInvoiceService.processInvoice` sometimes `return handleError(...)` (result object) and sometimes `throw`; callers (`service.ts`) treat both as failure but event handler `invoiceHandler` rethrows → CAP 500. Standardize: internal functions throw typed errors; single boundary converts to result + register write.

---

## Phase 11 — Architecture & maintainability (P2, high value)

- [ ] **11.1 One SAP Service Layer client** — auth logic exists 3×: `SAPService.getAuthToken` (`sapService.ts`), `SapB1AuthProvider` (`srv/auth/`), plus per-generator token handling. Extract shared session-caching client with 401-retry; inject everywhere.
- [ ] **11.2 Consistent env naming** — `SAP_BASE_URL`/`SAP_USERNAME`/`SAP_PASSWORD` (sapService) vs `SAP_B1_BASE_URL`/`SAP_B1_USERNAME`/`SAP_B1_PASSWORD` (PDF/auth) vs `SAP_S4_*`. Two login paths can point at different systems silently. Unify + validate required vars at startup (fail fast with list of missing keys).
- [ ] **11.3 Delete dead/duplicate code** — `retryInvoiceService.ts` and `resetInvoiceService.ts` duplicate logic inline in `service.ts`/`invoiceHandler.ts` (pick classes, delete inline copies); unused `Email` entity; unused `validateEmail` in `handleError.ts`; `translateInvoice` empty stub in `service.ts:79-81`; `EmailSendResult` unused import in `processInvoiceService.ts`; `baseSapPdfGenerator.ts`.
- [ ] **11.4 Deduplicate mapping** — `mapB1Invoice`/`mapS4Invoice` and `mapSAPToInvoiceData` are near-identical field-copy chains; collapse into one mapper per source or generics.
- [ ] **11.5 Move `types.ts`** into `srv/` (or `src/shared/`) — root-level types with rootDir `.` is messy; also `InvoiceData` is duplicated between `types.ts` and `sapService.ts` imports.
- [ ] **11.6 Decouple long-running work from request path** — `processInvoice` action does SAP fetch ×2 (lines 84 and 130 — remove the duplicate fetch), BP fetch, PDF poll (up to ~60 s), file save, email send — all inside one CAP action call. Move to CAP outbox / background job so HTTP actions return fast and retries are transactional.
- [ ] **11.7 Structured logging only** — replace `console.log/console.error` (in `service.ts`, `invoiceHandler.ts`, `dispatchLogService.ts`) with `cds.log` categories; always include `correlationId` + `docEntry`.
- [ ] **11.8 Layer the service** — `srv/` is flat with mixed responsibilities. Target structure e.g. `srv/api/` (CAP handlers), `srv/application/` (pipeline), `srv/infrastructure/` (sap, smtp, pdf, register).
- [ ] **11.9 Replace boilerplate `readme.md`** — document: architecture, env vars, B1 prerequisites (UDFs, layout, Reports API), flow diagram, register semantics, admin operations (retry/reset), local dev (`cds watch`, `PDF_GENERATOR_MODE=local`).
- [ ] **11.10 Review dependency versions** — verify claimed versions in `package.json` actually exist and are compatible: `i18next@^26`, `uuid@^14`, `typescript@^6`, `@types/puppeteer` (deprecated; puppeteer ships own types), `axios` in devDependencies but used in `srv/` runtime code (**must be a production dependency** — build works only by accident via hoisting).

---

## Phase 12 — Tests & quality gates (P1)

- [ ] **12.1 Make `npx tsc --noEmit` pass** — gate for every other task (currently 9 errors, see Phase 0).
- [ ] **12.2 Pipeline tests** — mock `SAPService` + `PdfGeneratorFactory` + `sendEmail`; cover: happy path, PL skip (2.1), missing email, invalid email, already-SENT block, PDF failure → register ERROR, email failure → retryable status.
- [ ] **12.3 Register tests** — `dispatchLogService` insert/update semantics after 9.1/9.2 fixes (unique docEntry, correct whitelist, error clearing on reset).
- [ ] **12.4 Email content tests** — language resolution (DE vs EN per final rule), template loading from `EmailTemplate`, variable interpolation.
- [ ] **12.5 Integration smoke test** — `@cap-js/sqlite` + `cds.test` exercising action → register row lifecycle without real SAP/SMTP (wire test doubles via factory injection — currently `createSAPService()` reads env directly, hard to mock; inject via CAP DI).
- [ ] **12.6 Add ESLint + Prettier** — none configured; align with CAP TS guidelines.
- [ ] **12.7 CI pipeline** — tsc, lint, jest (no coverage artifacts in git).

---

## Phase 13 — Deployment & operations (P1/P2)

- [ ] **13.1 Add deployment descriptor** — no `mta.yaml`/Dockerfile exists. Decide target (BTP Kyma/CF vs on-prem Node service) and add descriptor with service bindings.
- [ ] **13.2 Secrets management** — move SAP/SMTP credentials to BTP destination / credential store / K8s secrets; app reads destination config, not repo `.env`.
- [ ] **13.3 Connectivity** — document network prerequisites: Service Layer port (50000/443), SMTP egress, network share mount; if on BTP: Cloud Connector + Destination setup.
- [ ] **13.4 Startup probes** — reuse `testEmailConnection()` and `testConnection()` on boot (or admin action); surface misconfig immediately instead of at first invoice.
- [ ] **13.5 Batch/replay job** — scheduled sweep of `DispatchLog` rows in ERROR with attempt < max → auto-retry; and a backfill action to process a DocNum range (missing today; `processMultipleInvoices` exists but is uncalled/untested).

---

## Top 10 by impact/effort (start here)

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 1 | 0.1–0.2 Fix compile errors (B1 PDF generator, delete dead base) | Build works again | S |
| 2 | 0.3 Untrack `.env`, rotate secrets | Security | S |
| 3 | 0.5 + 7.3 Remove SMTP/Ethereal silent fallbacks | Prevents silent data loss | S |
| 4 | 6.1–6.3 Replace hardcoded PL email with configurable DE/EN templates | Core spec violation (3.5) | M |
| 5 | 2.1–2.2 Enforce PL→KSeF skip in pipeline + SKIPPED status | Core spec (3.1) | S |
| 6 | 1.1–1.2 Fix CDS service definition vs handlers | Features actually reachable | M |
| 7 | 8.1–8.3 DB-backed duplicate guard (unique docEntry + claim) | Correctness, multi-instance (3.7) | M |
| 8 | 0.7 + 11.3 Remove duplicate services/dead code | Maintainability, removes conflicts | M |
| 9 | 3.1–3.2 Verify B1 Reports API + BP layout determination | 3.2 feasibility risk | L (needs SAP team) |
| 10 | 9.1–9.2 Fix register row semantics + update whitelist | 3.8 trustworthiness | M |

---

## Open questions (business / SAP team)

1. **Trigger mechanism:** How should the app learn about new invoices — B1 Service Layer event, DI API add-on, polling a DocNum/date range, manual only? (No working trigger exists today.)
2. **PDF mechanism feasibility:** Is `POST /b1s/v1/Reports` (async report job → ContentUrl) available in the target B1 version, or must we use PLD / Crystal Reports via a Windows agent (which would violate the "no active session" requirement and change the architecture)?
3. **Layout determination:** Which layout should be used per BP — B1 document printing settings, a mapping table, or one global layout for all foreign invoices?
4. **Language rule:** Germany only → DE, or DACH (DE/AT/CH) → DE? Current code does DACH.
5. **Final email copy:** Client to provide DE and EN subject + body text (with allowed placeholders).
6. **S/4HANA:** Keep the S/4 code path (needs real requirements + correct OData mapping) or delete it and focus on B1?
7. **KSef:** For PL invoices, is skipping here sufficient, or must the app hand off to a KSef integration (status/callback)?
8. **SAP UDFs:** Do `U_InvoiceStatus`, `U_PDFUrl`, `U_ProcessedDate` exist on sales invoices in the target system? If not — remove writes or add them as a precondition.
9. **SMTP details:** Host/port/TLS/sender address, shared mailbox vs service account, rate limits, and who maintains changes.
10. **PDF storage target:** Local path vs UNC network share vs object storage (future webshop panel suggests share/BTP approuter — decide now to fix path handling once).
11. **Credit memos / other doc types:** Only A/R invoices, or also credit notes/down payments? (Affects 3.1 filtering and layout.)
12. **Deployment target:** On-prem server, BTP Cloud Foundry, or Kyma? Determines secrets, connectivity, and Puppeteer feasibility (Chrome in container).

---

## Requirement scorecard (as-is)

| Req. | Topic | Status | Evidence |
|------|-------|--------|----------|
| 3.1 | Foreign invoice selection | ⚠️ partial | Logic in `srv/validationService.ts:70-73` but **not called** from `srv/processInvoiceService.ts` pipeline |
| 3.2 | PDF from SAP layout, headless | ⚠️ partial | `srv/pdf/SapB1PdfGenerator.ts` (broken `this.client`), `LocalPdfGenerator` deviates (own HTML), static layout only |
| 3.3 | PDF storage `YYYY\CardCode\DocNum_DocEntry.pdf` | ⚠️ partial | `buildFilePath()` in 4 files; uses processing year, not doc date; save-error handling only in local generator |
| 3.4 | Email from BP master | ✅ done | `srv/sapService.ts:355` (`Email`), validated `srv/processInvoiceService.ts:153-171` |
| 3.5 | DE/EN configurable content | ❌ missing | Hardcoded PL subject/body `srv/processInvoiceService.ts:278,379-391`; `EmailTemplate` entity unused |
| 3.6 | Send with attachment | ⚠️ partial | `srv/sendEmail.ts` (nodemailer); ethereal fallback, no messageId in register, config not client-operable |
| 3.7 | Duplicate protection | ⚠️ partial | In-memory Set `processInvoiceService.ts:23` + status checks; no DB unique constraint; race-prone |
| 3.8 | Register/log | ⚠️ partial | `db/schema.cds:33-50` + `srv/dispatchLogService.ts`; row semantics broken (multi-row per docEntry), update whitelist incomplete |
| 3.9 | Error handling | ⚠️ partial | `srv/handleError.ts` taxonomy good; MISSING_LAYOUT never thrown; SAP PDF errors collapse to UNKNOWN; register writes can silently fail |
