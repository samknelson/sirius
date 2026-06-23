import { z } from "zod";
import { logger } from "../../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { denormPluginRegistry } from "./registry";

export * from "./types";
export { denormPluginRegistry, registerDenormPlugin, getDenormPlugin } from "./registry";

let kindRegistered = false;
function registerDenormKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "denorm",
    registry: denormPluginRegistry,
    label: "Denorm",
    description:
      "Denormalization plugins that keep a precomputed copy of an entity's data in sync in response to events.",
    // Managing denorm plugins is admin-only infrastructure, mirroring cron.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  // Denorm configs carry no relational dimension, so the base envelope is the
  // whole config — no subsidiary table.
  registerPluginConfigAdapter({
    pluginKind: "denorm",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginKind: "denorm",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
    // Denorm plugins are singletons, so the boot-time seeder needs a default
    // flat config to insert when a plugin has no row yet.
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
 * Initialize the denorm plugin system: register the kind + adapter. Plugins
 * self-register via the side-effect imports at the bottom of this file.
 */
export function initializeDenormPluginSystem(): void {
  registerDenormKind();
  logger.info("Denorm plugins registered", {
    service: "denorm-plugins",
    plugins: denormPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/workerEmployment";
