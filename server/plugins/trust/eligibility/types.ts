import { z } from "zod";
import type { Worker } from "@shared/schema";

export type ScanType = "start" | "continue";

export const baseEligibilityConfigSchema = z.object({
  appliesTo: z.array(z.enum(["start", "continue"])).min(1, "Must apply to at least one scan type"),
});

export type BaseEligibilityConfig = z.infer<typeof baseEligibilityConfigSchema>;

export interface EligibilityContext {
  scanType: ScanType;
  workerId: string;
  getWorker: () => Promise<Worker>;
  asOfMonth: number;
  asOfYear: number;
  benefitId?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

export interface EligibilityPluginMetadata {
  id: string;
  name: string;
  description: string;
  configSchema: z.ZodSchema;
  requiresComponent?: string;
}

export interface EligibilityRule {
  pluginKey: string;
  appliesTo: ScanType[];
  config: Record<string, unknown>;
}

export interface PolicyEligibilityRules {
  [benefitId: string]: EligibilityRule[];
}
