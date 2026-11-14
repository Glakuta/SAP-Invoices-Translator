# TODO — Project Audit (2026-11-13)

Audit of `SAP-Invoices-Translator` against the current codebase. Every item below was verified against the code on this date. Supersedes the deleted `REFACTOR_TODO.md`.

**Verified state:**

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | FAILS — 3 errors in `srv/pdf/SapB1PdfGenerator.ts` |
| `npm test` | PASS — 12/12, but only `validationService.ts` is covered |
| `npm start` (`cds-serve`) | Boots, but most declared actions are broken when called (see 2.x) |
| Git hygiene | `.env` and `coverage/` are **tracked and committed** despite being in `.gitignore` |

**Legend:** `P0` = blocking/critical · `P1` = required for spec compliance · `P2` = quality/maintainability

---

## 1. P0 — Build, security, dead code

- [ ] **1.1 Fix `srv/pdf/SapB1PdfGenerator.ts` (3 compile errors)** — `this.client` used at lines 100, 140, 186 but never defined; only `this.authProvider` exists. Either expose the axios instance from `SapB1AuthProvider` or create one in the constructor. Blocks any production build.
- [ ] **1.2 Untrack and rotate `.env`** — file with non-empty SAP/SMTP credentials is committed (`git ls-files` shows `.env`). `.gitignore` does not untrack already-committed files. Do: `git rm --cached .env`, commit, add `.env.example` with placeholders, and **rotate every credential in it** (they are in git history).
- [ ] **1.3 Untrack `coverage/`** — test artifacts (`coverage/clover.xml`, `lcov-report/…`) are committed. Do: `git rm -r --cached coverage`.
- [ ] **1.4 Commit or restore the `REFACTOR_TODO.md` deletion** — working tree has an unstaged deletion (`D REFACTOR_TODO.md`). Decide: commit the deletion (this file replaces it) or restore it.
- [ ] **1.5 Delete `srv/invoiceHandler.ts`** — excluded from `tsconfig.json`, half-JS style (`module.exports = cds.service.impl`), duplicates handlers registered by `srv/service.ts`, and INSERTs into `DispatchLog` fields that don't exist (`pdfPath`, `status: "PDF_OK"`). Keeping both guarantees future confusion.
- [ ] **1.6 Delete `srv/pdf/baseSapPdfGenerator.ts`** — now compiles but is a dead copy-paste of `SapS4PdfGenerator`, imported nowhere.
- [ ] **1.7 Remove the Ethereal fallback in `srv/sendEmail.ts:34-42`** — when SMTP config is incomplete the app silently "sends" via a fake `smtp.ethereal.email` account with `test/test` credentials. Must fail fast with a clear config error, otherwise mail failures are invisible in the register.
- [ ] **1.8 Remove fallback sender `noreply@example.com` (`sendEmail.ts:78`)** — missing `SMTP_FROM` should be a startup config error, not a silent bogus sender.
- [ ] **1.9 Move `axios` to production dependencies** — it is in `devDependencies` but imported by runtime code (`sapService.ts`, all PDF generators). Works only by accident via hoisting.

## 2. P1 — Broken wiring (features declared but not reachable)

