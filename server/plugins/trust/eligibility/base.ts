import type { 
  EligibilityContext, 
  EligibilityResult, 
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "./types";
import { baseEligibilityConfigSchema } from "./types";

export abstract class EligibilityPlugin<TConfig extends BaseEligibilityConfig = BaseEligibilityConfig> {
  abstract readonly metadata: EligibilityPluginMetadata;

  abstract evaluate(
    context: EligibilityContext,
    config: TConfig
  ): Promise<EligibilityResult>;

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const baseResult = baseEligibilityConfigSchema.safeParse(config);
    if (!baseResult.success) {
      return {
        valid: false,
        errors: baseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
    }

    const pluginResult = this.metadata.configSchema.safeParse(config);
    if (!pluginResult.success) {
      return {
        valid: false,
        errors: pluginResult.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`),
      };
    }

    return { valid: true };
  }

  appliesToScanType(config: BaseEligibilityConfig, scanType: "start" | "continue"): boolean {
    return config.appliesTo.includes(scanType);
  }
}
