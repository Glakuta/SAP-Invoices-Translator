# SAP Invoices Translator

A SAP CAP (Node.js + TypeScript) service that automates the delivery of sales invoices to foreign business partners. It reads invoice and business-partner data from SAP, generates a PDF, stores it in a structured directory, sends it by e-mail with a language-appropriate cover message, and records every step in a dispatch register.

Invoices issued to Polish contractors are intended to be routed to KSeF instead of being translated and e-mailed; all other invoices get a translated PDF.

> **Status:** work in progress, ready for testing but not for production. See [Project status](#project-status) and [`REFACTOR_TODO.md`](REFACTOR_TODO.md).

## Features

- **Invoice selection** – validation service resolves the destination (`KSEF` for Poland, `TRANSLATED_PDF` otherwise) and the target language.
- **SAP integration** – SAP Business One Service Layer (`b1s/v1`) or S/4HANA OData, with session caching and 401 retry.
- **PDF generation** – pluggable strategies:
  - `local` – Handlebars HTML template rendered to PDF by Puppeteer (development/fallback).
  - `b1sl` – SAP B1 report job (`/b1s/v1/Reports`), polling until the PDF is ready.
  - `s4odata` – S/4HANA output determination job.
- **Translation** – i18next with EN/DE/PL locale files (`srv/locales`); German-speaking countries default to DE, everyone else to EN.
- **Structured storage** – PDFs are saved as `<PDF_OUTPUT_DIR>/<year>/<CardCode>/<DocNum>_<DocEntry>.pdf`.
- **E-mail delivery** – nodemailer/SMTP with the PDF attached, including classified error messages (connection, timeout, authentication, attachment).
- **Dispatch register** – `DispatchLog` records DocEntry, DocNum, invoice number, business partner, country, e-mail, PDF path and timestamps, send time, status, error message and attempt count.
- **Retry / reset** – dedicated actions to re-process failed invoices and reset them to `NEW`.
- **Structured logging** – CAP logger categories (`sapService`, `dispatchLog`, `sendEmail`, `pdf:*`, …).

## Processing flow

1. An invoice is supplied by DocEntry/DocNum or as raw invoice data (manual action or event handler).
2. The invoice and its business partner are fetched from SAP.
3. Validation determines country, language, and destination (`KSEF` / `TRANSLATED_PDF`).
4. A dispatch-log row is created with `PROCESSING` status.
5. The PDF is generated with the configured generator and stored on disk.
6. The log is updated to `PDF_GENERATED`; the SAP invoice status is mirrored in the `U_InvoiceStatus` user-defined field.
7. The PDF is e-mailed to the business partner's address from the SAP BP master record.
8. On success the log becomes `SENT`; on any failure it becomes `ERROR` with a typed error message in the register.

## Project structure

```
.
├── app/                    # UI frontend placeholder
├── db/
│   └── schema.cds          # BusinessPartner, Invoice, InvoiceItem, DispatchLog, EmailTemplate, code lists
├── srv/
│   ├── service.cds         # InvoicesService definition and actions
│   ├── service.ts          # CAP action handlers
│   ├── processInvoiceService.ts  # Main invoice pipeline
│   ├── sapService.ts       # SAP B1 / S/4HANA client
│   ├── validationService.ts# Country/language/destination rules
│   ├── translationService.ts # i18next label translation
│   ├── sendEmail.ts        # SMTP e-mail delivery
│   ├── dispatchLogService.ts # Register access
│   ├── handleError.ts      # Error taxonomy and register updates
│   ├── retryInvoiceService.ts
│   ├── resetInvoiceService.ts
│   ├── invoiceHandler.ts   # Alternative event-handler implementation (not compiled)
│   ├── auth/               # SAP B1 authentication provider
│   ├── pdf/                # PDF generator interface, factory and strategies
│   └── locales/            # en.json, de.json, pl.json
├── templates/
│   └── invoiceTemplate.html# Handlebars template for local PDF mode
├── tests/                  # Jest unit tests
├── types.ts                # Shared TypeScript interfaces
├── CHANGES.md              # Implementation notes for logging/error handling
└── REFACTOR_TODO.md        # Detailed review and remaining work
```

## Data model

Defined in `db/schema.cds`:

| Entity | Purpose |
|--------|---------|
| `BusinessPartner` | Contractor master data (CardCode, name, e-mail, country) |
| `Invoice` | Invoice header with contractor, destination language and status |
| `InvoiceItem` | Invoice lines with quantity, prices, tax and amounts |
| `DispatchLog` | Send register: one row per processing attempt with status and error details |
| `EmailTemplate` | Configurable per-language subject and body (reserved for e-mail templates) |
| `DeliveryMethod`, `InvoiceCurrency`, `invoiceStatus`, `processStatus`, `Languages` | Code lists |

Process statuses: `NEW`, `PROCESSING`, `PDF_GENERATED`, `SENT`, `ERROR`.

## CAP actions

Declared in `srv/service.cds` and handled in `srv/service.ts`:

| Action | Parameters | Purpose |
|--------|------------|---------|
| `validateInvoice` | `invoiceData` | Validate invoice data and resolve language/destination |
| `processInvoice` | `invoiceDocEntry`, `invoiceDocNum` | Generate a PDF for an invoice |
| `retryInvoice` | `invoiceDocEntry`, `invoiceDocNum` | Re-process a failed invoice (blocked when already `SENT`) |
| `resetInvoice` | `invoiceDocEntry`, `invoiceDocNum` | Reset SAP status and register entry to `NEW` |
| `sendInvoiceEmail` | `invoiceDocEntry`, `invoiceDocNum`, `emailTemplateId` | Send the generated PDF by e-mail |
| `translateInvoice` | `invoiceDocEntry`, `invoiceDocNum`, `targetLanguage` | Translation entry point |
| `generatePDF` | `invoiceDocEntry`, `invoiceDocNum` | Generate a PDF (alias flow) |
| `fetchAndGeneratePDF` | `invoiceDocEntry`, `invoiceDocNum` | Fetch from SAP and generate |
| `getDispatchLogs` | `invoiceDocEntry`, `invoiceDocNum` | Read register rows |
| `getDispatchLogsByStatus` | `status` | Query register rows by status |

The service also exposes read-only projections: `Invoice`, `InvoiceItems`, `DispatchLogs`, `EmailTemplates`.

## Configuration

Copy the values into a local `.env` file (ignored by git). Do not commit credentials.

### SAP

```env
SAP_TYPE=B1                 # B1 | S4HANA
SAP_BASE_URL=
SAP_USERNAME=
SAP_PASSWORD=
SAP_CLIENT=
SAP_LANGUAGE=
```

### PDF generation

```env
PDF_GENERATOR_MODE=local    # local | b1sl | s4odata
PDF_OUTPUT_DIR=./output
```

`b1sl` mode:

```env
SAP_B1_BASE_URL=
SAP_B1_USERNAME=
SAP_B1_PASSWORD=
SAP_B1_COMPANY_DB=
SAP_B1_REPORT_PATH=SalesInvoice.rpt
```

`s4odata` mode:

```env
SAP_S4_BASE_URL=
SAP_S4_CLIENT_ID=
SAP_S4_CLIENT_SECRET=
SAP_S4_OUTPUT_TEMPLATE=
```

### SMTP

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

## Getting started

Prerequisites:

- Node.js and npm
- Access to the SAP Service Layer (B1) or OData endpoint (S/4HANA)
- An SMTP account for e-mail delivery
- A Chromium/Chrome installation for Puppeteer when using `PDF_GENERATOR_MODE=local`

Install dependencies:

```bash
npm install
```

Create `.env` with the values above, then start the CAP application in development mode:

```bash
npx cds watch
```

or in normal mode:

```bash
npm start
```

Run the tests:

```bash
npm test
npm run test:coverage
```

## Testing

Tests use Jest with `ts-jest`. The current suite covers invoice validation (`tests/invoiceDataValidation.test.ts`): empty/invalid data, PL → KSeF routing, DE/EN language resolution, missing fields, and line-item validation.

## Project status

The project is under active refactoring. Known gaps are tracked in `REFACTOR_TODO.md`; the most relevant ones are:

- `srv/pdf/SapB1PdfGenerator.ts` references an undefined `this.client` and does not compile.
- `srv/pdf/baseSapPdfGenerator.ts` is a dead duplicate with compile errors.
- Validation logic (`validationService.ts`) is not yet wired into the main processing pipeline, so Polish invoices are not skipped automatically.
- The e-mail subject/body in `processInvoiceService.ts` is hardcoded Polish; the `EmailTemplate` entity is not used yet.
- Duplicate-send protection relies partly on an in-memory `Set`, which is lost on restart.
- `.env` is ignored by git; use placeholder values and keep real credentials out of the repository.

## Related documents

- [`CHANGES.md`](CHANGES.md) – implementation summary for logging (3.8) and error handling (3.9)
- [`REFACTOR_TODO.md`](REFACTOR_TODO.md) – full review, requirement scorecard, open questions

## Learn more

- SAP Cloud Application Programming Model: <https://cap.cloud.sap>
- SAP Business One Service Layer: <https://help.sap.com/docs/SAP_BUSINESS_ONE>