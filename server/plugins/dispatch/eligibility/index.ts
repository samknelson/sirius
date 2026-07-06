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
    label: "Dispatch Eligibility",
    description:
      "Rules that determine which workers are eligible for dispatch jobs.",
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
    pluginKind: "dispatch-eligibility",
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
        pluginKind: "dispatch-eligibility",
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
    envelopeFields: [
      {
        name: "jobType",
        label: "Job Type",
        type: "string",
        filterable: true,
        // `jobType` stores a dispatch job-type id (matched against a job's
        // jobTypeId at eligibility time). Render as a dropdown populated from
        // the dispatch job-types lookup so the filter shows readable names.
        options: {
          endpoint: "/api/options/dispatch-job-type",
          valueKey: "id",
          labelKey: "name",
        },
      },
    ],
  });
  kindRegistered = true;
}

/**
 * Initialize the dispatch-eligibility plugin system (READ side).
 *
 * Registers the `dispatch-eligibility` plugin kind + config adapter (needed by
 * the eligibility query path and the admin config UI), and loads the read-side
 * plugins via the side-effect imports at the bottom of this file (each triggers
 * its `registerDispatchEligPlugin(...)` call). To add a new plugin: drop a file
 * under `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * The WRITE side — maintaining the `worker_dispatch_elig_denorm` facts these
 * conditions read — now lives in the denorm plugin framework
 * (`server/plugins/system/denorm/plugins/dispatch/*`), so there is no longer a
 * boot-time backfill/recompute loop here; population happens through the denorm
 * event handlers plus the hourly denorm backfill/stale sweep.
 */
export function initializeDispatchEligSystem(): void {
  registerDispatchEligKind();
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });
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
