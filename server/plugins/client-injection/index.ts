import { z } from "zod";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { clientInjectionRegistry, resolveClientInjections } from "./registry";

export { clientInjectionRegistry, registerClientInjection } from "./registry";
export type * from "./types";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;

let kindRegistered = false;
function registerClientInjectionKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "client-injection",
    registry: clientInjectionRegistry,
    label: "Client Injections",
    // Editing what scripts/styles render in every visitor's browser is an
    // admin-only capability, so the manifest + generic CRUD routes are gated
    // on the admin policy (mirrors charge / dispatch-eligibility). The public
    // resolved-manifest endpoint below stays auth-only so non-admins still get
    // their injections.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    // Resolve the manifest's `enabled` flag and the per-impl settings form
    // schema from the unified `plugin_configs` store. A plugin may have several
    // rows; the canonical one for the manifest flag is the first by
    // (ordering, id) — matching the dashboard kind.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const configs = await storage.pluginConfigs.getByKind("client-injection");
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
        const impl = clientInjectionRegistry.get(entry.id);
        return {
          ...entry,
          enabled: row ? row.enabled : false,
          configSchema: impl?.configSchema,
          uiSchema: impl?.uiSchema,
        };
      });
    },
    // Validate a unified plugin_configs `data` payload against the impl's own
    // JSON schema (when it declares one). Impls without a schema (e.g. the
    // Weglot init, whose output is fully computed) accept any data.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../lib/json-schema-validator"
      );
      const result = validateAgainstSchema(plugin.configSchema, config ?? {});
      return { valid: result.valid, errors: result.errors };
    },
  });
  // Client-injection configs carry no relational dimensions, so they live
  // entirely in the base table — the adapter declares no subsidiary. The
  // editable injection fields (slot/kind/src/code/attrs) ride in `data`.
  registerPluginConfigAdapter({
    pluginKind: "client-injection",
    configSchema: z.object({ ...baseConfigSchemaShape }),
    searchParamsSchema: z.object({ ...baseSearchSchemaShape }),
    toRows: (input) => ({
      base: {
        pluginKind: "client-injection",
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
 * Initialize the client-injection plugin system.
 *
 * Plugins self-register at module top level. The side-effect imports at the
 * bottom of this file load each plugin once and trigger its
 * `registerClientInjection(...)` call. To add a new plugin: drop a file
 * under `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * (This matches the convention used by every other plugin kind in the
 * repo — see `server/plugins/_core/README.md` → "Plugin registration
 * convention".)
 */
export function initializeClientInjectionPluginSystem(): void {
  registerClientInjectionKind();
  logger.info("Client-injection plugins registered", {
    service: "client-injection-plugins",
    plugins: clientInjectionRegistry.listIds(),
  });
}

/**
 * Public resolved-manifest endpoint. Registered BEFORE the generic
 * `/api/plugins/:kind/manifest` dispatcher so this handler intercepts the
 * `client-injection` kind's `/resolved` path and returns the grouped,
 * fully-resolved `{ head, bodyEnd }` shape that `<ServerInjections />`
 * consumes. Unlike the admin manifest/CRUD routes, this endpoint is only
 * auth-gated so every authenticated visitor receives their injections.
 */
export function registerClientInjectionManifestRoute(
  app: Express,
  requireAuth: AuthMiddleware,
): void {
  app.get(
    "/api/plugins/client-injection/resolved",
    requireAuth,
    async (req, res) => {
      try {
        const resolved = await resolveClientInjections(req);
        res.setHeader("Cache-Control", "no-store");
        res.json(resolved);
      } catch (error) {
        logger.error("Failed to resolve client injections", {
          service: "client-injection-plugins",
          error: error instanceof Error ? error.message : String(error),
        });
        res
          .status(500)
          .json({ message: "Failed to resolve client injections" });
      }
    },
  );
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/weglot-sdk";
import "./plugins/weglot-init";
import "./plugins/custom-css-inline";
import "./plugins/custom-css-href";
import "./plugins/custom-js-inline";
import "./plugins/custom-js-href";