- [ ] **2.1 Fix parameter-name mismatch (`service.cds` vs `service.ts`)** — CDS declares actions with `invoiceDocEntry` / `invoiceDocNum`, but handlers read `req.data.docEntry` / `req.data.docNum` (`service.ts:84,139,169,211,245`). Every declared action currently receives `undefined`. Unify the names on both sides.
- [ ] **2.2 Fix handler/CDS action-name mismatch** — `service.ts:27` registers `getDispatchLog`, but CDS declares `getDispatchLogs` (plural). The registered handler never fires.
- [ ] **2.3 Implement or remove `translateInvoice`** — handler at `service.ts:79-81` is an empty stub that returns nothing.
- [ ] **2.4 Wire validation into the pipeline** — `validationService.ts` computes `PL → KSEF` / else → `TRANSLATED_PDF` and language, but `processInvoiceService.processInvoice()` never calls it. Polish invoices are currently processed like any other. Call validation as step 1; if destination is `KSEF`, stop and log a `SKIPPED` status.
- [ ] **2.5 Add `SKIPPED` to `processStatus` enum (`db/schema.cds`)** — no terminal state exists for intentionally skipped KSeF invoices (required by 2.4).
- [ ] **2.6 Seed the code lists** — no CSV data exists for `DeliveryMethod`, `InvoiceCurrency`, `invoiceStatus`, `processStatus`, `Languages`. Associations to them resolve to NULL until seeded (`db/data/`).
- [ ] **2.7 Restrict the actions (`@requires`)** — `processInvoice`, `retryInvoice`, `resetInvoice`, `sendInvoiceEmail` are unauthenticated. Reset/re-send must be admin-only.
- [ ] **2.8 Remove the double SAP fetch in `processInvoice`** — invoice is fetched at `processInvoiceService.ts:84` and again at line 130. One fetch, reuse the result.

## 3. P1 — Dispatch register (`DispatchLog`) correctness

- [ ] **3.1 Add uniqueness on `DispatchLog.docEntry`** — entity has only `cuid`; nothing prevents multiple rows per invoice. This is the real duplicate-send guard (replace the in-memory `Set`, see 4.1).
- [ ] **3.2 Fix row-per-attempt vs row-per-invoice semantics** — `logEntry` INSERTs a new row on every run, `getEntry` does `SELECT.one WHERE docEntry` (arbitrary row), `updateEntry` UPDATEs *all* rows for the docEntry. Pick one model (recommend: one row per invoice + `numberOfAttempts`) and implement consistently.
- [ ] **3.3 Complete the `updateEntry` whitelist (`dispatchLogService.ts:58-66`)** — cannot update `contractorCountry`, `cardCode`, `cardName`, `docNum`, `invoiceNumber`; BP-fetch updates are silently dropped and register rows stay half-empty.
- [ ] **3.4 Allow clearing `errorMessage`** — `if (updates.errorMessage)` skips empty strings/`undefined`, so `resetInvoice` leaves stale error text in the register.
- [ ] **3.5 Stop swallowing register-write failures** — `logEntry`/`updateEntry` catch errors and only `console.error`; if the register write fails, processing continues blind. Escalate / fail the run.
- [ ] **3.6 Store `messageId` on successful send** — nodemailer returns it; the register doesn't capture it.
- [ ] **3.7 Extend the schema** — add `correlationId` (trace logs ↔ register), `messageId` (3.6); use `LargeString` for `errorMessage` (axios errors can exceed `String` length).

## 4. P1 — Processing pipeline correctness

