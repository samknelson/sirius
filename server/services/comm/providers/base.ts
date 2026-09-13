export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ServiceProvider {
  readonly id: string;
  readonly displayName: string;
  readonly category: 'email';
  readonly supportedFeatures: string[];
  
  configure(config: unknown): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  getConfiguration(): Promise<Record<string, unknown>>;
}