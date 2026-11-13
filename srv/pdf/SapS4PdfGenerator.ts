import axios, { AxiosInstance, AxiosError } from "axios";
import cds from "@sap/cds";
import fs from "fs";
import path from "path";
import { InvoiceData } from "../../types";
import {
  PdfGenerator,
  PdfResult,
  PdfMetadata,
  SapPdfConfig,
  SapAuthenticationError,
  SapOutputDeterminationError,
  SapPollingTimeoutError,
  SapConnectionError,
} from "./PdfGenerator";

export const logger = cds.log("pdf:s4odata");

interface S4OutputResponse {
  OutputId: string;
  Status: "NEW" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  ErrorMessage?: string;
}

export class SapS4PdfGenerator implements PdfGenerator {
  private readonly client: AxiosInstance;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(private config: SapPdfConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 60000,
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
    const correlationId = `pdf-s4-${docEntry}-${Date.now()}`;

    logger.info(`[${correlationId}] Starting S/4HANA PDF generation`, {
      docEntry,
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
        source: "S4_ODATA",
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

  private async ensureAuthenticated(
    correlationId: string,
    docEntry: number,
  ): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return;
    }

    logger.info(`[${correlationId}] Authenticating with S/4HANA OAuth`);

    try {
      const tokenUrl = `${this.config.baseUrl}/oauth/token`;
      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SAP_S4_CLIENT_ID || "sb-invoices-translator",
        client_secret: process.env.SAP_S4_CLIENT_SECRET || "",
      });

      const response = await axios.post(tokenUrl, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 30000,
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry =
        Date.now() + (response.data.expires_in || 3600) * 1000 - 60000;

      logger.info(`[${correlationId}] OAuth authentication successful`);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (
        axiosError.response?.status === 401 ||
        axiosError.response?.status === 403
      ) {
        throw new SapAuthenticationError(
          docEntry,
          error instanceof Error ? error : undefined,
        );
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
      throw new SapAuthenticationError(
        docEntry,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async requestOutputGeneration(
    docEntry: number,
    correlationId: string,
  ): Promise<string> {
    const outputTemplate = this.config.outputTemplateId || "ZINV_01";

    logger.info(`[${correlationId}] Requesting output generation`, {
      docEntry,
      outputTemplate,
    });

    try {
      const response = await this.client.post<S4OutputResponse>(
        "/sap/opu/odata/sap/API_BILLING_DOC_OUTPUT_MGMT/BillingDocumentOutput",
        {
          BillingDocument: docEntry.toString(),
          OutputType: "PDF",
          OutputTemplate: outputTemplate,
          OutputParameter: {
            Language: "EN",
          },
        },
        { headers: this.getAuthHeaders() },
      );

      const outputId = response.data.OutputId;
      logger.info(`[${correlationId}] Output generation requested`, {
        outputId,
      });
      return outputId;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        this.accessToken = null;
        await this.ensureAuthenticated(correlationId, docEntry);
        return this.requestOutputGeneration(docEntry, correlationId);
      }
      throw error;
    }
  }

  private async pollAndGetPdf(
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
      const delay = Math.min(baseDelay * Math.pow(1.3, attempt - 1), 15000);

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
          if (
            errorMsg.toLowerCase().includes("template") ||
            errorMsg.toLowerCase().includes("determination")
          ) {
            throw new SapOutputDeterminationError(docEntry, outputId, errorMsg);
          }
          throw new SapOutputDeterminationError(docEntry, outputId, errorMsg);
        }

        await this.sleep(delay);
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          this.accessToken = null;
          await this.ensureAuthenticated(correlationId, docEntry);
          continue;
        }
        if (error instanceof SapOutputDeterminationError) {
          throw error;
        }
        throw error;
      }
    }

    throw new SapPollingTimeoutError(docEntry, outputId);
  }

  private async downloadPdf(
    outputId: string,
    correlationId: string,
    docEntry: number,
  ): Promise<Buffer> {
    logger.info(`[${correlationId}] Downloading PDF`, { outputId });

    try {
      const response = await this.client.get(
        `/sap/opu/odata/sap/API_BILLING_DOC_OUTPUT_MGMT/BillingDocumentOutput('${outputId}')/GetPdf`,
        {
          headers: this.getAuthHeaders(),
          responseType: "arraybuffer",
        },
      );

      return Buffer.from(response.data);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
        this.accessToken = null;
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

  private buildFilePath(invoiceData: InvoiceData): string {
    const year = new Date().getFullYear().toString();
    const cardCode = invoiceData.cardCode || "UNKNOWN";
    const docNum = invoiceData.docNum || invoiceData.docEntry || "UNKNOWN";
    const docEntry = invoiceData.docEntry || invoiceData.docNum || "UNKNOWN";

    const outputDir = process.env.PDF_OUTPUT_DIR || "output";
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
      await this.ensureAuthenticated("test", 0);
      return true;
    } catch {
      return false;
    }
  }
}
