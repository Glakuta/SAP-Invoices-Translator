import fs from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import handlebars from 'handlebars';
import cds from '@sap/cds';
import { translateInvoice, detectTargetLanguage } from './translationService';

const logger = cds.log('invoiceGenerator');

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
  invoiceItems?: Array<{
    itemCode?: string;
    itemDescription?: string;
    quantity?: number;
    unitPrice?: number;
    currency?: string;
    vatGroup?: string;
    lineTotal?: number;
    warehouseCode?: string;
  }>;
  contractor?: {
    cardCode?: string;
    cardName?: string;
    address?: string;
    city?: string;
    country?: string;
    postalCode?: string;
    phone?: string;
    email?: string;
    vatId?: string;
  };
  billToCountry?: string;
  shipToCountry?: string;
  invoiceLanguage?: string;
}

export interface GenerateInvoiceResult {
  buffer: Buffer;
  filePath: string;
}

export class InvoiceGenerator {
  private outputDir: string;

  constructor(
    private invoiceData: InvoiceData,
    outputDir: string = 'output'
  ) {
    this.outputDir = outputDir;
  }

  async generateInvoicePDF(): Promise<GenerateInvoiceResult> {
    const correlationId = this.invoiceData.docEntry?.toString() || 'unknown';
    let browser: Browser | null = null;

    try {
      logger.info(`[${correlationId}] Starting PDF generation`);

      const translatedData = await translateInvoice(this.invoiceData);

      const templateHtml = this.loadTemplate();
      const template = handlebars.compile(templateHtml);
      const html = template(translatedData);

      logger.info(`[${correlationId}] Template rendered, launching browser`);
      browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });

      logger.info(`[${correlationId}] Generating PDF`);
      const pdfUint8Array = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        printBackground: true,
      });

      await browser.close();
      browser = null;

      const pdfBuffer = Buffer.from(pdfUint8Array);
      const filePath = this.generateFilePath();
      await this.savePDF(pdfBuffer, filePath);

      logger.info(`[${correlationId}] PDF generated successfully: ${filePath}`);
      return { buffer: pdfBuffer, filePath };
    } catch (error) {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          logger.warn(`[${correlationId}] Error closing browser:`, closeError);
        }
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${correlationId}] Error generating PDF:`, { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
      
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error(`Template file not found: ${errorMessage}`);
      }
      if (error instanceof Error && error.message.includes('EACCES')) {
        throw new Error(`Permission denied accessing template or output directory: ${errorMessage}`);
      }
      if (error instanceof Error && error.message.includes('puppeteer')) {
        throw new Error(`PDF generation failed (puppeteer): ${errorMessage}`);
      }
      throw new Error(`Failed to generate invoice PDF: ${errorMessage}`);
    }
  }

  private loadTemplate(): string {
    const templatePath = 'templates/invoiceTemplate.html';
    try {
      if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath}`);
      }
      return fs.readFileSync(templatePath, 'utf8');
    } catch (error) {
      logger.error('Failed to load template:', error);
      throw new Error(`Failed to load invoice template: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private generateFilePath(): string {
    const year = new Date().getFullYear().toString();
    const cardCode = this.invoiceData.cardCode || 'UNKNOWN';
    const docNum = this.invoiceData.docNum || this.invoiceData.docEntry || 'UNKNOWN';
    const docEntry = this.invoiceData.docEntry || this.invoiceData.docNum || 'UNKNOWN';

    const dirPath = path.join(this.outputDir, year, cardCode);
    const fileName = `${docNum}_${docEntry}.pdf`;

    return path.join(dirPath, fileName);
  }

  private async savePDF(pdfBuffer: Buffer, filePath: string): Promise<void> {
    const dirPath = path.dirname(filePath);
    
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info(`Created directory: ${dirPath}`);
      }

      fs.writeFileSync(filePath, pdfBuffer);
      logger.info(`PDF saved to: ${filePath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to save PDF to ${filePath}:`, error);
      
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EACCES') {
        throw new Error(`Permission denied writing to directory: ${dirPath}`);
      }
      if (nodeError.code === 'ENOSPC') {
        throw new Error(`No space left on device: ${dirPath}`);
      }
      throw new Error(`Failed to save PDF: ${errorMessage}`);
    }
  }
}

export async function generateInvoice(
  invoiceData: InvoiceData,
  outputDir?: string
): Promise<GenerateInvoiceResult> {
  const generator = new InvoiceGenerator(invoiceData, outputDir);
  return generator.generateInvoicePDF();
}