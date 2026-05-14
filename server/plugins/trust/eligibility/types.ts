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

/**
 * Optional subscriber→dependent relationship attached to an
 * EligibilityContext. When present, evaluation is happening from the
 * subscriber's point of view (the URL worker / `context.workerId`) for
 * a specific dependent worker. Plugins choose which side to read:
 *
 * - Plugins that care about the subscriber (cardcheck, work status,
 *   hours, etc.) keep reading `context.workerId` / `context.getWorker()`
 *   / `context.getContact()` — these always point at the subscriber, so
 *   no plugin change is needed for back-compat.
 * - Plugins that care about the dependent (e.g. ageout reads
 *   birth date) should opt in by reaching for
 *   `context.relationship?.getDependentContact() ?? context.getContact()`.
 *
 * When `relationship` is undefined (no relationship picked), the
 * subscriber and dependent are the same worker — today's behavior.
 */
export interface EligibilityRelationshipContext {
  subscriberWorkerId: string;
  dependentWorkerId: string;
  relationType: string;
  getSubscriberWorker: () => Promise<Worker>;
  getSubscriberContact: () => Promise<Contact | null>;
  getDependentWorker: () => Promise<Worker>;
  getDependentContact: () => Promise<Contact | null>;
}

export interface EligibilityContext {
  scanType: ScanType;
  /**
   * The subscriber's worker id. When no relationship is supplied this
   * is the worker being tested as an individual. When a relationship is
   * supplied, this is `relationship.subscriberWorkerId` — the URL
   * worker on the eligibility test page.
   */
  workerId: string;
  /** Returns the subscriber worker (= `workerId`). */
  getWorker: () => Promise<Worker>;
  /** Returns the subscriber's contact record. */
  getContact: () => Promise<Contact | null>;
  asOfMonth: number;
  asOfYear: number;
  benefitId?: string;
  /** Present when testing a dependent under this subscriber. */
  relationship?: EligibilityRelationshipContext;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  /**
   * Optional non-blocking warning. A plugin may return `eligible: true`
   * together with a `warning` string to indicate the worker passes the
   * rule but is in a flagged region (e.g. inside an inner band of the
   * eligible range). Consumers (UI, reports) should surface warnings
   * distinctly from outright failures.
   */
  warning?: string;
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
