import { z } from "zod";
import { logger } from "../../../logger";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { cronPluginRegistry } from "./registry";

export * from "./types";
export { cronPluginRegistry, registerCronPlugin, getCronPlugin, executeCronPlugin } from "./registry";

let kindRegistered = false;
function registerCronKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "cron",
    registry: cronPluginRegistry,
    label: "Cron Jobs",
    description:
      "Scheduled background jobs that run on a cron expression (for example nightly cleanups and periodic syncs).",
    // Managing scheduled jobs is admin-only infrastructure, mirroring the
    // legacy /api/cron-jobs routes which were all gated on the admin policy.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  // Cron configs hoist the cron `schedule` into a real subsidiary column
  // (`plugin_configs_cron.schedule`) so it is a first-class, filterable envelope
  // field rather than buried in `data`. The editable per-job settings ride in
  // `data`.
  registerPluginConfigAdapter({
    pluginKind: "cron",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      schedule: z.string().min(1, "schedule is required"),
    }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      schedule: z.string().optional(),
    }),
    toRows: (input) => ({
      base: {
        pluginKind: "cron",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        data: input.data,
      },
      subsidiary: {
        schedule: input.schedule,
      },
    }),
    envelopeFields: [
      {
        name: "schedule",
        label: "Schedule",
        type: "string",
        required: true,
        filterable: false,
      },
    ],
    // Cron plugins are singletons, so the boot-time seeder needs a default flat
    // config to insert when a plugin has no row yet. Pull the schedule and
    // enabled defaults off the plugin definition.
    seedDefault: (plugin) => {
      const p = plugin as { metadata: { id: string; name: string }; defaultSchedule: string; defaultEnabled: boolean };
      return {
        pluginId: p.metadata.id,
        name: p.metadata.name,
        enabled: p.defaultEnabled,
        ordering: 0,
        data: {},
        schedule: p.defaultSchedule,
      };
    },
  });
  kindRegistered = true;
}

/**
 * Initialize the cron plugin system: register the kind + adapter. Plugins
 * self-register via the side-effect imports at the bottom of this file.
 */
export function initializeCronPluginSystem(): void {
  registerCronKind();
  logger.info("Cron plugins registered", {
    service: "cron-plugins",
    plugins: cronPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/deleteExpiredReports";
import "./plugins/deleteOldCronLogs";
import "./plugins/processWmbBatch";
import "./plugins/deleteExpiredFloodEvents";
import "./plugins/deleteExpiredHfe";
import "./plugins/sweepExpiredBanElig";
import "./plugins/workerBanActiveScan";
import "./plugins/workerCertificationActiveScan";
import "./plugins/logCleanup";
import "./plugins/memberStatusScan";
import "./plugins/dispatchEbaCleanup";
import "./plugins/dispatchJobPoll";
import "./plugins/bulkDeliver";
import "./plugins/t631DispatchJobGroupFetch";
import "./plugins/t631FacilityFetch";
import "./plugins/t631TosFetch";
import "./plugins/gbhetPensionSlaReconcile";
import "./plugins/gbhetPensionSharesReconcile";
