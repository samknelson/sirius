import type { BasePluginMetadata } from "../_core/types";
import type { JsonSchema } from "@shared/json-schema-form";

/**
 * A worker-list plugin configures one aspect of the /workers list surface.
 * Each plugin is a singleton: its one `plugin_configs` row IS the setting
 * (seeded at boot, edited via the settings page, never duplicated/deleted).
 */
export interface WorkerListPlugin {
  metadata: BasePluginMetadata;
  /** JSON Schema for the plugin's settings (rendered by SchemaForm). */
  configSchema: JsonSchema;
}

/** How the Membership column renders. */
export type MembershipDisplayMode = "member-status" | "authorization";

/**
 * The membership-column plugin's settings payload (the config row's `data`).
 * All fields optional: an empty/default config preserves today's behavior
 * exactly (member-status badge + last dues from the btu-dues-allocation
 * account).
 */
export interface MembershipColumnSettings {
  displayMode?: MembershipDisplayMode;
  /** Ledger account used for balance + last-payment lookups. */
  accountId?: string;
  /**
   * Cardcheck definitions that count as a withholding authorization. Empty
   * means ANY signed cardcheck counts (matches the member-status scan).
   */
  cardcheckDefinitionIds?: string[];
}
