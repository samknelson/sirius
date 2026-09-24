import { z } from "zod";
import { logger } from "../../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { dataRetentionPluginRegistry } from "./registry";

export * from "./types";
export {
  dataRetentionPluginRegistry,
  registerDataRetentionPlugin,
  getDataRetentionPlugin,
} from "./registry";
export {
  runDataRetention,
  type DataRetentionSummary,
  type DataRetentionPluginResult,
  type RunDataRetentionOptions,
} from "./sweep";

let kindRegistered = false;
function registerDataRetentionKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "data-retention",
    registry: dataRetentionPluginRegistry,
    label: "Data Retention",
    description:
      "Retention plugins that delete expired rows from their domain. All enabled plugins run under the single data-retention sweep cron job.",
    // Managing retention plugins is admin-only infrastructure, mirroring cron.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  // Retention configs carry no relational dimension, so the base envelope is
  // the whole config — no subsidiary table (mirrors denorm).
  registerPluginConfigAdapter({
    pluginKind: "data-retention",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginKind: "data-retention",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
    // Retention plugins are singletons, so the boot-time seeder needs a
    // default flat config to insert when a plugin has no row yet.
    seedDefault: (plugin) => {
      const p = plugin as { metadata: { id: string; name: string } };
      return {
        pluginId: p.metadata.id,
        name: p.metadata.name,
        enabled: true,
        ordering: 0,
        data: {},
      };
    },
  });
  kindRegistered = true;
}

/**
 * Initialize the data-retention plugin system: register the kind + adapter.
 * Plugins self-register via the side-effect imports at the bottom of this file.
 */
export function initializeDataRetentionPluginSystem(): void {
  registerDataRetentionKind();
  logger.info("Data-retention plugins registered", {
    service: "data-retention-plugins",
    plugins: dataRetentionPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/expiredHfe";
import "./plugins/expiredEba";
import "./plugins/expiredFloodEvents";
import "./plugins/oldCronLogs";
import "./plugins/expiredReports";
import "./plugins/edlsSheetSnapshots";
