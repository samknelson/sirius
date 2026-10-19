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
    validateConfig: async (_plugin, data) => {
      const result = floodSettingsSchema.safeParse(data);
      return result.success ? { valid: true } :
        { valid: false, errors: result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`) };
    },
  });
  registerPluginConfigAdapter({
    pluginKind: "flood",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      enabled: z.boolean().optional().default(true),
      data: floodSettingsSchema,
    }),
    searchParamsSchema: z.object(baseSearchSchemaShape),
    toRows: input => ({ base: {
      pluginKind: "flood", pluginId: input.pluginId, name: input.name,
      enabled: input.enabled, ordering: input.ordering, siriusId: input.siriusId, data: input.data,
    } }),
    seedDefault: plugin => {
      const p = plugin as FloodPlugin;
      return { pluginId: p.id, name: p.name, enabled: true, ordering: 0, data: { ...p.defaults } };
    },
  });
  initialized = true;
}

import "./plugins/quicksearch";
import "./plugins/bookmark";
import "./plugins/local-login";
import "./plugins/local-password-change";
import "./plugins/edls-schedule-answer";
import "./plugins/t631-arrival";
import "./plugins/notifications";
