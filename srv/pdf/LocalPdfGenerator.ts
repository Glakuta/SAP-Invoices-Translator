import fs from 'fs';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import handlebars from 'handlebars';
import cds from '@sap/cds';
import { translateInvoice } from '../translationService';
import { InvoiceData } from '../../types';
import { PdfGenerator, PdfResult, PdfMetadata } from './PdfGenerator';

const logger = cds.log('pdf:local');

export class LocalPdfGenerator implements PdfGenerator {
  private browser: Browser | null = null;

  constructor(private outputDir: string = 'output') {}

  async generate(invoiceData: InvoiceData): Promise<PdfResult> {
    const start = Date.now();
    const docEntry = invoiceData.docEntry || invoiceData.docNum || 0;
    const correlationId = `pdf-local-${docEntry}-${Date.now()}`;
    let page: any = null;

    try {
      logger.info(`[${correlationId}] Starting local PDF generation`, { docEntry });

      const translatedData = await translateInvoice(invoiceData);

      const templateHtml = this.loadTemplate();
      const template = handlebars.compile(templateHtml);
      const html = template(translatedData);

      logger.info(`[${correlationId}] Template rendered, launching browser`);
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      page = await this.browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });

      logger.info(`[${correlationId}] Generating PDF`);
      const pdfUint8Array = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
        printBackground: true,
      });

      await page.close();
      page = null;
      await this.browser.close();
      this.browser = null;

      const pdfBuffer = Buffer.from(pdfUint8Array);
      const filePath = this.buildFilePath(invoiceData);
      await this.savePdf(pdfBuffer, filePath);

      const metadata: PdfMetadata = {
        source: 'LOCAL',
        layoutName: 'invoiceTemplate.html (Handlebars + Puppeteer)',
        generationTimeMs: Date.now() - start,
        sapDocEntry: docEntry,
        timestamp: new Date().toISOString(),
      };

      logger.info(`[${correlationId}] PDF generated successfully`, {
        filePath,
        size: pdfBuffer.length,
        generationTimeMs: metadata.generationTimeMs,
      });

      return { buffer: pdfBuffer, filePath, metadata };
    } catch (error) {
      if (page) {
        try {
          await page.close();
        } catch {
          // ignore
        }
      }
      if (this.browser) {
        try {
          await this.browser.close();
        } catch {
          // ignore
        }
        this.browser = null;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[${correlationId}] Error generating PDF:`, {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

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
    const templatePath = path.join(process.cwd(), 'templates', 'invoiceTemplate.html');
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

  private buildFilePath(invoiceData: InvoiceData): string {
    const year = new Date().getFullYear().toString();
    const cardCode = invoiceData.cardCode || 'UNKNOWN';
    const docNum = invoiceData.docNum || invoiceData.docEntry || 'UNKNOWN';
    const docEntry = invoiceData.docEntry || invoiceData.docNum || 'UNKNOWN';

    const dirPath = path.join(this.outputDir, year, cardCode);
    const fileName = `${docNum}_${docEntry}.pdf`;

    return path.join(dirPath, fileName);
  }

  private async savePdf(pdfBuffer: Buffer, filePath: string): Promise<void> {
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