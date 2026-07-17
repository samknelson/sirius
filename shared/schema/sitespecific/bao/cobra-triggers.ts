/**
 * COBRA trigger configuration for the BAO component.
 *
 * Declares which eligibility-plugin failure reasons should open a COBRA
 * case when a medical/dental benefit is terminated by a WMB scan. The
 * config is stored in the `bao_cobra_trigger_config` variable (jsonb) and
 * edited from the COBRA config area — no dedicated table.
 *
 * Per plugin:
 *   - `trigger`: whether a termination attributed to this plugin's failed
 *     eligibility should open a COBRA case. Failure-to-pay-premium style
 *     plugins are excluded by default (COBRA does not apply when coverage
 *     is lost for non-payment).
 *   - `qualifyingEventId`: optional mapping to an
 *     options_bao_cobra_qualifying_event row stamped onto auto-created
 *     cases when this plugin is the (first) qualifying failure reason.
 */

import { z } from "zod";

export const BAO_COBRA_TRIGGER_CONFIG_VARIABLE = "bao_cobra_trigger_config";

export const baoCobraTriggerPluginConfigSchema = z.object({
  trigger: z.boolean(),
  qualifyingEventId: z.string().nullable().optional(),
});

export const baoCobraTriggerConfigSchema = z.object({
  /** Keyed by eligibility plugin id. Plugins absent from the map use the default. */
  plugins: z.record(z.string(), baoCobraTriggerPluginConfigSchema).default({}),
});

export type BaoCobraTriggerPluginConfig = z.infer<
  typeof baoCobraTriggerPluginConfigSchema
>;
export type BaoCobraTriggerConfig = z.infer<typeof baoCobraTriggerConfigSchema>;

/**
 * Plugins whose id or name suggests a failure-to-pay-premium reason are
 * excluded by default; everything else triggers by default.
 */
const NON_TRIGGER_DEFAULT_RE = /pay|premium/i;

export function defaultTriggerForPlugin(pluginId: string, pluginName?: string): boolean {
  return !(
    NON_TRIGGER_DEFAULT_RE.test(pluginId) ||
    (pluginName ? NON_TRIGGER_DEFAULT_RE.test(pluginName) : false)
  );
}

/** Resolve the effective per-plugin setting (configured or default). */
export function resolveTriggerForPlugin(
  config: BaoCobraTriggerConfig | null | undefined,
  pluginId: string,
  pluginName?: string,
): BaoCobraTriggerPluginConfig {
  const configured = config?.plugins?.[pluginId];
  if (configured) return configured;
  return {
    trigger: defaultTriggerForPlugin(pluginId, pluginName),
    qualifyingEventId: null,
  };
}

/** One row of the merged view the config screen renders. */
export interface BaoCobraTriggerConfigRow {
  pluginId: string;
  pluginName: string;
  pluginDescription: string;
  trigger: boolean;
  qualifyingEventId: string | null;
  isDefault: boolean;
}
