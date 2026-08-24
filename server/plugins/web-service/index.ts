import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { webServiceRegistry } from "./registry";

export {
  webServiceRegistry,
  registerWebServicePlugin,
  findWebServiceOperation,
} from "./registry";
export * from "./types";

let kindRegistered = false;

function registerWebServiceKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "web-service",
    registry: webServiceRegistry,
    label: "Web Services",
    description:
      "Externally callable services. Each configuration is an independently enable-able web service addressed at /api/ws/<configuration>/<operation>.",
    // Web service configuration is admin-only infrastructure, exactly like the
    // clients and credentials that call it.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    // Resolve the manifest's `enabled` flag from the unified `plugin_configs`
    // store. A plugin may back several configurations; the canonical one for
    // the manifest flag is the first by (ordering, id) — matching the other
    // multi-instance kinds.
    decorateEntries: async (entries) => {
      const { storage } = await import("../../storage");
      const configs = await storage.pluginConfigs.getByKind("web-service");
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
      return entries.map((entry) => ({
        ...entry,
        enabled: firstByPlugin.get(entry.id)?.enabled ?? false,
      }));
    },
    // Validate a configuration's editable settings against the plugin's own
    // JSON schema. `alias` is an envelope field the adapter folds into `data`,
    // so it is stripped before the impl's schema sees the payload.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../lib/json-schema-validator"
      );
      const { alias: _alias, ...rest } = (config ?? {}) as Record<string, unknown>;
      const result = validateAgainstSchema(plugin.configSchema, rest);
      return { valid: result.valid, errors: result.errors };
    },
  });

  // Web service configurations are multi-instance and carry one kind-level
  // field beyond the base envelope: an optional `alias`.
  //
  // A configuration is addressed by its `plugin_configs.id`, which is minted
  // per database — so the id of a component-managed configuration differs in
  // every environment. The alias is the portable, environment-independent
  // second address for the same record. It is deliberately NOT unique-checked
  // at save time; the dispatcher refuses an ambiguous alias at call time
  // (folded into its single indistinguishable refusal), because an alias that
  // stops resolving is a routing problem, not a data-integrity one.
  //
  // The alias rides in the base `data` blob rather than a subsidiary table:
  // it's a scalar with no relational dimension, and no listing filters on it.
  registerPluginConfigAdapter({
    pluginKind: "web-service",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      // Blank / whitespace-only means "no alias" so an emptied field clears it
      // rather than minting an unaddressable empty-string alias.
      alias: z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? null : v),
        z
          .string()
          .trim()
          .regex(
            /^[a-z0-9][a-z0-9_.-]*$/,
            'Alias must be lowercase letters, digits, "_", "." or "-", starting with a letter or digit',
          )
          .nullable()
          .optional(),
      ),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
    }),
    toRows: (input) => {
      const dataObj =
        input.data && typeof input.data === "object"
          ? (input.data as Record<string, unknown>)
          : {};
      // The generic admin page sends `alias` as a top-level envelope field
      // (RJSF strips it from `data` since it isn't in the impl JSON Schema);
      // a programmatic caller may instead send it on `data`.
      const rawAlias =
        typeof input.alias === "string"
          ? input.alias
          : typeof dataObj.alias === "string"
            ? (dataObj.alias as string)
            : null;
      const alias = rawAlias && rawAlias.trim() !== "" ? rawAlias.trim() : null;
      return {
        base: {
          pluginKind: "web-service",
          pluginId: input.pluginId,
          enabled: input.enabled,
          name: input.name,
          ordering: input.ordering,
          data: { ...dataObj, alias },
        },
      };
    },
    // Lift `data.alias` back to the top-level flat shape the admin form sends,
    // so read -> PATCH round-trips.
    hydrate: (envelope) => {
      const base = { ...envelope.config } as Record<string, unknown>;
      const data = (base.data ?? {}) as Record<string, unknown>;
      return { ...base, alias: typeof data.alias === "string" ? data.alias : null };
    },
    envelopeFields: [
      {
        name: "alias",
        label: "Alias",
        type: "string",
        // Optional: a configuration is always reachable by its id. The alias
        // is the stable address that survives a database rebuild.
      },
    ],
  });

  kindRegistered = true;
}

/**
 * Kind-level registration + startup log. Plugins have already self-registered
 * via the side-effect imports at the bottom of this file by the time this
 * runs.
 */
export function initializeWebServiceSystem(): void {
  registerWebServiceKind();
  logger.info("Web service plugins registered", {
    service: "web-service",
    plugins: webServiceRegistry.listIds(),
  });
}

// --- Plugin registration list (one side-effect import per plugin) ---------
import "./plugins/edls-sheet-export";
