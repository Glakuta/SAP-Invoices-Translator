import { SAPService, createSAPService } from './sapService';
import { dispatchLogService } from './dispatchLogService';
import { handleError, InvoiceErrorType } from './handleError';
import cds from '@sap/cds';

const logger = cds.log('resetInvoiceService');

export class ResetInvoiceService {
  private sapService: SAPService;

  constructor(sapService?: SAPService) {
    this.sapService = sapService || createSAPService();
  }

  async resetInvoice(docEntry: number, correlationId?: string): Promise<{ success: boolean; error?: string }> {
    const cid = correlationId || docEntry.toString();
    
    try {
      logger.info(`[${cid}] Resetting invoice ${docEntry}`);

      await this.sapService.resetInvoice(docEntry);
      
      await dispatchLogService.updateEntry(docEntry, {
        status: 'NEW',
        errorMessage: undefined,
        numberOfAttempts: 1
      });

      logger.info(`[${cid}] Invoice ${docEntry} reset successfully`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${cid}] Error resetting invoice ${docEntry}:`, error);
      return handleError({
        type: InvoiceErrorType.SAP_ERROR,
        message: errorMessage,
        docEntry,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async resetMultipleInvoices(docEntries: number[]): Promise<Array<{ docEntry: number; success: boolean; error?: string }>> {
    const correlationId = require('crypto').randomUUID();
    const results: Array<{ docEntry: number; success: boolean; error?: string }> = [];

    logger.info(`[${correlationId}] Resetting ${docEntries.length} invoices`);

    for (const docEntry of docEntries) {
      try {
        const result = await this.resetInvoice(docEntry, `${correlationId}-${docEntry}`);
        results.push({ docEntry, success: result.success, error: result.error });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[${correlationId}] Error resetting invoice ${docEntry}:`, error);
        results.push({ docEntry, success: false, error: errorMessage });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`[${correlationId}] Reset ${successCount}/${docEntries.length} invoices successfully`);

    return results;
  }
}