import { z } from "zod";
import { registerPluginKind } from "../../_core/kinds";
import {
  registerPluginConfigAdapter, baseConfigSchemaShape, baseSearchSchemaShape,
} from "../../_core/config-adapter";
import { floodPluginRegistry } from "./registry";
import { floodSettingsSchema, type FloodPlugin } from "./types";

export { floodPluginRegistry, registerFloodPlugin } from "./registry";
export type { FloodPlugin } from "./types";

let initialized = false;
export function initializeFloodPluginSystem(): void {
  if (initialized) return;
  registerPluginKind({
    kind: "flood", registry: floodPluginRegistry,
    label: "Flood Protection",
    description: "Rate limits for actions, authentication attempts and notifications.",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.name.localeCompare(b.name),
    validateConfig: async (plugin, data) => {
      const result = floodSettingsSchema.safeParse(data);
      if (!result.success) return {
        valid: false, errors: result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`),
      };
      return plugin.validateConfig ? plugin.validateConfig(data) : { valid: true };
    },
  });
  registerPluginConfigAdapter({
    pluginKind: "flood",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      enabled: z.boolean().optional().default(true),
      // Preserve plugin-specific fields; per-plugin validation runs after toRows.
      data: floodSettingsSchema.passthrough(),
    }),
    searchParamsSchema: z.object(baseSearchSchemaShape),
    toRows: input => ({ base: {
      pluginKind: "flood", pluginId: input.pluginId, name: input.name,
      enabled: input.enabled, ordering: input.ordering, siriusId: input.siriusId, data: input.data,
    }, subsidiary: {} }),
    seedDefault: plugin => {
      const p = plugin as FloodPlugin;
      if (!p.singleton) return null;
      return { pluginId: p.id, name: p.name, enabled: true, ordering: 0, data: { ...p.defaults } };
    },
  });
  initialized = true;
}

import "./plugins/quicksearch";
import "./plugins/bookmark";
import "./plugins/local-login";
import "./plugins/local-password-change";
import "./plugins/notifications";
import "./plugins/webclient-vendor-operation";
