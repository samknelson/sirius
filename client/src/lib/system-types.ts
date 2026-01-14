export type SystemMode = "dev" | "test" | "live";

export interface SystemModeResponse {
  mode: SystemMode;
}

export interface SiteSettings {
  siteName: string;
  siteTitle: string;
  footer: string;
}

export interface WinstonLog {
  id: number;
  level: string | null;
  message: string | null;
  timestamp: string | null;
  source: string | null;
  meta: Record<string, unknown> | null;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  description: string | null;
}
