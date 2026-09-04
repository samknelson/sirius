import { z } from "zod";
import { logger } from "../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import {
  quicksearchPluginRegistry,
  resolveQuicksearchSchema,
  resolveQuicksearchUiSchema,
  validateQuicksearchSettings,
} from "./registry";

export {
  quicksearchPluginRegistry,
  registerQuicksearchPlugin,
} from "./registry";
export {
  runQuicksearch,
  userHasQuicksearch,
  QUICKSEARCH_RESULT_LIMIT,
  QUICKSEARCH_BUDGET_MS,
} from "./runner";
export type * from "./types";

let kindRegistered = false;
function registerQuicksearchKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "quicksearch",
    registry: quicksearchPluginRegistry,
    label: "Quicksearch",
    description:
      "Record types a user can search from anywhere in the app, and the roles each search is offered to.",
    // The manifest drives the administrative configuration page only — the
    // search itself never reads it — so it is administrator-only.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.name.localeCompare(b.name),
    // Attach each searcher's settings form so the generic plugin-config admin
    // UI can render it against a config row's `data`.
    decorateEntries: async (entries) =>
      Promise.all(
        entries.map(async (entry) => {
          const plugin = quicksearchPluginRegistry.get(entry.id);
          if (!plugin) return entry;
          return {
            ...entry,
            configSchema: await resolveQuicksearchSchema(plugin),
            uiSchema: await resolveQuicksearchUiSchema(plugin),
          };
        }),
      ),
    validateConfig: async (plugin, config) => validateQuicksearchSettings(plugin, config),
  });

  // Every quicksearch configuration names the roles it is offered to, and that
  // list IS the access decision: a user holding any of those roles may see any
  // record the searcher returns, with no per-record check afterwards. So the
  // field is required, an empty array is rejected on save, and there is
  // deliberately no "everyone" option — an administrator has to say who.
  registerPluginConfigAdapter({
    pluginKind: "quicksearch",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      roles: z.array(z.string().min(1)).min(1),
    }),
    searchParamsSchema: z
      .object({
        ...baseSearchSchemaShape,
        // The envelope field is named `roles`, so the generic filter bar sends
        // `roles=<roleId>`; map it onto the storage `role` contains-filter.
        roles: z.string().optional(),
        role: z.string().optional(),
        roleIn: z.array(z.string()).optional(),
      })
      .transform(({ roles, ...rest }) => ({
        ...rest,
        ...(roles !== undefined ? { role: roles } : {}),
      })),
    toRows: (input) => ({
      base: {
        pluginKind: "quicksearch",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        roles: input.roles,
      },
    }),
    envelopeFields: [
      {
        name: "roles",
        label: "Offered to roles",
        type: "string",
        required: true,
        filterable: true,
        multiple: true,
        options: {
          endpoint: "/api/admin/roles",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
  });
  kindRegistered = true;
}

/**
 * Initialize the quicksearch plugin system.
 *
 * There is intentionally NO default configuration seeding. A config's roles
 * decide who may see the records its searcher returns, and no default can
 * guess that — so quicksearch stays dark until an administrator creates a
 * configuration and names the roles. Users with no configuration get no search
 * button rather than a box that can only say "no results".
 */
export function initializeQuicksearchPluginSystem(): void {
  registerQuicksearchKind();
  logger.info("Quicksearch plugins registered", {
    service: "quicksearch",
    plugins: quicksearchPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/worker";
import "./plugins/grievance";
import "./plugins/edls-sheet";
