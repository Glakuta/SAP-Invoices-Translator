using {
    cuid,
    managed,
    sap.common.CodeList,
} from '@sap/cds/common';

namespace sap.capire.invoices;

entity BusinessPartner: cuid, managed {
    cardCode : String;
    name : String;
    email : String;
    country : String;
    invoices : Association to many Invoice on invoices.contractor = $self;
}

entity Invoice: cuid, managed {
    docEntry : Integer;
    docNum : Integer;
    contractor : Association to BusinessPartner;
    billToCountry : String;
    deliveryMethod  : Association to DeliveryMethod;
    date : Date;
    invoiceItems : Association to many InvoiceItem on invoiceItems.invoice = $self;
    invoiceLanguage: association to Languages;
    currency : association to InvoiceCurrency;
    invoiceStatus: Association to invoiceStatus;
    processStatus: Association to processStatus;

    
}

entity DispatchLog: cuid, managed {
    invoice : Association to Invoice;
    docEntry : Integer;
    docNum : Integer;
    invoiceNumber : String;
    cardCode : String;
    cardName : String;
    contractorCountry : String;
    contractorEmail : String;
    pdfFilePath : String;
    pdfGeneratedAt : Timestamp;
    sentAt : Timestamp;
    numberOfAttempts : Integer default 1;
    status : Association to processStatus;
    errorMessage : String;
    timestamp : Timestamp;
    pdfMetadata : LargeString;
}

entity InvoiceItem: cuid, managed {
    itemCode : String;
    description : String;
    invoice : Association to Invoice;
    quantity: Decimal(10,2);
    unitPrice: Decimal(10,2);
    netAmount: Decimal(10,2);
    taxAmount: Decimal(10,2);
    grossAmount: Decimal(10,2);
    taxRate: Decimal(10,2);
    
}

entity DeliveryMethod: CodeList {
    key code : String enum {
        pdf  = 'PDF';
        ksef = 'KSEF';
    }
}

entity InvoiceCurrency : CodeList {
    key code : String enum {
        usd = 'USD';
        eur = 'EUR';
        pln = 'PLN';
    }
}

entity invoiceStatus : CodeList {
    key code : String enum {
        draft = 'DRAFT';
        open = 'OPEN';
        closed = 'CLOSED';
        cancelled = 'CANCELLED';
        }
}

entity processStatus : CodeList {
    key code : String enum {
        new = 'NEW';
        processing = 'PROCESSING';
        error = 'ERROR';
        pdfGenerated = 'PDF_GENERATED';
        sent = 'SENT';
    }
}

entity Languages: CodeList {
    key code : String enum {
        en = 'EN';
        de = 'DE';
    }
}

entity EmailTemplate: cuid, managed {
    language: association to Languages;
    subject : String;
    body : String;
}

entity Email {
  key ID:UUID;
      ![from]:String;
      to:String;
      subject:String;
      html:String;
}