import { InvoiceData } from '../../types';

export interface PdfGenerator {
  generate(invoiceData: InvoiceData): Promise<PdfResult>;
}

export interface PdfResult {
  buffer: Buffer;
  filePath: string;
  metadata: PdfMetadata;
}

export interface PdfMetadata {
  source: 'B1SL' | 'S4_ODATA' | 'LOCAL';
  layoutName: string;
  jobId?: string;
  generationTimeMs: number;
  sapDocEntry: number;
  timestamp: string;
}

export interface SapPdfConfig {
  type: 'B1' | 'S4HANA';
  baseUrl: string;
  reportPath?: string;
  outputTemplateId?: string;
}

export class SapPdfError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly docEntry: number,
    public readonly jobId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SapPdfError';
  }
}

export class SapAuthenticationError extends SapPdfError {
  constructor(docEntry: number, cause?: Error) {
    super('SAP authentication failed', 'AUTH_FAILED', docEntry, undefined, cause);
    this.name = 'SapAuthenticationError';
  }
}

export class SapReportFailedError extends SapPdfError {
  constructor(docEntry: number, jobId: string, reason: string, cause?: Error) {
    super(`Report generation failed: ${reason}`, 'REPORT_FAILED', docEntry, jobId, cause);
    this.name = 'SapReportFailedError';
  }
}

export class SapOutputDeterminationError extends SapPdfError {
  constructor(docEntry: number, outputId: string, reason: string, cause?: Error) {
    super(`Output determination failed: ${reason}`, 'OUTPUT_DETERMINATION_FAILED', docEntry, outputId, cause);
    this.name = 'SapOutputDeterminationError';
  }
}

export class SapPollingTimeoutError extends SapPdfError {
  constructor(docEntry: number, jobId: string, cause?: Error) {
    super('Polling timeout waiting for PDF generation', 'POLLING_TIMEOUT', docEntry, jobId, cause);
    this.name = 'SapPollingTimeoutError';
  }
}

export class SapConnectionError extends SapPdfError {
  constructor(docEntry: number, cause?: Error) {
    super('Cannot connect to SAP server', 'CONNECTION_FAILED', docEntry, undefined, cause);
    this.name = 'SapConnectionError';
  }
}