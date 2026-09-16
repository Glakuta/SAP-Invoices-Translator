export interface ProcessInvoiceOptions {
  correlationId: string;
  docEntry?: number;
  docNum?: number;
  invoiceData?: InvoiceData;
  outputDir?: string;
}

export interface ProcessInvoiceResult {
  success: boolean;
  message?: string;
  filePath?: string;
  error?: string;
  invoiceData?: InvoiceData;
}

export interface SAPConfig {
  baseUrl: string;
  username: string;
  password: string;
  client?: string;
  language?: string;
  type: 'B1' | 'S4HANA';
}

export interface InvoiceData {
  docEntry?: number;
  docNum?: number;
  cardCode?: string;
  cardName?: string;
  docDate?: string;
  docDueDate?: string;
  docCurrency?: string;
  docTotal?: number;
  vatSum?: number;
  comments?: string;
  address?: string;
  invoiceItems?: InvoiceItem[];
  contractor?: BusinessPartner;
  billToCountry?: string;
  shipToCountry?: string;
  invoiceLanguage?: string;
  invoiceStatus?: InvoiceStatus;
}

export interface InvoiceItem {
  itemCode?: string;
  itemDescription?: string;
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  vatGroup?: string;
  lineTotal?: number;
  warehouseCode?: string;
}

export interface BusinessPartner {
  cardCode?: string;
  cardName?: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  vatId?: string;
}

export interface InvoiceStatus {
  docEntry?: number;
  docNum?: number;
  status: 'NEW' | 'PROCESSING' | 'ERROR' | 'SENT' | 'PDF_GENERATED';
}