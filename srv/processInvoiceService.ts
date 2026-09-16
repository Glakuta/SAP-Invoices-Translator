import { SAPService, createSAPService, InvoiceData as SAPInvoiceData } from './sapService';
import { InvoiceGenerator, generateInvoice, InvoiceData } from './genInvoice';
import { ProcessInvoiceOptions, ProcessInvoiceResult } from '../types';
import { dispatchLogService, DispatchLogEntry } from './dispatchLogService';
import { sendEmail, EmailSendResult } from './sendEmail';
import cds from '@sap/cds';
import { v4 as uuidv4 } from 'uuid';

interface ProcessingContext {
  correlationId: string;
  docEntry: number;
  docNum?: number;
  retryCount: number;
  timestamp: string;
  system: 'B1' | 'S4HANA';
}

export class ProcessInvoiceService {
  private sapService: SAPService;
  private processedInvoices: Set<number> = new Set();
  private readonly MAX_RETRIES = 3;
  private readonly logger = cds.log("customLogger");

  constructor(sapService?: SAPService) {
    this.sapService = sapService || createSAPService();
  }

  async handleInvoiceEvent(eventData: any): Promise<ProcessInvoiceResult> {
    const correlationId = uuidv4();
    const context: ProcessingContext = {
      correlationId,
      docEntry: eventData.docEntry || eventData.DocEntry,
      docNum: eventData.docNum || eventData.DocNum,
      retryCount: eventData.retryCount || 0,
      timestamp: new Date().toISOString(),
      system: eventData.system || 'B1'
    };

    this.logger.info(`📨 [${correlationId}] Processing invoice event`, context);

    try {
      if (this.isInvoiceProcessed(context.docEntry)) {
        this.logger.info(`⏭️ [${correlationId}] Invoice ${context.docEntry} already processed, skipping`);
        return {
          success: true,
          message: 'Already processed',
          invoiceData: await this.getInvoiceData(context.docEntry)
        };
      }

      const invoiceData = await this.processInvoice({
        docEntry: context.docEntry,
        correlationId
      });

      this.markInvoiceAsProcessed(context.docEntry);

      this.logger.info(`✅ [${correlationId}] Successfully processed invoice ${context.docEntry}`);
      return {
        success: true,
        filePath: invoiceData.filePath,
        invoiceData: invoiceData.invoiceData
      };

    } catch (error) {
      this.logger.error(`❌ [${correlationId}] Error processing invoice event:`, error);
      throw error;
    }
  }

