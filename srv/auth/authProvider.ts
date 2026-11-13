
export interface AuthProvider {
  ensureAuthenticated(correlationId: string, docEntry: number): Promise<void>;
  getAuthHeaders(): Record<string, string>;
  invalidate(): void;
}

export interface AuthConfig {
  baseUrl: string;
}