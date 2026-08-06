import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { workerListPluginRegistry } from "./registry";

export * from "./types";
export { workerListPluginRegistry, registerWorkerListPlugin } from "./registry";
export { MEMBERSHIP_COLUMN_PLUGIN_ID } from "./plugins/membershipColumn";
export { getMembershipColumnSettings } from "./settings";

let kindRegistered = false;
function registerWorkerListKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "worker-list",
    registry: workerListPluginRegistry,
    label: "Worker List",
    description:
      "Settings for the worker list page, such as what the Membership column shows.",
    // Editing list-wide staff settings is admin configuration, mirroring the
    // other /config pages.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Validate a config's `data` payload against the plugin's own JSON schema
    // whenever the generic config routes save it.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../lib/json-schema-validator"
      );
      return validateAgainstSchema(
        plugin.configSchema,
        (config ?? {}) as Record<string, unknown>,
      );
    },
  });
  // Worker-list configs have no relational dimensions: everything lives in
  // the base row's `data` blob, so the adapter is base-only (like denorm).
  registerPluginConfigAdapter({
    pluginKind: "worker-list",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginKind: "worker-list",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
    // Worker-list plugins are singletons; the boot-time seeder creates the
    // single row with defaults that preserve today's behavior exactly
    // (member-status view, no account/definition overrides).
    seedDefault: (plugin) => {
      const p = plugin as { metadata: { id: string; name: string } };
      return {
        pluginId: p.metadata.id,
        name: p.metadata.name,
        enabled: true,
        ordering: 0,
        data: { displayMode: "member-status", cardcheckDefinitionIds: [] },
      };
    },
  });
  kindRegistered = true;
}

/**
 * Initialize the worker-list plugin system: register the kind + adapter.
 * Plugins self-register via the side-effect imports at the bottom.
 */
export function initializeWorkerListPluginSystem(): void {
  registerWorkerListKind();
  logger.info("Worker-list plugins registered", {
    service: "worker-list-plugins",
    plugins: workerListPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/membershipColumn";
