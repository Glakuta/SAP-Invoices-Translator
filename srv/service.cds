using { sap.capire.invoices as my } from '../db/schema';

service InvoicesService {

    entity Invoice as projection on my.Invoice;
    entity InvoiceItems as projection on my.InvoiceItem;
    entity DispatchLogs as projection on my.DispatchLog;
    entity EmailTemplates as projection on my.EmailTemplate;

    type ValidationResult {
        isValid: Boolean;
        errors: array of String;
        warnings: array of String;
        language: String;
        destination: String;
        shouldTranslate: Boolean;
        country: String;
    }

    action validateInvoice(invoiceData: LargeString) returns ValidationResult;
    action processInvoice(invoiceDocEntry: Integer, invoiceDocNum: Integer);
    action retryInvoice(invoiceDocEntry: Integer, invoiceDocNum: Integer);
    action resetInvoice(invoiceDocEntry: Integer, invoiceDocNum: Integer);
    action sendInvoiceEmail(invoiceDocEntry: Integer, invoiceDocNum: Integer, emailTemplateId: Integer);
    action translateInvoice(invoiceDocEntry: Integer, invoiceDocNum: Integer, targetLanguage: String);
    action generatePDF(invoiceDocEntry: Integer, invoiceDocNum: Integer);
    action fetchAndGeneratePDF(invoiceDocEntry: Integer, invoiceDocNum: Integer);
    action getDispatchLogs(invoiceDocEntry: Integer, invoiceDocNum: Integer) returns array of DispatchLogs;
    action getDispatchLogsByStatus(invoiceDocEntry: Integer, invoiceDocNum: Integer, status: String) returns array of DispatchLogs;


}