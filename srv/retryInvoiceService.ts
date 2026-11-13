import { SAPService, createSAPService } from './sapService';
import { ProcessInvoiceService } from './processInvoiceService';
import { dispatchLogService } from './dispatchLogService';
import { handleError, InvoiceErrorType } from './handleError';
import cds from '@sap/cds';

const logger = cds.log('retryInvoiceService');

export class RetryInvoiceService {
  private sapService: SAPService;
  private processInvoiceService: ProcessInvoiceService;

  constructor(sapService?: SAPService) {
    this.sapService = sapService || createSAPService();
    this.processInvoiceService = new ProcessInvoiceService(this.sapService);
  }

  async retryInvoice(docEntry: number, correlationId?: string): Promise<{ success: boolean; error?: string; filePath?: string }> {
    const cid = correlationId || docEntry.toString();
    
    try {
      logger.info(`[${cid}] Retrying invoice ${docEntry}`);

      const existingLog = await dispatchLogService.getEntry(docEntry);
      if (existingLog?.status_code === 'SENT') {
        const errorMsg = 'Invoice already sent, cannot retry';
        logger.warn(`[${cid}] ${errorMsg}`);
        return handleError({
          type: InvoiceErrorType.ALREADY_SENT,
          message: errorMsg,
          docEntry,
        });
      }

      if (existingLog?.status_code === 'PROCESSING') {
        const errorMsg = 'Invoice is currently being processed';
        logger.warn(`[${cid}] ${errorMsg}`);
        return handleError({
          type: InvoiceErrorType.INVALID_DATA,
          message: errorMsg,
          docEntry,
        });
      }

      const result = await this.processInvoiceService.processInvoice({ 
        docEntry, 
        correlationId: cid 
      });

      if (result.success) {
        logger.info(`[${cid}] Invoice ${docEntry} retried successfully`);
      } else {
        logger.error(`[${cid}] Invoice ${docEntry} retry failed: ${result.error}`);
      }

      return { 
        success: result.success, 
        error: result.error, 
        filePath: result.filePath 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${cid}] Error retrying invoice ${docEntry}:`, error);
      return handleError({
        type: InvoiceErrorType.UNKNOWN,
        message: errorMessage,
        docEntry,
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async retryMultipleInvoices(docEntries: number[]): Promise<Array<{ docEntry: number; success: boolean; error?: string }>> {
    const correlationId = require('crypto').randomUUID();
    const results: Array<{ docEntry: number; success: boolean; error?: string }> = [];

    logger.info(`[${correlationId}] Retrying ${docEntries.length} invoices`);

    for (const docEntry of docEntries) {
      try {
        const result = await this.retryInvoice(docEntry, `${correlationId}-${docEntry}`);
        results.push({ docEntry, success: result.success, error: result.error });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[${correlationId}] Error retrying invoice ${docEntry}:`, error);
        results.push({ docEntry, success: false, error: errorMessage });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`[${correlationId}] Retried ${successCount}/${docEntries.length} invoices successfully`);

    return results;
  }
}