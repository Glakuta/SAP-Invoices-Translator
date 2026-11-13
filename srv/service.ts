import cds from '@sap/cds';
import { invoiceValidationService } from './validationService';
import { ProcessInvoiceService } from './processInvoiceService';
import { ProcessInvoiceOptions, ProcessInvoiceResult } from '../types';
import { dispatchLogService } from './dispatchLogService';
import { SAPService, createSAPService } from './sapService';
import { handleError, InvoiceErrorType } from './handleError';

class InvoicesService extends cds.ApplicationService {
    private processInvoiceService: ProcessInvoiceService;

    constructor() {
        super();
        this.processInvoiceService = new ProcessInvoiceService();
    }

    async init() {
        this.before("CREATE", "Invoice", req => this.checkInvoiceData(req));
        this.on("validateInvoice", async (req) => this.validateInvoice(req));
        this.on("processInvoice", async (req) => this.processInvoice(req));
        this.on("translateInvoice", async (req) => this.processInvoice(req));
        this.on("sendInvoiceEmail", async (req) => this.sendInvoiceEmail(req));
        this.on("retryInvoice", async (req) => this.retryInvoice(req));
        this.on("resetInvoice", async (req) => this.resetInvoice(req));
        this.on("generatePDF", async (req) => this.generatePDF(req));
        this.on("fetchAndGeneratePDF", async (req) => this.fetchAndGeneratePDF(req));
        this.on("getDispatchLog", async (req) => this.getDispatchLog(req));
        this.on("getDispatchLogsByStatus", async (req) => this.getDispatchLogsByStatus(req));
        
        return super.init();
    }

    async checkInvoiceData(req: any) {
        try {
            const invoiceData = req.data.invoiceData || req.data;
            const validationResult = invoiceValidationService.validate(invoiceData);

            if (!validationResult.isValid) {
                req.error(400, validationResult.errors.join('; '));
                return;
            }

            req.data._validation = validationResult;
        } catch (error) {
            console.error("Error in checkInvoiceData:", error);
            req.error(500, "Internal Server Error");
        }
    }

    async validateInvoice(req: any) {
        const invoiceData = req.data.invoiceData || req.data;
        return invoiceValidationService.validate(invoiceData);
    }

    async processInvoice(req: any) {
        console.log("processInvoice action called with parameters:", req.data);
        
        const invoiceData = req.data.invoiceData || req.data;
        const options: ProcessInvoiceOptions = {
            invoiceData,
            outputDir: req.data.outputDir,
            correlationId: `process-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        const result: ProcessInvoiceResult = await this.processInvoiceService.processInvoice(options);
        
        if (!result.success) {
            req.error(500, result.error || 'Failed to process invoice');
            return;
        }

        return {
            success: true,
            filePath: result.filePath,
            message: 'Invoice PDF generated successfully',
        };
    }

    async translateInvoice(req: any) {
        const invoiceData = req.data.invoiceData || req.data;
    }

    async sendInvoiceEmail(req: any) {
        const { docEntry } = req.data;
        
        if (!docEntry) {
            req.error(400, 'docEntry is required');
            return;
        }

        try {
            const result = await this.processInvoiceService.sendInvoiceEmail(docEntry);
            
            if (!result.success) {
                req.error(500, result.error || 'Failed to send invoice email');
                return;
            }

            return {
                success: true,
                message: 'Invoice email sent successfully',
                invoiceData: result.invoiceData
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await handleError({
              type: InvoiceErrorType.EMAIL_SEND_FAILED,
              message: errorMessage,
              docEntry,
              cause: error instanceof Error ? error : undefined,
            });
            req.error(500, `Failed to send invoice email: ${errorMessage}`);
        }
    }

    async generatePDF(req: any) {
        const invoiceData = req.data.invoiceData || req.data;
        const options: ProcessInvoiceOptions = {
            invoiceData,
            outputDir: req.data.outputDir,
            correlationId: `generate-pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        const result: ProcessInvoiceResult = await this.processInvoiceService.processInvoice(options);
        
        if (!result.success) {
            req.error(500, result.error || 'Failed to generate PDF');
            return;
        }

        return {
            success: true,
            filePath: result.filePath,
            message: 'PDF generated successfully',
        };
    }

    async fetchAndGeneratePDF(req: any) {
        const { docEntry, docNum } = req.data;
        
        if (!docEntry && !docNum) {
            req.error(400, 'Either docEntry or docNum must be provided');
            return;
        }

        const options: ProcessInvoiceOptions = {
            docEntry,
            docNum,
            outputDir: req.data.outputDir,
            correlationId: `fetch-generate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };

        const result: ProcessInvoiceResult = await this.processInvoiceService.processInvoice(options);
        
        if (!result.success) {
            req.error(500, result.error || 'Failed to fetch and generate PDF');
            return;
        }

        return {
            success: true,
            filePath: result.filePath,
            invoiceData: result.invoiceData,
            message: 'Invoice fetched from SAP and PDF generated successfully',
        };
    }

async retryInvoice(req: any) {
        const { docEntry } = req.data;
        
        if (!docEntry) {
            req.error(400, 'docEntry is required');
            return;
        }

        try {
            const existingLog = await dispatchLogService.getEntry(docEntry);
            if (existingLog?.status_code === 'SENT') {
                req.error(400, 'Invoice already sent, cannot retry');
                return;
            }

            const result = await this.processInvoiceService.processInvoice({ 
            docEntry, 
            correlationId: `retry-${docEntry}-${Date.now()}` 
          });
             
            if (!result.success) {
                req.error(500, result.error || 'Failed to retry invoice processing');
                return;
            }

            return {
                success: true,
                filePath: result.filePath,
                message: 'Invoice retried successfully',
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await handleError({
              type: InvoiceErrorType.UNKNOWN,
              message: errorMessage,
              docEntry,
              cause: error instanceof Error ? error : undefined,
            });
            req.error(500, `Failed to retry invoice: ${errorMessage}`);
        }
    }

    async resetInvoice(req: any) {
        const { docEntry } = req.data;
        
        if (!docEntry) {
            req.error(400, 'docEntry is required');
            return;
        }

        try {
            const sapService = createSAPService();
            await sapService.resetInvoice(docEntry);
            
            await dispatchLogService.updateEntry(docEntry, {
                status: 'NEW',
                errorMessage: undefined,
                numberOfAttempts: 1
            });

            return {
                success: true,
                message: 'Invoice reset successfully',
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await handleError({
              type: InvoiceErrorType.SAP_ERROR,
              message: errorMessage,
              docEntry,
              cause: error instanceof Error ? error : undefined,
            });
            req.error(500, `Failed to reset invoice: ${errorMessage}`);
        }
    }

    async getDispatchLog(req: any) {
        const { docEntry } = req.data;
        
        if (!docEntry) {
            req.error(400, 'docEntry is required');
            return;
        }

        try {
            const log = await dispatchLogService.getEntry(docEntry);
            return log || { message: 'No log entry found' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await handleError({
              type: InvoiceErrorType.SAP_ERROR,
              message: errorMessage,
              docEntry,
              cause: error instanceof Error ? error : undefined,
            });
            req.error(500, `Failed to get dispatch log: ${errorMessage}`);
        }
    }

    async getDispatchLogsByStatus(req: any) {
        const { status } = req.data;
        
        if (!status) {
            req.error(400, 'status is required');
            return;
        }

        try {
            const logs = await dispatchLogService.getEntriesByStatus(status);
            return logs;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            req.error(500, `Failed to get dispatch logs: ${errorMessage}`);
        }
    }
}

export default InvoicesService;