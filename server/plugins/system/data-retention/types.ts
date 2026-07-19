import type { BasePluginMetadata } from "../../_core";

/**
 * Execution mode for a retention plugin's `cleanup`. `test` is a dry run: the
 * plugin reports what it WOULD delete without mutating anything. `live`
 * deletes and reports the actual per-row delete count.
 */
export type DataRetentionMode = "live" | "test";

/**
 * Result of one retention plugin's `cleanup` run. `count` is the number of
 * rows deleted (`live`) or that would be deleted (`test`); `message` is the
 * human summary the sweep folds into the cron run log.
 */
export interface DataRetentionResult {
  count: number;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * A data-retention plugin: colocates one domain's "what is expired" policy
 * with its deletion loop. Many small plugins, one sweep cron
 * (`data-retention` cron plugin) that runs them all.
 *
 * Contract:
 *   - `cleanup(mode)` finds the expired rows (typically via an inline
 *     read-only query — declare `needsReadOnlyDb: true` in metadata) and, in
 *     `live` mode, deletes them ONE ROW AT A TIME through the owning storage
 *     module's per-row delete method (never bulk delete-with-criteria SQL).
 *     In `test` mode it must not mutate anything.
 *   - `requiredComponent` gates the plugin exactly like other kinds; the
 *     sweep skips plugins whose component is off (their tables may not even
 *     exist for component-owned schemas).
 *
 * Retention plugins are singletons: one config row each, seeded at boot, and
 * the operator can disable an individual plugin from the generic plugin
 * admin page without touching the sweep cron.
 */
export interface DataRetentionPlugin {
  /** Base metadata. `id` is the stable identifier keying the config row. */
  metadata: BasePluginMetadata;
  /** Find expired rows and (in `live` mode) delete them per-row. */
  cleanup(mode: DataRetentionMode): Promise<DataRetentionResult>;
}

/** Manifest entry shape for data-retention plugins (base metadata only). */
export interface DataRetentionManifestEntry extends BasePluginMetadata {}
