import { z } from "zod";
import type { Worker, Contact, Employer } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import type { BasePluginMetadata } from "../../_core";

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
 * Context passed to every eligibility plugin. Both subscriber and
 * dependent worker + contact records are eagerly loaded by the executor
 * before plugins run, so plugins read them as plain fields rather than
 * via accessor functions. When no relationship is supplied, the
 * dependent fields are the same references as the subscriber fields.
 *
 * Each plugin must consciously choose which side it cares about:
 * - Plugins that care about the subscriber (cardcheck, work status,
 *   hours, manual, gbhet legal) read `subscriberWorker.id`.
 * - Plugins that care about the dependent (ageout reads birth date)
 *   read `dependentContact` and reference the dependent in their
 *   reasons when `relationship` is set.
 */
export interface EligibilityContext {
  scanType: ScanType;
  asOfMonth: number;
  asOfYear: number;
  benefitId?: string;
  /** Subscriber worker (the URL worker on the eligibility test page). */
  subscriberWorker: Worker;
  /** Subscriber's contact record, or null if the worker has no linked contact. */
  subscriberContact: Contact | null;
  /**
   * Dependent worker. Equal by reference to `subscriberWorker` when
   * `relationship` is undefined.
   */
  dependentWorker: Worker;
  /**
   * Dependent's contact record. Equal by reference to
   * `subscriberContact` when `relationship` is undefined.
   */
  dependentContact: Contact | null;
  /**
   * Present only when evaluating a dependent under a subscriber. Carries
   * the resolved relationship type from the active `worker_relations`
   * row on the as-of date.
   */
  relationship?: {
    subscriberWorkerId: string;
    dependentWorkerId: string;
    relationType: string;
  };
  /**
   * Subscriber's employer resolved once by the executor before any plugin
   * runs. It is the externally-supplied employer when one is provided to
   * the evaluation, otherwise the employer on the subscriber's trust
   * election active as of the evaluation date. Absent when neither yields
   * an employer; plugins that depend on it (e.g. BAO immediate
   * eligibility) must tolerate it being undefined rather than crash.
   */
  employer?: Employer;
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
export interface EligibilityPluginMetadata extends BasePluginMetadata {
  configSchema: JsonSchema;
}

export interface EligibilityRule {
  pluginKey: string;
  appliesTo: ScanType[];
  config: Record<string, unknown>;
}

export interface PolicyEligibilityRules {
  [benefitId: string]: EligibilityRule[];
}
