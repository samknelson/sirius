import { z } from 'zod';

export type ServiceCategory = 'sms' | 'email' | 'postal';

export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ServiceProvider {
  readonly id: string;
  readonly displayName: string;
  readonly category: ServiceCategory;
  readonly supportedFeatures: string[];
  
  configure(config: unknown): Promise<void>;
  testConnection(): Promise<ConnectionTestResult>;
  getConfiguration(): Promise<Record<string, unknown>>;
}

export interface ProviderFactory<T extends ServiceProvider> {
  create(): T;
}

export interface CategoryConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  enabled: boolean;
  settings: Record<string, unknown>;
}

export const categoryConfigSchema = z.object({
  defaultProvider: z.string(),
  providers: z.record(z.object({
    enabled: z.boolean(),
    settings: z.record(z.unknown()),
  })),
});

export function getConfigKey(category: ServiceCategory): string {
  return `service_config:${category}`;
}
