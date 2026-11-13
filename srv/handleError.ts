// file: src/services/handleError.ts

import { dispatchLogService, DispatchLogEntry } from './dispatchLogService';
import { InvoiceData } from '../types';

export enum InvoiceErrorType {
  MISSING_EMAIL = 'MISSING_EMAIL',
  INVALID_EMAIL = 'INVALID_EMAIL',
  MISSING_LAYOUT = 'MISSING_LAYOUT',
  PDF_GENERATION_FAILED = 'PDF_GENERATION_FAILED',
  PDF_SAVE_FAILED = 'PDF_SAVE_FAILED',
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
  ALREADY_SENT = 'ALREADY_SENT',
  ALREADY_PROCESSED = 'ALREADY_PROCESSED',
  INVALID_DATA = 'INVALID_DATA',
  SAP_ERROR = 'SAP_ERROR',
  UNKNOWN = 'UNKNOWN'
}

export interface InvoiceError {
  type: InvoiceErrorType;
  message: string;
  docEntry?: number;
  invoiceData?: InvoiceData;
  cause?: Error;
}

export interface HandleErrorOptions {
  throwAfterLog?: boolean;
  includeInvoiceData?: boolean;
  context?: Record<string, any>;
}

export interface HandleErrorResult {
  success: false;
  error: string;
  type: InvoiceErrorType;
  docEntry?: number;
  invoiceData?: InvoiceData;
}

export async function handleError(
  error: InvoiceError,
  options: HandleErrorOptions = {}
): Promise<HandleErrorResult> {
  const context = options.context ?? {};

  if (error.docEntry !== undefined) {
    await dispatchLogService.updateEntry(error.docEntry, {
      status: 'ERROR',
      errorMessage: `[${error.type}] ${error.message}${error.cause ? ` (Cause: ${error.cause.message})` : ''}`,
      ...context,
    });
  } else {
    await dispatchLogService.logEntry({
      docEntry: error.docEntry ?? 0,
      status: 'ERROR',
      errorMessage: `[${error.type}] ${error.message}${error.cause ? ` (Cause: ${error.cause.message})` : ''}`,
      invoiceData: error.invoiceData,
      ...context,
    } as DispatchLogEntry);
  }

  if (options.throwAfterLog) {
    throw error.cause ?? new Error(`[${error.type}] ${error.message}`);
  }

  const result: HandleErrorResult = {
    success: false,
    error: error.message,
    type: error.type,
  };

  if (error.docEntry !== undefined) {
    result.docEntry = error.docEntry;
  }

  if (options.includeInvoiceData && error.invoiceData) {
    result.invoiceData = error.invoiceData;
  }

  return result;
}


export function validateEmail(
  email: string | undefined,
  docEntry: number,
  invoiceData?: InvoiceData
): InvoiceError | null {
  if (!email || email.trim() === '') {
    return {
      type: InvoiceErrorType.MISSING_EMAIL,
      message: 'Missing contractor email address',
      docEntry,
      invoiceData,
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return {
      type: InvoiceErrorType.INVALID_EMAIL,
      message: `Invalid contractor email address: ${email}`,
      docEntry,
      invoiceData,
    };
  }

  return null;
}