- [ ] **4.1 Remove the in-memory `processedInvoices` Set (`processInvoiceService.ts:23`)** — lost on restart, useless across instances, and on "already processed" it returns `success: true` with stale data. The register (after 3.1/3.2) is the idempotency store.
- [ ] **4.2 Replace the hardcoded Polish e-mail** — subject `` `Faktura ${docNum}` `` and `generateEmailHtml()` (`processInvoiceService.ts:278, 379-391`) are Polish-only. Spec: DE for Germany, EN for everyone else. Use the existing (currently unused) `EmailTemplate` entity, rendered with Handlebars variables.
- [ ] **4.3 Resolve e-mail language in one place** — `validationService` (DACH set incl. AT/CH/LI/LU) and `translationService` (DACH incl. AT/CH/LI) disagree slightly; pick one rule (Germany-only vs DACH — confirm with business) and one shared helper.
- [ ] **4.4 Fix B1 session expiry (`sapService.ts:35`)** — hardcoded 24 h for a B1 Service Layer session that typically times out much sooner; also no 401 auto-retry in `getHeaders` (it throws "session expired" instead of re-authenticating). Implement re-login on 401 and honor the real session timeout.
- [ ] **4.5 Add B1 logout** — `sapService` never calls `/b1s/v1/Logout`; sessions accumulate on the Service Layer.
- [ ] **4.6 Verify the SAP UDF precondition** — `updateInvoiceStatus`/`resetInvoice` write `U_InvoiceStatus`, `U_PDFUrl`, `U_ProcessedDate`. If these UDFs don't exist on OINV in the target system, every run fails at the status update. Verify or remove.
- [ ] **4.7 Verify the B1 Reports API** — `SapB1PdfGenerator` relies on `POST /b1s/v1/Reports` (async job → `ContentUrl`). Confirm this endpoint exists in the target B1 version before relying on it.
- [ ] **4.8 Use invoice document year for the storage path** — all `buildFilePath()` copies use `new Date().getFullYear()` (processing year) instead of `invoiceData.docDate`. Also deduplicate: 4 copies exist (`LocalPdfGenerator`, `SapB1PdfGenerator`, `SapS4PdfGenerator`, `baseSapPdfGenerator`).
- [ ] **4.9 Map `SapPdfError.code` to register error types** — SAP PDF failures currently collapse into a generic `[UNKNOWN]` in the register (`processInvoiceService.ts:198`). The typed hierarchy in `PdfGenerator.ts` (AUTH_FAILED, POLLING_TIMEOUT, …) is never translated into `InvoiceErrorType`. Also: `MISSING_LAYOUT` is defined in the enum but thrown nowhere.
- [ ] **4.10 Standardize error return style** — `processInvoice` sometimes returns `handleError(...)` results, sometimes throws; callers in `service.ts` assume result objects. One boundary converts typed errors → register write + HTTP error.
- [ ] **4.11 Use document-date year folder and confirm BP-layout determination** — layout is currently the static env var `SAP_B1_REPORT_PATH`; spec calls for per-business-partner layout (or an agreed mapping). Implement determination + fallback, or document why a single global layout is acceptable.

## 5. P2 — Architecture & maintainability

- [ ] **5.1 Consolidate SAP auth into one client** — three implementations exist: `SAPService.getAuthToken`, `SrvB1AuthProvider`, and per-generator token handling. Extract one session-caching client with 401-retry and inject it everywhere.
- [ ] **5.2 Unify env var naming** — `SAP_BASE_URL/SAP_USERNAME/SAP_PASSWORD` (sapService) vs `SAP_B1_*` (PDF/auth) vs `SAP_S4_*`. Two login paths can silently point at different systems. Also validate required env vars at startup (fail fast with the list of missing keys).
- [ ] **5.3 Delete duplicate service classes** — `retryInvoiceService.ts` / `resetInvoiceService.ts` duplicate logic that `service.ts` re-implements inline. Keep one implementation per operation.
- [ ] **5.4 Delete dead code** — unused `Email` entity (`db/schema.cds:112`), unused `validateEmail` in `handleError.ts`, unused `EmailSendResult` import in `processInvoiceService.ts`.
- [ ] **5.5 Replace `console.log`/`console.error` with `cds.log`** — in `service.ts`, `dispatchLogService.ts` (and delete `invoiceHandler.ts` per 1.5, which is the biggest offender).
- [ ] **5.6 Move `types.ts` into `srv/`** — root-level types with `rootDir: "."` is messy; `InvoiceData` is also duplicated between `types.ts` and `sapService.ts`.
- [ ] **5.7 Deduplicate mappers** — `mapB1Invoice`/`mapS4Invoice` and `mapB1BusinessPartner`/`mapS4BusinessPartner` are near-identical field copies; collapse into one mapper per source.
- [ ] **5.8 Move long-running work out of the request path** — `processInvoice` does SAP fetch ×2, BP fetch, PDF poll (up to ~60 s), file save, all inside one CAP action. Consider a background job / CAP outbox; at minimum return fast and process asynchronously.
- [ ] **5.9 Layer the service** — `srv/` is flat with mixed responsibilities. Target: `srv/api/` (CAP handlers), `srv/application/` (pipeline), `srv/infrastructure/` (sap, smtp, pdf, register).
- [ ] **5.10 Reuse one Puppeteer browser instance** — `LocalPdfGenerator` launches and closes Chrome per invoice; acceptable for dev mode only.
- [ ] **5.11 Decide the fate of the S/4HANA path** — `SapS4PdfGenerator` + `mapS4Invoice` reuse B1 field names (`CardCode`, `DocumentLines`-style mapping), which is almost certainly wrong for S/4 billing documents. Remove it or fix the mapping with real requirements.
- [ ] **5.12 Review dev dependencies** — `@types/puppeteer` is deprecated (puppeteer ships its own types); remove it.

