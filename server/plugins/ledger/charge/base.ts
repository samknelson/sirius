import type { 
  PluginContext, 
  PluginExecutionResult, 
  ChargePluginMetadata,
  TriggerType,
  LedgerEntryVerification,
} from "./types";
import type { ChargePluginConfig, Ledger } from "@shared/schema";
import { validateAgainstSchema } from "../../../lib/json-schema-validator";

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

  /**
   * Synchronous JSON-Schema validation of a settings payload against the
   * plugin's `metadata.configSchema`. Used by plugins on the hot
   * execution path (inside `execute()`), where a synchronous check is
   * convenient. Returns `{ valid: true }` when the plugin declares no
   * schema.
   */
  validateSettings(settings: unknown): { valid: boolean; errors?: string[] } {
    if (!this.metadata.configSchema) {
      return { valid: true };
    }
    return validateAgainstSchema(this.metadata.configSchema, settings);
  }

  /**
   * Validate a settings payload against the plugin's JSON Schema
   * (`metadata.configSchema`). This is the contract the generic plugin
   * admin layer calls (POST /api/plugins/charge/:id/validate-config and
   * the CRUD endpoints). Plugins with cross-field rules JSON Schema
   * can't express override this method, call `await super.validateConfig(...)`
   * first, and append their own errors. Async to match the eligibility
   * plugin contract.
   */
  async validateConfig(
    settings: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    return this.validateSettings(settings);
  }
}
