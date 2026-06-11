import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { eventNotifierRegistry } from "./registry";

export { eventNotifierRegistry, registerEventNotifier } from "./registry";
export type * from "./types";

let kindRegistered = false;
function registerEventNotifierKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "event-notifier",
    registry: eventNotifierRegistry,
    label: "Event Notifiers",
    description:
      "Listen to events on the event bus and send notifications via the comm send functions.",
    // Configuring which events fan out to which channels is admin-only
    // infrastructure, so the manifest + generic CRUD routes are gated on the
    // admin policy (mirrors client-injection / charge / trust-eligibility).
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    // Resolve the manifest's `enabled` flag and the per-impl settings form
    // schema from the unified `plugin_configs` store. A plugin may have several
    // rows; the canonical one for the manifest flag is the first by
    // (ordering, id) — matching client-injection / dashboard.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const configs =
        await storage.pluginConfigs.getByKind("event-notifier");
      const firstByPlugin = new Map<string, (typeof configs)[number]>();
      for (const c of configs) {
        const cur = firstByPlugin.get(c.pluginId);
        if (
          !cur ||
          c.ordering < cur.ordering ||
          (c.ordering === cur.ordering && c.id < cur.id)
        ) {
          firstByPlugin.set(c.pluginId, c);
        }
      }
      return entries.map((entry) => {
        const row = firstByPlugin.get(entry.id);
        const impl = eventNotifierRegistry.get(entry.id);
        return {
          ...entry,
          enabled: row ? row.enabled : false,
          configSchema: impl?.configSchema,
          uiSchema: impl?.uiSchema,
        };
      });
    },
    // Validate a unified plugin_configs `data` payload against the impl's own
    // JSON schema (when it declares one). Impls without a schema accept any data.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../lib/json-schema-validator"
      );
      const result = validateAgainstSchema(plugin.configSchema, config ?? {});
      return { valid: result.valid, errors: result.errors };
    },
  });
  // Event-notifier configs carry no relational dimensions, so they live
  // entirely in the base table — the adapter declares no subsidiary. The
  // editable settings ride in `data`.
  registerPluginConfigAdapter({
    pluginKind: "event-notifier",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginKind: "event-notifier",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
    }),
  });
  kindRegistered = true;
}

/**
 * Initialize the event-notifier plugin system.
 *
 * Plugins self-register at module top level. The side-effect imports at the
 * bottom of this file load each plugin once and trigger its
 * `registerEventNotifier(...)` call. To add a new plugin: drop a file under
 * `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * (This matches the convention used by every other plugin kind in the repo —
 * see `server/plugins/_core/README.md` → "Plugin registration convention".)
 */
export function initializeEventNotifierPluginSystem(): void {
  registerEventNotifierKind();
  logger.info("Event-notifier plugins registered", {
    service: "event-notifier-plugins",
    plugins: eventNotifierRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/example-notifier";