## 6. Tests & quality gates

- [ ] **6.1 Gate every change on `npx tsc --noEmit`** — currently fails (see 1.1); keep it green from now on.
- [ ] **6.2 Pipeline tests** — mock `SAPService` + PDF generator + `sendEmail`; cover: happy path, PL skip (2.4), missing/invalid e-mail, already-SENT block, PDF failure → register ERROR, e-mail failure → retryable state.
- [ ] **6.3 Register tests** — `dispatchLogService` insert/update semantics after 3.1–3.5 (unique docEntry, full whitelist, error clearing on reset).
- [ ] **6.4 E-mail content tests** — language resolution, template loading from `EmailTemplate`, variable interpolation.
- [ ] **6.5 Integration smoke test** — `@cap-js/sqlite` + `cds.test` exercising an action → register row lifecycle without real SAP/SMTP. Requires making `createSAPService()` injectable (it currently reads env directly in the constructor path).
- [ ] **6.6 Add ESLint + Prettier** — none configured.
- [ ] **6.7 Add CI** — tsc + lint + jest; no coverage artifacts committed (see 1.3).

## 7. Deployment & operations

- [ ] **7.1 Add a deployment descriptor** — no `mta.yaml` / Dockerfile exists. Decide the target (BTP CF/Kyma vs on-prem Node) and add the descriptor with service bindings.
- [ ] **7.2 Move secrets out of `.env`** — BTP destination / credential store / K8s secrets (after 1.2).
- [ ] **7.3 Document connectivity prerequisites** — Service Layer port, SMTP egress, network share for `PDF_OUTPUT_DIR` (UNC support), or Cloud Connector setup if on BTP.
- [ ] **7.4 Startup probes** — run `testEmailConnection()` and a SAP auth check on boot (or as admin actions) so misconfiguration surfaces immediately.
- [ ] **7.5 Batch/replay** — scheduled sweep of `ERROR` rows with `numberOfAttempts < max` → auto-retry; plus a backfill action for a DocNum range (`processMultipleInvoices` exists but is uncalled and untested).
- [ ] **7.6 SMTP retry/backoff** — distinguish permanent (5xx rejection) vs transient (timeout) failures; retry only the latter; count in `numberOfAttempts`.
- [ ] **7.7 Language-neutral attachment filename** — `Faktura_${docNum}.pdf` is Polish; use the resolved language (`Invoice_` / `Rechnung_`).

---

## Suggested order (quick wins first)

| # | Task | Impact | Effort |
|---|------|--------|--------|
| 1 | 1.1 Fix B1 generator compile errors | Build works again | S |
| 2 | 1.2–1.3 Untrack `.env` + `coverage/`, rotate secrets | Security | S |
| 3 | 1.7–1.8 Remove SMTP/Ethereal + bogus-sender fallbacks | Prevents silent data loss | S |
| 4 | 2.1–2.2 Fix action wiring (param names, getDispatchLogs) | Features actually reachable | S |
| 5 | 2.4–2.5 Wire validation + SKIPPED status | Core spec: PL → KSeF | S |
| 6 | 4.2 Replace hardcoded Polish e-mail with templates | Core spec: DE/EN | M |
| 7 | 3.1–3.4 Register uniqueness + semantics | Correct duplicate protection | M |
| 8 | 1.5–1.6 Delete dead/duplicate code | Maintainability | M |
| 9 | 6.2–6.3 Pipeline + register tests | Confidence for all of the above | M |
| 10 | 4.6–4.7 Verify B1 UDFs + Reports API | Feasibility risk (needs SAP team) | L |
