import axios, { AxiosInstance, AxiosError } from 'axios';
import cds from '@sap/cds';
import fs from 'fs';
import path from 'path';
import {
  PdfGenerator,
  PdfResult,
  PdfMetadata,
  SapPdfConfig,
  SapAuthenticationError,
  SapReportFailedError,
  SapPollingTimeoutError,
  SapConnectionError,
} from './PdfGenerator';
import { InvoiceData } from '../../types';
import { SapB1AuthProvider } from '../auth/SapB1AuthProvider';

const logger = cds.log('pdf:b1sl');

interface B1ReportJobResponse {
  JobId: string;
}

interface B1ReportStatusResponse {
  Status: 'Pending' | 'Running' | 'Ready' | 'Failed' | 'Canceled';
  ContentUrl?: string;
  ErrorMessage?: string;
}

export class SapB1PdfGenerator implements PdfGenerator {
  private authProvider: SapB1AuthProvider;
  private client: ReturnType<typeof axios.create>;

  constructor(private config: SapPdfConfig) {
    this.client = axios.create({
    baseURL: config.baseUrl,
    timeout: 60000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
    
    this.authProvider = new SapB1AuthProvider(
    { baseUrl: config.baseUrl },
    this.client
  );
  }

  

  async generate(invoiceData: InvoiceData): Promise<PdfResult> {
    const start = Date.now();
    const docEntry = invoiceData.docEntry!;
    const correlationId = `pdf-b1-${docEntry}-${Date.now()}`;

    logger.info(`[${correlationId}] Starting B1SL PDF generation`, {
      docEntry,
      reportPath: this.config.reportPath,
    });

    try {
      await this.authProvider.ensureAuthenticated(correlationId, docEntry);

      const jobId = await this.submitReportJob(docEntry, correlationId);
      const contentUrl = await this.pollJobCompletion(jobId, correlationId, docEntry);
      const pdfBuffer = await this.downloadPdf(contentUrl, correlationId, docEntry);

      const filePath = this.buildFilePath(invoiceData);
      await this.savePdf(pdfBuffer, filePath);

      const metadata: PdfMetadata = {
        source: 'B1SL',
        layoutName: this.config.reportPath || 'SalesInvoice.rpt',
        jobId,
        generationTimeMs: Date.now() - start,
        sapDocEntry: docEntry,
        timestamp: new Date().toISOString(),
      };

      logger.info(`[${correlationId}] PDF generated successfully`, {
        filePath,
        size: pdfBuffer.length,
        layoutName: metadata.layoutName,
        generationTimeMs: metadata.generationTimeMs,
      });

      return { buffer: pdfBuffer, filePath, metadata };
    } catch (error) {
      logger.error(`[${correlationId}] PDF generation failed`, {
        docEntry,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  } 

  private async submitReportJob(docEntry: number, correlationId: string): Promise<string> {
    const reportPath = this.config.reportPath || 'SalesInvoice.rpt';

    logger.info(`[${correlationId}] Submitting report job`, { docEntry, reportPath });

    try {
      const response = await this.client.post<B1ReportJobResponse>(
        '/b1s/v1/Reports',
        {
          ReportPath: reportPath,
          Params: { DocEntry: docEntry },
          OutputType: 'PDF',
        },
        { headers: this.authProvider.getAuthHeaders() }
      );

      const jobId = response.data.JobId;
      logger.info(`[${correlationId}] Report job submitted`, { jobId });
      return jobId;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        this.authProvider.invalidate();
        await this.authProvider.ensureAuthenticated(correlationId, docEntry);
        return this.submitReportJob(docEntry, correlationId);
      }
      throw error;
    }
  }

  private async pollJobCompletion(
    jobId: string,
    correlationId: string,
    docEntry: number
  ): Promise<string> {
    const maxAttempts = 30;
    const baseDelay = 2000;
    let attempt = 0;

    logger.info(`[${correlationId}] Polling report job`, { jobId });

    while (attempt < maxAttempts) {
      attempt++;
      const delay = Math.min(baseDelay * Math.pow(1.2, attempt - 1), 10000);

      try {
        const response = await this.client.get<B1ReportStatusResponse>(
          `/b1s/v1/Reports('${jobId}')`,
          { headers: this.authProvider.getAuthHeaders() }
        );

        const status = response.data.Status;
        logger.debug(`[${correlationId}] Poll attempt ${attempt}/${maxAttempts}`, { jobId, status });

        if (status === 'Ready') {
          if (!response.data.ContentUrl) {
            throw new SapReportFailedError(docEntry, jobId, 'Job ready but no ContentUrl returned');
          }
          logger.info(`[${correlationId}] Report job completed`, { jobId, contentUrl: response.data.ContentUrl });
          return response.data.ContentUrl;
        }

        if (status === 'Failed' || status === 'Canceled') {
          throw new SapReportFailedError(
            docEntry,
            jobId,
            response.data.ErrorMessage || `Job ${status.toLowerCase()}`
          );
        }

        await this.sleep(delay);
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          this.authProvider.invalidate();
          await this.authProvider.ensureAuthenticated(correlationId, docEntry);
          continue;
        }
        if (error instanceof SapReportFailedError) {
          throw error;
        }
        throw error;
      }
    }

    throw new SapPollingTimeoutError(docEntry, jobId);
  }

  private async downloadPdf(contentUrl: string, correlationId: string, docEntry: number): Promise<Buffer> {
    logger.info(`[${correlationId}] Downloading PDF`, { contentUrl });

    try {
      const response = await this.client.get(contentUrl, {
        headers: this.authProvider.getAuthHeaders(),
        responseType: 'arraybuffer',
      });

      return Buffer.from(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        this.authProvider.invalidate();
        await this.authProvider.ensureAuthenticated(correlationId, docEntry);
        return this.downloadPdf(contentUrl, correlationId, docEntry);
      }
      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        throw new SapConnectionError(docEntry, error instanceof Error ? error : undefined);
      }
      throw new SapReportFailedError(docEntry, '', 'Failed to download PDF', error instanceof Error ? error : undefined);
    }
  }

  private buildFilePath(invoiceData: InvoiceData): string {
    const year = new Date().getFullYear().toString();
    const cardCode = invoiceData.cardCode || 'UNKNOWN';
    const docNum = invoiceData.docNum || invoiceData.docEntry || 'UNKNOWN';
    const docEntry = invoiceData.docEntry || invoiceData.docNum || 'UNKNOWN';

    const outputDir = process.env.PDF_OUTPUT_DIR || 'output';
    const dirPath = path.join(outputDir, year, cardCode);
    const fileName = `${docNum}_${docEntry}.pdf`;

    return path.join(dirPath, fileName);
  }

  private async savePdf(pdfBuffer: Buffer, filePath: string): Promise<void> {
    const dirPath = path.dirname(filePath);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
    }

    fs.writeFileSync(filePath, pdfBuffer);
    logger.info(`PDF saved to: ${filePath}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authProvider.ensureAuthenticated('test', 0);
      return true;
    } catch {
      return false;
    }
  }
}