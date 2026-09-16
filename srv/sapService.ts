import axios from 'axios';
import { BusinessPartner, InvoiceData, SAPConfig } from '../types';
import cds from '@sap/cds';

const logger = cds.log('sapService');

export class SAPService {
  private config: SAPConfig;
  private authToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: SAPConfig) {
    this.config = config;
  }

  private async getAuthToken(): Promise<string> {
    if (this.authToken && Date.now() < this.tokenExpiry) {
      return this.authToken;
    }

    try {
      logger.info(`Authenticating with SAP ${this.config.type}...`);
      
      if (this.config.type === 'B1') {
        const response = await axios.post(
          `${this.config.baseUrl}/b1s/v1/Login`,
          {
            UserName: this.config.username,
            Password: this.config.password,
            CompanyDB: this.config.client,
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        this.authToken = response.data.SessionId;
        this.tokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
      } else {
        const response = await axios.post(
          `${this.config.baseUrl}/oauth/token`,
          new URLSearchParams({
            grant_type: 'password',
            username: this.config.username,
            password: this.config.password,
            client_id: this.config.client || 'sb-invoices-translator',
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
        );
        this.authToken = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in || 3600) * 1000 - 60000;
      }
      
      logger.info(`SAP authentication successful`);
      return this.authToken!;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('SAP Authentication failed:', { 
        error: errorMessage, 
        type: this.config.type,
        baseUrl: this.config.baseUrl 
      });
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to SAP server: ${this.config.baseUrl}`);
        }
        if (error.response?.status === 401) {
          throw new Error('SAP authentication failed: Invalid credentials');
        }
        if (error.response?.status === 403) {
          throw new Error('SAP authentication failed: Access denied');
        }
        throw new Error(`SAP authentication failed: ${error.response?.data?.error?.message || errorMessage}`);
      }
      throw new Error(`Failed to authenticate with SAP: ${errorMessage}`);
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getAuthToken();
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  async getInvoice(docEntry: number): Promise<InvoiceData> {
    try {
      logger.info(`Fetching invoice ${docEntry} from SAP ${this.config.type}`);
      const headers = await this.getHeaders();
      
      let response;
      if (this.config.type === 'B1') {
        response = await axios.get(
          `${this.config.baseUrl}/b1s/v1/Invoices(${docEntry})`,
          { headers, timeout: 30000 }
        );
        return this.mapB1Invoice(response.data);
      } else {
        response = await axios.get(
          `${this.config.baseUrl}/odata/v4/Invoice/Invoices(${docEntry})`,
          { headers, timeout: 30000 }
        );
        return this.mapS4Invoice(response.data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to fetch invoice ${docEntry}:`, { error: errorMessage });
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to SAP server`);
        }
        if (error.response?.status === 404) {
          throw new Error(`Invoice ${docEntry} not found in SAP`);
        }
        if (error.response?.status === 401) {
          this.authToken = null;
          throw new Error('SAP session expired, please retry');
        }
        throw new Error(`Failed to fetch invoice ${docEntry}: ${error.response?.data?.error?.message || errorMessage}`);
      }
      throw new Error(`Failed to fetch invoice ${docEntry}: ${errorMessage}`);
    }
  }

  async getInvoiceByDocNum(docNum: number): Promise<InvoiceData> {
    try {
      logger.info(`Fetching invoice by DocNum ${docNum} from SAP ${this.config.type}`);
      const headers = await this.getHeaders();
      
      let response;
      if (this.config.type === 'B1') {
        response = await axios.get(
          `${this.config.baseUrl}/b1s/v1/Invoices?$filter=DocNum eq ${docNum}`,
          { headers, timeout: 30000 }
        );
        if (response.data.value && response.data.value.length > 0) {
          return this.mapB1Invoice(response.data.value[0]);
        }
      } else {
        response = await axios.get(
          `${this.config.baseUrl}/odata/v4/Invoice/Invoices?$filter=DocNum eq ${docNum}`,
          { headers, timeout: 30000 }
        );
        if (response.data.value && response.data.value.length > 0) {
          return this.mapS4Invoice(response.data.value[0]);
        }
      }
      throw new Error(`Invoice with DocNum ${docNum} not found`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to fetch invoice by DocNum ${docNum}:`, { error: errorMessage });
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to SAP server`);
        }
        if (error.response?.status === 401) {
          this.authToken = null;
          throw new Error('SAP session expired, please retry');
        }
        throw new Error(`Failed to fetch invoice by DocNum ${docNum}: ${error.response?.data?.error?.message || errorMessage}`);
      }
      throw new Error(`Failed to fetch invoice by DocNum ${docNum}: ${errorMessage}`);
    }
  }

  async getBusinessPartner(cardCode: string): Promise<BusinessPartner> {
    try {
      logger.info(`Fetching business partner ${cardCode} from SAP ${this.config.type}`);
      const headers = await this.getHeaders();
      
      let response;
      if (this.config.type === 'B1') {
        response = await axios.get(
          `${this.config.baseUrl}/b1s/v1/BusinessPartners('${cardCode}')`,
          { headers, timeout: 30000 }
        );
        return this.mapB1BusinessPartner(response.data);
      } else {
        response = await axios.get(
          `${this.config.baseUrl}/odata/v4/BusinessPartner/BusinessPartners('${cardCode}')`,
          { headers, timeout: 30000 }
        );
        return this.mapS4BusinessPartner(response.data);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to fetch business partner ${cardCode}:`, { error: errorMessage });
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to SAP server`);
        }
        if (error.response?.status === 404) {
          throw new Error(`Business partner ${cardCode} not found in SAP`);
        }
        if (error.response?.status === 401) {
          this.authToken = null;
          throw new Error('SAP session expired, please retry');
        }
        throw new Error(`Failed to fetch business partner ${cardCode}: ${error.response?.data?.error?.message || errorMessage}`);
      }
      throw new Error(`Failed to fetch business partner ${cardCode}: ${errorMessage}`);
    }
  }

  async updateInvoiceStatus(docEntry: number, status: string, pdfUrl?: string): Promise<void> {
    try {
      logger.info(`Updating invoice ${docEntry} status to ${status}`);
      const headers = await this.getHeaders();
      const payload = {
        U_InvoiceStatus: status,
        U_PDFUrl: pdfUrl,
        U_ProcessedDate: new Date().toISOString()
      };

      if (this.config.type === 'B1') {
        await axios.patch(
          `${this.config.baseUrl}/b1s/v1/Invoices(${docEntry})`,
          payload,
          { headers, timeout: 30000 }
        );
      } else {
        await axios.patch(
          `${this.config.baseUrl}/odata/v4/Invoice/Invoices(${docEntry})`,
          payload,
          { headers, timeout: 30000 }
        );
      }
      
      logger.info(`Invoice ${docEntry} status updated to ${status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to update invoice ${docEntry}:`, { error: errorMessage, status });
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error(`Cannot connect to SAP server`);
        }
        if (error.response?.status === 401) {
          this.authToken = null;
          throw new Error('SAP session expired, please retry');
        }
        if (error.response?.status === 404) {
          throw new Error(`Invoice ${docEntry} not found in SAP`);
        }
        throw new Error(`Failed to update invoice ${docEntry}: ${error.response?.data?.error?.message || errorMessage}`);
      }
      throw new Error(`Failed to update invoice ${docEntry}: ${errorMessage}`);
    }
  }

  async resetInvoice(docEntry: number): Promise<void> {
    try {
      logger.info(`Resetting invoice ${docEntry} status`);
      const headers = await this.getHeaders();
      const payload = {
        U_InvoiceStatus: 'NEW',
        U_PDFUrl: null,
        U_ProcessedDate: null
      };

      if (this.config.type === 'B1') {
        await axios.patch(
          `${this.config.baseUrl}/b1s/v1/Invoices(${docEntry})`,
          payload,
          { headers, timeout: 30000 }
        );
      } else {
        await axios.patch(
          `${this.config.baseUrl}/odata/v4/Invoice/Invoices(${docEntry})`,
          payload,
          { headers, timeout: 30000 }
        );
      }
      
      logger.info(`Invoice ${docEntry} reset to NEW status`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to reset invoice ${docEntry}:`, { error: errorMessage });
      throw new Error(`Failed to reset invoice ${docEntry}: ${errorMessage}`);
    }
  }

  private mapB1Invoice(data: any): InvoiceData {
    return {
      docEntry: data.DocEntry,
      docNum: data.DocNum,
      cardCode: data.CardCode,
      cardName: data.CardName,
      docDate: data.DocDate,
      docDueDate: data.DocDueDate,
      docCurrency: data.DocCurrency,
      docTotal: data.DocTotal,
      vatSum: data.VatSum,
      comments: data.Comments,
      address: data.Address,
      billToCountry: data.BillToCountry,
      shipToCountry: data.ShipToCountry,
      invoiceLanguage: data.InvoiceLanguage,
      invoiceItems: data.DocumentLines?.map((line: any) => ({
        itemCode: line.ItemCode,
        itemDescription: line.ItemDescription,
        quantity: line.Quantity,
        unitPrice: line.UnitPrice,
        currency: line.Currency,
        vatGroup: line.VatGroup,
        lineTotal: line.LineTotal,
        warehouseCode: line.WarehouseCode,
      })),
      contractor: data.BusinessPartner ? this.mapB1BusinessPartner(data.BusinessPartner) : undefined,
    };
  }

  private mapS4Invoice(data: any): InvoiceData {
    return {
      docEntry: data.DocEntry,
      docNum: data.DocNum,
      cardCode: data.CardCode,
      cardName: data.CardName,
      docDate: data.DocDate,
      docDueDate: data.DocDueDate,
      docCurrency: data.DocCurrency,
      docTotal: data.DocTotal,
      vatSum: data.VatSum,
      comments: data.Comments,
      address: data.Address,
      billToCountry: data.BillToCountry,
      shipToCountry: data.ShipToCountry,
      invoiceLanguage: data.InvoiceLanguage,
      invoiceItems: data.Items?.map((line: any) => ({
        itemCode: line.ItemCode,
        itemDescription: line.ItemDescription,
        quantity: line.Quantity,
        unitPrice: line.UnitPrice,
        currency: line.Currency,
        vatGroup: line.VatGroup,
        lineTotal: line.LineTotal,
        warehouseCode: line.WarehouseCode,
      })),
      contractor: data.BusinessPartner ? this.mapS4BusinessPartner(data.BusinessPartner) : undefined,
    };
  }

  private mapB1BusinessPartner(data: any): BusinessPartner {
    return {
      cardCode: data.CardCode,
      cardName: data.CardName,
      address: data.Address,
      city: data.City,
      country: data.Country,
      postalCode: data.PostalCode,
      phone: data.Phone,
      email: data.Email,
      vatId: data.VatId,
    };
  }

  private mapS4BusinessPartner(data: any): BusinessPartner {
    return {
      cardCode: data.CardCode,
      cardName: data.CardName,
      address: data.Address,
      city: data.City,
      country: data.Country,
      postalCode: data.PostalCode,
      phone: data.Phone,
      email: data.Email,
      vatId: data.VatId,
    };
  }
}

export function createSAPService(): SAPService {
  const type = (process.env.SAP_TYPE || 'B1') as 'B1' | 'S4HANA';
  return new SAPService({
    baseUrl: process.env.SAP_BASE_URL || '',
    username: process.env.SAP_USERNAME || '',
    password: process.env.SAP_PASSWORD || '',
    client: process.env.SAP_CLIENT,
    language: process.env.SAP_LANGUAGE,
    type,
  });
}

export type { InvoiceData };