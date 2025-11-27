import type { 
  PluginContext, 
  PluginExecutionResult, 
  ChargePluginMetadata,
  TriggerType,
  LedgerEntryVerification,
} from "./types";
import type { ChargePluginConfig, Ledger } from "@shared/schema";

export abstract class ChargePlugin {
  abstract readonly metadata: ChargePluginMetadata;

  abstract execute(
    context: PluginContext,
    config: ChargePluginConfig
  ): Promise<PluginExecutionResult>;

  abstract verifyEntry(
    entry: Ledger,
    config: ChargePluginConfig
  ): Promise<LedgerEntryVerification>;

  canHandle(trigger: TriggerType): boolean {
    return this.metadata.triggers.includes(trigger);
  }

  validateSettings(settings: any): { valid: boolean; errors?: string[] } {
    if (!this.metadata.settingsSchema) {
      return { valid: true };
    }

    const result = this.metadata.settingsSchema.safeParse(settings);
    if (result.success) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: result.error.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`),
    };
  }
}