  async processInvoice(options: ProcessInvoiceOptions): Promise<ProcessInvoiceResult> {
    const correlationId = options.correlationId || uuidv4();
    let docEntry: number | undefined;
    let invoiceDataMapped: InvoiceData | undefined;

    try {
      let invoiceData: InvoiceData;
      if (options.invoiceData) {
        invoiceData = options.invoiceData;
      } else if (options.docEntry) {
        const sapData = await this.sapService.getInvoice(options.docEntry);
        invoiceData = this.mapSAPToInvoiceData(sapData);
      } else if (options.docNum) {
        const sapData = await this.sapService.getInvoiceByDocNum(options.docNum);
        invoiceData = this.mapSAPToInvoiceData(sapData);
      } else {
        return {
          success: false,
          error: 'Either invoiceData, docEntry, or docNum must be provided',
        };
      }

      docEntry = invoiceData.docEntry;
      if (!docEntry) {
        return {
          success: false,
          error: 'Invoice docEntry is missing',
          invoiceData
        };
      }

      await dispatchLogService.logEntry({
        docEntry,
        docNum: invoiceData.docNum,
        invoiceNumber: invoiceData.docNum?.toString(),
        cardCode: invoiceData.cardCode,
        cardName: invoiceData.cardName,
        contractorCountry: invoiceData.contractor?.country || invoiceData.billToCountry || invoiceData.shipToCountry,
        contractorEmail: invoiceData.contractor?.email,
        status: 'PROCESSING',
        timestamp: new Date()
      });

      if (!invoiceData.contractor && invoiceData.cardCode) {
        this.logger.info(`👤 [${correlationId}] Fetching business partner ${invoiceData.cardCode}`);
        const partner = await this.sapService.getBusinessPartner(invoiceData.cardCode);
        invoiceData.contractor = partner;
        
        await dispatchLogService.updateEntry(docEntry, {
          contractorEmail: partner.email,
          contractorCountry: partner.country,
          cardCode: partner.cardCode,
          cardName: partner.cardName
        });
      }

      const existingInvoiceData = await this.sapService.getInvoice(docEntry);
      if (existingInvoiceData.invoiceStatus?.status === 'PDF_GENERATED' || existingInvoiceData.invoiceStatus?.status === 'SENT') {
        const errorMsg = 'Invoice already has a generated PDF or was sent';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      invoiceDataMapped = this.mapSAPToInvoiceData(invoiceData);

      if (!this.validateInvoiceData(invoiceDataMapped)) {
        const errorMsg = 'Invoice data is incomplete or invalid';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return {
          success: false,
          error: errorMsg,
          invoiceData: invoiceDataMapped
        };
      }

      if (!invoiceDataMapped.contractor?.email) {
        const errorMsg = 'Missing contractor email address';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return {
          success: false,
          error: errorMsg,
          invoiceData: invoiceDataMapped
        };
      }

      if (!this.isValidEmail(invoiceDataMapped.contractor.email)) {
        const errorMsg = `Invalid contractor email address: ${invoiceDataMapped.contractor.email}`;
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return {
          success: false,
          error: errorMsg,
          invoiceData: invoiceDataMapped
        };
      }

      const result = await generateInvoice(invoiceDataMapped, options.outputDir);

      await dispatchLogService.updateEntry(docEntry, {
        pdfFilePath: result.filePath,
        pdfGeneratedAt: new Date(),
        status: 'PDF_GENERATED'
      });

      await this.sapService.updateInvoiceStatus(
        docEntry,
        'PDF_GENERATED',
        result.filePath
      );

      return {
        success: true,
        filePath: result.filePath,
        invoiceData: invoiceDataMapped,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error processing invoice ${docEntry}:`, error);
      
      if (docEntry) {
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMessage
        });
      }
      
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to process invoice: ${error}`);
    }
  }

  async sendInvoiceEmail(docEntry: number, correlationId?: string): Promise<ProcessInvoiceResult> {
    const cid = correlationId || uuidv4();
    let invoiceDataMapped: InvoiceData | undefined;

    try {
      const sapData = await this.sapService.getInvoice(docEntry);
      invoiceDataMapped = this.mapSAPToInvoiceData(sapData);

      if (!invoiceDataMapped) {
        throw new Error('Failed to map invoice data');
      }

      if (!invoiceDataMapped.contractor?.email) {
        const errorMsg = 'Missing contractor email address';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return { success: false, error: errorMsg, invoiceData: invoiceDataMapped };
      }

      if (!this.isValidEmail(invoiceDataMapped.contractor.email)) {
        const errorMsg = `Invalid contractor email address: ${invoiceDataMapped.contractor.email}`;
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg
        });
        return { success: false, error: errorMsg, invoiceData: invoiceDataMapped };
      }

      const existingLog = await dispatchLogService.getEntry(docEntry);
      const attemptNumber = (existingLog?.numberOfAttempts || 0) + 1;

      if (existingLog?.status_code === 'SENT') {
        const errorMsg = 'Invoice already sent';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg,
          numberOfAttempts: attemptNumber
        });
        return { success: false, error: errorMsg, invoiceData: invoiceDataMapped };
      }

      if (!existingLog?.pdfFilePath) {
        const errorMsg = 'PDF not generated yet';
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMsg,
          numberOfAttempts: attemptNumber
        });
        return { success: false, error: errorMsg, invoiceData: invoiceDataMapped };
      }

      const pdfPath = existingLog.pdfFilePath;

      await dispatchLogService.updateEntry(docEntry, {
        numberOfAttempts: attemptNumber,
        status: 'PROCESSING'
      });

      const emailResult = await sendEmail({
        to: invoiceDataMapped.contractor.email,
        subject: `Faktura ${invoiceDataMapped.docNum || invoiceDataMapped.docEntry}`,
        html: this.generateEmailHtml(invoiceDataMapped),
        attachments: [{
          filename: `Faktura_${invoiceDataMapped.docNum || invoiceDataMapped.docEntry}.pdf`,
          path: pdfPath!
        }],
        docEntry
      });

      if (emailResult.success) {
        await dispatchLogService.updateEntry(docEntry, {
          sentAt: new Date(),
          status: 'SENT',
          errorMessage: undefined
        });

        await this.sapService.updateInvoiceStatus(docEntry, 'SENT', pdfPath);

        this.logger.info(`✅ [${cid}] Email sent successfully for invoice ${docEntry}`);
        return { success: true, message: 'Email sent successfully', invoiceData: invoiceDataMapped };
      } else {
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: emailResult.error,
          numberOfAttempts: attemptNumber
        });
        return { success: false, error: emailResult.error, invoiceData: invoiceDataMapped };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error sending email for invoice ${docEntry}:`, error);
      
      if (docEntry) {
        await dispatchLogService.updateEntry(docEntry, {
          status: 'ERROR',
          errorMessage: errorMessage
        });
      }
      
      throw error;
    }
  }

  async processMultipleInvoices(docEntries: number[], outputDir?: string): Promise<ProcessInvoiceResult[]> {
    const results: ProcessInvoiceResult[] = [];
    const correlationId = uuidv4();
    
    this.logger.info(`📦 [${correlationId}] Processing ${docEntries.length} invoices`);

    for (const docEntry of docEntries) {
      try {
        const result = await this.processInvoice({ 
          docEntry, 
          outputDir,
          correlationId: `${correlationId}-${docEntry}`
        });
        results.push(result);
      } catch (error) {
        const failedResult: ProcessInvoiceResult & { docEntry?: number } = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          docEntry
        };
        results.push(failedResult as ProcessInvoiceResult);
      }
    }

    const successCount = results.filter(r => r.success).length;
    this.logger.info(`📊 [${correlationId}] Processed ${successCount}/${docEntries.length} invoices successfully`);

    return results;
  }

  private validateInvoiceData(invoiceData: InvoiceData): boolean {
    if (!invoiceData.docEntry) {
      this.logger.error('Missing docEntry');
      return false;
    }

    if (!invoiceData.cardCode || !invoiceData.cardName) {
      this.logger.error('Missing business partner data');
      return false;
    }

    if (!invoiceData.invoiceItems || invoiceData.invoiceItems.length === 0) {
      this.logger.error('No invoice items found');
      return false;
    }

    if (!invoiceData.contractor) {
      this.logger.error('Missing contractor data');
      return false;
    }

    return true;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private generateEmailHtml(invoiceData: InvoiceData): string {
    return `
      <html>
        <body>
          <h2>Faktura ${invoiceData.docNum || invoiceData.docEntry}</h2>
          <p>Szanowni Państwo,</p>
          <p>W załączniku przesyłamy fakturę nr <strong>${invoiceData.docNum || invoiceData.docEntry}</strong> 
          z dnia ${invoiceData.docDate || 'brak daty'} na kwotę ${invoiceData.docTotal} ${invoiceData.docCurrency}.</p>
          <p>Z poważaniem,<br/>Zespół Finansowy</p>
        </body>
      </html>
    `;
  }

  private isInvoiceProcessed(docEntry: number): boolean {
    return this.processedInvoices.has(docEntry);
  }

  private markInvoiceAsProcessed(docEntry: number): void {
    this.processedInvoices.add(docEntry);
  }

  private async getInvoiceData(docEntry: number): Promise<InvoiceData> {
    const sapData = await this.sapService.getInvoice(docEntry);
    return this.mapSAPToInvoiceData(sapData);
  }

  private mapSAPToInvoiceData(sapData: SAPInvoiceData): InvoiceData {
    return {
      docEntry: sapData.docEntry,
      docNum: sapData.docNum,
      cardCode: sapData.cardCode,
      cardName: sapData.cardName,
      docDate: sapData.docDate,
      docDueDate: sapData.docDueDate,
      docCurrency: sapData.docCurrency,
      docTotal: sapData.docTotal,
      vatSum: sapData.vatSum,
      comments: sapData.comments,
      address: sapData.address,
      billToCountry: sapData.billToCountry,
      shipToCountry: sapData.shipToCountry,
      invoiceLanguage: sapData.invoiceLanguage,
      invoiceItems: sapData.invoiceItems?.map(item => ({
        itemCode: item.itemCode,
        itemDescription: item.itemDescription,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        currency: item.currency,
        vatGroup: item.vatGroup,
        lineTotal: item.lineTotal,
        warehouseCode: item.warehouseCode,
      })),
      contractor: sapData.contractor ? {
        cardCode: sapData.contractor.cardCode,
        cardName: sapData.contractor.cardName,
        address: sapData.contractor.address,
        city: sapData.contractor.city,
        country: sapData.contractor.country,
        postalCode: sapData.contractor.postalCode,
        phone: sapData.contractor.phone,
        email: sapData.contractor.email,
        vatId: sapData.contractor.vatId,
      } : undefined,
    };
  }
}

export async function processInvoice(options: ProcessInvoiceOptions): Promise<ProcessInvoiceResult> {
  const service = new ProcessInvoiceService();
  return service.processInvoice(options);
}