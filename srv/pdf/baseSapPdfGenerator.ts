import axios, { AxiosError, AxiosInstance } from "axios";
import cds from "@sap/cds";
import fs from "fs";
import path from "path";
import {
  PdfGenerator,
  PdfResult,
  PdfMetadata,
  SapPdfConfig,
  SapConnectionError,
  SapOutputDeterminationError,
  SapPollingTimeoutError,
} from "./PdfGenerator";
import { InvoiceData } from "../../types"

export const logger = cds.log("pdf:base");

export interface S4OutputResponse {
  OutputId: string;
  Status: "NEW" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  ErrorMessage?: string;
}

export abstract class BaseSapPdfGenerator implements PdfGenerator {
  protected readonly client: AxiosInstance;
  protected readonly config: SapPdfConfig;


  protected abstract readonly source: string;

  /** Loguje się (jeśli trzeba) i cache'uje token/sesję. */
  protected abstract ensureAuthenticated(
    correlationId: string,
    docEntry: number,
  ): Promise<void>;

  /** Nagłówki autoryzacyjne do zwykłych requestów. */
  protected abstract getAuthHeaders(): Record<string, string>;

  /** Wywołanie generowania outputu – zwraca OutputId. */
  protected abstract requestOutputGeneration(
    docEntry: number,
    correlationId: string,
  ): Promise<string>;

  /** URL/ścieżka do pobrania wygenerowanego PDF-a. */
  protected abstract getDownloadUrl(outputId: string): string;

  /** Reset tokenu po 401, żeby kolejne wywołanie się przeautoryzowało. */
  protected abstract clearAuth(): void;

  constructor(config: SapPdfConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 60_000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
          throw new SapConnectionError(0, error);
        }
        throw error;
      },
    );
  }

  async generate(invoiceData: InvoiceData): Promise<PdfResult> {
    const start = Date.now();
    const docEntry = invoiceData.docEntry!;
    const correlationId = `pdf-${docEntry}-${Date.now()}`;

    logger.info(`[${correlationId}] Starting PDF generation`, {
      docEntry,
      source: this.source,
      outputTemplate: this.config.outputTemplateId,
    });

    try {
      await this.ensureAuthenticated(correlationId, docEntry);

      const outputId = await this.requestOutputGeneration(
        docEntry,
        correlationId,
      );
      const pdfBuffer = await this.pollAndGetPdf(
        outputId,
        correlationId,
        docEntry,
      );

      const filePath = this.buildFilePath(invoiceData);
      await this.savePdf(pdfBuffer, filePath);

      const metadata: PdfMetadata = {
        source: this.source as PdfMetadata["source"],
        layoutName: this.config.outputTemplateId || "ZINV_01",
        jobId: outputId,
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
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  protected async pollAndGetPdf(
    outputId: string,
    correlationId: string,
    docEntry: number,
  ): Promise<Buffer> {
    const maxAttempts = 20;
    const baseDelay = 1500;
    let attempt = 0;

    logger.info(`[${correlationId}] Polling output status`, { outputId });

    while (attempt < maxAttempts) {
      attempt++;
      const delay = Math.min(baseDelay * Math.pow(1.3, attempt - 1), 15_000);

      try {
        const statusResponse = await this.client.get<S4OutputResponse>(
          `/sap/opu/odata/sap/API_BILLING_DOC_OUTPUT_MGMT/BillingDocumentOutput('${outputId}')`,
          { headers: this.getAuthHeaders() },
        );

        const status = statusResponse.data.Status;
        logger.debug(
          `[${correlationId}] Poll attempt ${attempt}/${maxAttempts}`,
          { outputId, status },
        );

        if (status === "COMPLETED") {
          return this.downloadPdf(outputId, correlationId, docEntry);
        }

        if (status === "FAILED") {
          const errorMsg =
            statusResponse.data.ErrorMessage || "Output generation failed";
          throw new SapOutputDeterminationError(docEntry, outputId, errorMsg);
        }

        await this.sleep(delay);
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          this.clearAuth();
          await this.ensureAuthenticated(correlationId, docEntry);
          continue;
        }
        if (error instanceof SapOutputDeterminationError) throw error;
        throw error;
      }
    }

    throw new SapPollingTimeoutError(docEntry, outputId);
  }

  protected async downloadPdf(
    outputId: string,
    correlationId: string,
    docEntry: number,
  ): Promise<Buffer> {
    const url = this.getDownloadUrl(outputId);
    logger.info(`[${correlationId}] Downloading PDF`, { outputId, url });

    try {
      const response = await this.client.get(url, {
        headers: this.getAuthHeaders(),
        responseType: "arraybuffer",
      });
      return Buffer.from(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        this.clearAuth();
        await this.ensureAuthenticated(correlationId, docEntry);
        return this.downloadPdf(outputId, correlationId, docEntry);
      }
      if (
        axiosError.code === "ECONNREFUSED" ||
        axiosError.code === "ENOTFOUND"
      ) {
        throw new SapConnectionError(
          docEntry,
          error instanceof Error ? error : undefined,
        );
      }
      throw new SapOutputDeterminationError(
        docEntry,
        outputId,
        "Failed to download PDF",
        error instanceof Error ? error : undefined,
      );
    }
  }

  protected buildFilePath(invoiceData: InvoiceData): string {
    const year = new Date().getFullYear().toString();
    const cardCode = invoiceData.cardCode || "UNKNOWN";
    const docNum = invoiceData.docNum || invoiceData.docEntry || "UNKNOWN";
    const docEntry = invoiceData.docEntry || invoiceData.docNum || "UNKNOWN";

    const outputDir = process.env.PDF_OUTPUT_DIR || "output";
    const dirPath = path.join(outputDir, year, cardCode);
    const fileName = `${docNum}_${docEntry}.pdf`;

    return path.join(dirPath, fileName);
  }

  protected async savePdf(buffer: Buffer, filePath: string): Promise<void> {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
    }
    fs.writeFileSync(filePath, buffer);
    logger.info(`PDF saved to: ${filePath}`);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.ensureAuthenticated("test", 0);
      return true;
    } catch {
      return false;
    }
  }
}