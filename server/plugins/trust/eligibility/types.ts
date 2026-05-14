import { z } from "zod";
import type { Worker, Contact } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";

export type ScanType = "start" | "continue";

/**
 * Rule-level shape (the editor's outer panel) — `appliesTo` is set on
 * each rule via the rule editor UI, not via the plugin config form,
 * so it stays out of the per-plugin JSON Schema.
 */
export const baseEligibilityConfigSchema = z.object({
  appliesTo: z.array(z.enum(["start", "continue"])).min(1, "Must apply to at least one scan type"),
});

export type BaseEligibilityConfig = z.infer<typeof baseEligibilityConfigSchema>;

export interface EligibilityContext {
  scanType: ScanType;
  workerId: string;
  getWorker: () => Promise<Worker>;
  getContact: () => Promise<Contact | null>;
  asOfMonth: number;
  asOfYear: number;
  benefitId?: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Per-plugin metadata returned to the UI. `configSchema` is a JSON
 * Schema describing the plugin-specific config object (without the
 * rule-level `appliesTo` field, which is edited separately). Defaults
 * come from `default` on each property and are applied automatically
 * by both the form renderer and the AJV validator.
 */
export interface EligibilityPluginMetadata {
  id: string;
  name: string;
  description: string;
  configSchema: JsonSchema;
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
