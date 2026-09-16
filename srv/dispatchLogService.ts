import cds from '@sap/cds';

export interface DispatchLogEntry {
  docEntry: number;
  docNum?: number;
  invoiceNumber?: string;
  cardCode?: string;
  cardName?: string;
  contractorCountry?: string;
  contractorEmail?: string;
  pdfFilePath?: string;
  pdfGeneratedAt?: Date;
  sentAt?: Date;
  numberOfAttempts?: number;
  status: 'NEW' | 'PROCESSING' | 'ERROR' | 'SENT' | 'PDF_GENERATED';
  errorMessage?: string;
  timestamp?: Date;
}

export class DispatchLogService {
  private readonly logger = cds.log('dispatchLog');

  async logEntry(entry: DispatchLogEntry): Promise<void> {
    try {
      const { DispatchLog } = cds.entities('sap.capire.invoices');
      
      const logData = {
        docEntry: entry.docEntry,
        docNum: entry.docNum,
        invoiceNumber: entry.invoiceNumber,
        cardCode: entry.cardCode,
        cardName: entry.cardName,
        contractorCountry: entry.contractorCountry,
        contractorEmail: entry.contractorEmail,
        pdfFilePath: entry.pdfFilePath,
        pdfGeneratedAt: entry.pdfGeneratedAt,
        sentAt: entry.sentAt,
        numberOfAttempts: entry.numberOfAttempts || 1,
        status_code: entry.status,
        errorMessage: entry.errorMessage,
        timestamp: entry.timestamp || new Date()
      };

      await INSERT.into(DispatchLog).entries(logData);
      this.logger.info(`Dispatch log created for DocEntry: ${entry.docEntry}`, logData);
    } catch (error) {
      this.logger.error('Failed to create dispatch log entry', { error, entry });
      console.error('Failed to create dispatch log entry:', error);
    }
  }

  async updateEntry(docEntry: number, updates: Partial<DispatchLogEntry>): Promise<void> {
    try {
      const { DispatchLog } = cds.entities('sap.capire.invoices');
      
      const updateData: Record<string, any> = {};
      if (updates.pdfFilePath) updateData.pdfFilePath = updates.pdfFilePath;
      if (updates.pdfGeneratedAt) updateData.pdfGeneratedAt = updates.pdfGeneratedAt;
      if (updates.sentAt) updateData.sentAt = updates.sentAt;
      if (updates.numberOfAttempts) updateData.numberOfAttempts = updates.numberOfAttempts;
      if (updates.status) updateData.status_code = updates.status;
      if (updates.errorMessage) updateData.errorMessage = updates.errorMessage;
      if (updates.contractorEmail) updateData.contractorEmail = updates.contractorEmail;

      if (Object.keys(updateData).length > 0) {
        await UPDATE(DispatchLog).set(updateData).where({ docEntry });
        this.logger.info(`Dispatch log updated for DocEntry: ${docEntry}`, updateData);
      }
    } catch (error) {
      this.logger.error(`Failed to update dispatch log for DocEntry: ${docEntry}`, { error, updates });
      console.error(`Failed to update dispatch log for DocEntry: ${docEntry}:`, error);
    }
  }

  async getEntry(docEntry: number): Promise<any> {
    try {
      const { DispatchLog } = cds.entities('sap.capire.invoices');
      return await SELECT.one.from(DispatchLog).where({ docEntry });
    } catch (error) {
      this.logger.error(`Failed to get dispatch log for DocEntry: ${docEntry}`, error);
      return null;
    }
  }

  async getEntriesByStatus(status: string): Promise<any[]> {
    try {
      const { DispatchLog } = cds.entities('sap.capire.invoices');
      return await SELECT.from(DispatchLog).where({ status_code: status });
    } catch (error) {
      this.logger.error(`Failed to get dispatch logs by status: ${status}`, error);
      return [];
    }
  }

  logInfo(message: string, data?: any): void {
    this.logger.info(message, data);
  }

  logError(message: string, error: any, context?: any): void {
    this.logger.error(message, { error: error instanceof Error ? error.message : error, stack: error instanceof Error ? error.stack : undefined, context });
  }

  logWarn(message: string, data?: any): void {
    this.logger.warn(message, data);
  }
}

export const dispatchLogService = new DispatchLogService();