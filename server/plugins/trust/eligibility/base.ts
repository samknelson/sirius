import type {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "./types";
import { baseEligibilityConfigSchema } from "./types";
import { validateAgainstSchema } from "../../../lib/json-schema-validator";

/**
 * Base class for trust eligibility plugins. Each subclass declares its
 * own JSON Schema-typed metadata; `validateConfig` checks both the
 * rule-level shape (appliesTo) and the plugin-specific config against
 * the metadata's JSON Schema via AJV.
 */
export abstract class EligibilityPlugin<TConfig extends BaseEligibilityConfig = BaseEligibilityConfig> {
  abstract readonly metadata: EligibilityPluginMetadata;

  abstract evaluate(
    context: EligibilityContext,
    config: TConfig
  ): Promise<EligibilityResult>;

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const baseResult = baseEligibilityConfigSchema.safeParse(config);
    if (!baseResult.success) {
      return {
        valid: false,
        errors: baseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
      };
    }
    const pluginResult = validateAgainstSchema(this.metadata.configSchema, config);
    if (!pluginResult.valid) {
      return { valid: false, errors: pluginResult.errors };
    }
    return { valid: true };
  }

  appliesToScanType(config: BaseEligibilityConfig, scanType: "start" | "continue"): boolean {
    return config.appliesTo.includes(scanType);
  }

  /**
   * How many months AFTER a given hours month this rule's outcome can still
   * depend on it, derived from this rule's configuration. For example, a rule
   * that reads hours N months prior to the evaluated month returns N, because
   * an hours change in month M can flip eligibility for month M+N. Plugins
   * that never read worker hours keep the default of 0.
   *
   * Consumed by the WMB auto-rescan service to decide which later months to
   * re-queue after an hours edit. Over-reporting is safe (extra rescans);
   * under-reporting silently misses rescans — when a bound is uncertain,
   * report the conservative (larger) value.
   */
  hoursForwardImpactMonths(_config: TConfig): number {
    return 0;
  }
}
