import { z } from "zod";
import { logger } from "../../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { dispatchEligPluginRegistry } from "./registry";

export {
  dispatchEligPluginRegistry,
  registerDispatchEligPlugin,
} from "./registry";

let kindRegistered = false;
function registerDispatchEligKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "dispatch-eligibility",
    registry: dispatchEligPluginRegistry,
    // Mirror legacy auth on /api/dispatch-eligibility-plugins:
    // requireComponent("dispatch") + requireAccess("admin").
    requiredComponent: "dispatch",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Backs POST /api/plugins/dispatch-eligibility/:id/validate-config.
    // Validates the supplied config against the plugin's JSON Schema.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import("../../../lib/json-schema-validator");
      const result = validateAgainstSchema(plugin.configSchema, config);
      if (result.valid) return { valid: true };
      return { valid: false, errors: result.errors ?? ["Invalid configuration"] };
    },
  });
  registerPluginConfigAdapter({
    pluginType: "dispatch-eligibility",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      jobType: z.string().nullable().optional(),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      jobType: z.string().nullable().optional(),
    }),
    toRows: (input) => ({
      base: {
        pluginType: "dispatch-eligibility",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        jobType: input.jobType ?? null,
      },
    }),
  });
  kindRegistered = true;
}

/**
 * Initialize the dispatch-eligibility plugin system.
 *
 * Plugins self-register at module top level — the side-effect imports at
 * the bottom of this file load each plugin once and trigger its
 * `registerDispatchEligPlugin(...)` call. To add a new plugin: drop a
 * file under `./plugins/` and add one `import "./plugins/<name>"` line
 * below.
 *
 * After registration, this function runs startup backfills for plugins
 * that declare a `backfill()` (in `backfillOrder` ascending). The
 * backfill loop is intentionally kept here (not per-plugin) because it
 * is an orchestration concern, not a registration concern.
 *
 * (This matches the convention used by every other plugin kind in the
 * repo — see `server/plugins/_core/README.md` → "Plugin registration
 * convention".)
 */
export async function initializeDispatchEligSystem(): Promise<void> {
  registerDispatchEligKind();
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });

  const plugins = dispatchEligPluginRegistry.getAllPlugins()
    .filter(p => p.backfill)
    .sort((a, b) => (a.backfillOrder ?? 0) - (b.backfillOrder ?? 0));

  for (const plugin of plugins) {
    try {
      const result = await plugin.backfill!();
      if (result.workersProcessed > 0) {
        logger.info(`${plugin.name} eligibility backfill completed during startup`, {
          service: "dispatch-elig-plugins",
          pluginId: plugin.id,
          workersProcessed: result.workersProcessed,
          entriesCreated: result.entriesCreated,
        });
      }
    } catch (error) {
      logger.error(`Failed to backfill ${plugin.name} eligibility during startup`, {
        service: "dispatch-elig-plugins",
        pluginId: plugin.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/ban";
import "./plugins/dnc";
import "./plugins/eba";
import "./plugins/hfe";
import "./plugins/skill";
import "./plugins/status";
import "./plugins/ws";
import "./plugins/singleshift";
import "./plugins/accepted";
import "./plugins/hta-home-employer";
