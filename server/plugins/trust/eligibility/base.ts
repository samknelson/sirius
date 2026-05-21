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
}
