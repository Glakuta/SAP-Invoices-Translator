import cds from '@sap/cds';
import { ProcessInvoiceService } from './processInvoiceService';
import { dispatchLogService } from './dispatchLogService';

module.exports = cds.service.impl(async function(this: any) {
  const { Invoices, DispatchLog } = this.entities;
  const processInvoiceService = new ProcessInvoiceService();

  this.on('sap.s4.invoice.created', async (req: any) => {
    const correlationId = require('crypto').randomUUID();
    console.log(`📨 [${correlationId}] Received invoice created event:`, req.data);
    
    try {
      const result = await processInvoiceService.handleInvoiceEvent(req.data);

      if (result?.success && result.invoiceData) {
        await INSERT.into(Invoices).entries({
          docEntry: result.invoiceData.docEntry,
          docNum: result.invoiceData.docNum,
          pdfUrl: result.filePath,
          status: 'PROCESSED',
          processedAt: new Date()
        });
      }

      return result;
      
    } catch (error) {
      console.error(`❌ [${correlationId}] Event processing failed:`, error);
      throw error;
    }
  });

this.on('processInvoice', async (req: any) => {
    const correlationId = require('crypto').randomUUID();
    console.log(`🔧 [${correlationId}] Manual processInvoice called:`, req.data);
    return processInvoiceService.handleInvoiceEvent(req.data);
  });

this.on('sendInvoiceEmail', async (req: any) => {
    const correlationId = require('crypto').randomUUID();
    const { docEntry } = req.data;
    
    console.log(`📧 [${correlationId}] sendInvoiceEmail called for docEntry: ${docEntry}`);
    
    try {
      const result = await processInvoiceService.sendInvoiceEmail(docEntry, correlationId);
      return result;
    } catch (error) {
      console.error(`❌ [${correlationId}] sendInvoiceEmail failed:`, error);
      throw error;
    }
  });

this.on('retryInvoice', async (req: any) => {
    const correlationId = require('crypto').randomUUID();
    const { docEntry } = req.data;
    
    console.log(`🔄 [${correlationId}] retryInvoice called for docEntry: ${docEntry}`);
    
    try {
      const existingLog = await dispatchLogService.getEntry(docEntry);
      if (existingLog?.status_code === 'SENT') {
        return { success: false, error: 'Invoice already sent, cannot retry' };
      }

      const result = await processInvoiceService.processInvoice({ docEntry, correlationId });
      return result;
    } catch (error) {
      console.error(`❌ [${correlationId}] retryInvoice failed:`, error);
      throw error;
    }
  });

this.on('resetInvoice', async (req: any) => {
    const correlationId = require('crypto').randomUUID();
    const { docEntry } = req.data;
    
    console.log(`🔄 [${correlationId}] resetInvoice called for docEntry: ${docEntry}`);
    
    try {
      const { createSAPService } = require('./sapService');
      const sapService = createSAPService();
      await sapService.resetInvoice(docEntry);
      
      await dispatchLogService.updateEntry(docEntry, {
        status: 'NEW',
        errorMessage: undefined,
        numberOfAttempts: 1
      });

      return { success: true, message: 'Invoice reset successfully' };
    } catch (error) {
      console.error(`❌ [${correlationId}] resetInvoice failed:`, error);
      throw error;
    }
  });
});