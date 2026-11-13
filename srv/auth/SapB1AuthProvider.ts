import axios, { AxiosError, AxiosInstance } from "axios";
import {
  SapAuthenticationError,
  SapConnectionError,
} from "../pdf/PdfGenerator";
import { AuthProvider, AuthConfig } from "./authProvider";
import cds from "@sap/cds";

const logger = cds.log("pdf:b1sl");

export class SapB1AuthProvider implements AuthProvider {
  private readonly client: AxiosInstance;
  private sessionToken: string | null = null;
  private sessionExpiry: number = 0;

  constructor(private config: AuthConfig, _client: AxiosInstance) {
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
  async ensureAuthenticated(
    correlationId: string,
    docEntry: number,
  ): Promise<void> {
    if (this.sessionToken && Date.now() < this.sessionExpiry) {
      return;
    }

    logger.info(`[${correlationId}] Authenticating with SAP B1 Service Layer`);
    try {
      const response = await this.client.post("/b1s/v1/Login", {
        UserName: process.env.SAP_B1_USERNAME,
        Password: process.env.SAP_B1_PASSWORD,
        CompanyDB: process.env.SAP_B1_COMPANY_DB,
      });

      this.sessionToken = response.data.SessionId;
      this.sessionExpiry = Date.now() + 23 * 60 * 60 * 1000;

      logger.info(`[${correlationId}] Authentication successful`);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 401) {
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
  getAuthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.sessionToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }
  invalidate(): void {
    throw new Error("Method not implemented.");
  }
}
