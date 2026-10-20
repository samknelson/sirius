export interface FloodContext {
  userId?: string;
  ip?: string;
  [key: string]: any;
}

export type FloodCheckResult = {
  allowed: boolean;
  skipped?: false;
  count: number;
  threshold: number;
  windowSeconds: number;
  identifier: string;
  pluginConfigurationId: string;
} | {
  allowed: true;
  skipped: true;
  reason: "disabled" | "component-disabled";
};
