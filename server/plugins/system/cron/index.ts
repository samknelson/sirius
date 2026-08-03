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
    // Validate a config's editable `data` payload against the plugin's own JSON
    // schema (when it declares one) when the generic admin Edit modal saves.
    // The cron envelope keeps `schedule`/`enabled` as first-class fields outside
    // `data`, so there is nothing to strip before validating — `config` here is
    // exactly the per-job settings object.
    validateConfig: async (plugin, config) => {
      if (!plugin.configSchema) return { valid: true };
      const { validateAgainstSchema } = await import(
        "../../../lib/json-schema-validator"
      );
      const result = validateAgainstSchema(
        plugin.configSchema,
        (config ?? {}) as Record<string, unknown>,
      );
      if (!result.valid) return { valid: false, errors: result.errors };
      // Optional plugin-level cross-field validation (e.g. "weekly requires
      // day_of_week") that JSON Schema alone cannot express.
      if (plugin.validateSettings) {
        const settingsResult = plugin.validateSettings(
          (config ?? {}) as Record<string, unknown>,
        );
        if (!settingsResult.valid) return settingsResult;
      }
      // Derive-schedule plugins: the stored schedule is computed from the
      // friendly settings, so unschedulable settings must reject the save
      // rather than persist a stale/meaningless schedule.
      if (plugin.deriveSchedule) {
        try {
          plugin.deriveSchedule((config ?? {}) as Record<string, unknown>);
        } catch (error) {
          return {
            valid: false,
            errors: [
              `Cannot derive a schedule from these settings: ${error instanceof Error ? error.message : String(error)}`,
            ],
          };
        }
      }
      return { valid: true };
    },
  });
  // Cron configs hoist the cron `schedule` into a real subsidiary column
  // (`plugin_configs_cron.schedule`) so it is a first-class, filterable envelope
  // field rather than buried in `data`. The editable per-job settings ride in
  // `data`.
  registerPluginConfigAdapter({
    pluginKind: "cron",
    configSchema: z
      .object({
        ...baseConfigSchemaShape,
        // Optional at the schema level: derive-schedule plugins compute it
        // from settings, so the client no longer sends it for them. The
        // superRefine below keeps it required for every other plugin.
        schedule: z.string().optional(),
      })
      .superRefine((val, ctx) => {
        const plugin = cronPluginRegistry.get(val.pluginId);
        if (plugin?.deriveSchedule) return;
        if (!val.schedule || !val.schedule.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["schedule"],
            message: "schedule is required",
          });
        }
      }),
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
      schedule: z.string().optional(),
    }),
    toRows: (input) => {
      // Derive-schedule plugins: the stored `schedule` column mirrors the cron
      // expression derived from the friendly settings, so list surfaces and
      // the /cron-jobs viewer display what the scheduler will actually run.
      // A derivation failure falls back to the incoming/default schedule here
      // only because the kind's `validateConfig` (which runs right after
      // toRows on every create/update) rejects those settings with a 400 —
      // the fallback value is never persisted.
      let schedule = input.schedule ?? "";
      const plugin = cronPluginRegistry.get(input.pluginId);
      if (plugin?.deriveSchedule) {
        try {
          schedule = plugin.deriveSchedule(
            (input.data ?? {}) as Record<string, unknown>,
          ).schedule;
        } catch {
          schedule = input.schedule ?? plugin.defaultSchedule;
        }
      }
      return {
        base: {
          pluginKind: "cron",
          pluginId: input.pluginId,
          enabled: input.enabled,
          name: input.name,
          ordering: input.ordering,
          data: input.data,
        },
        subsidiary: {
          schedule,
        },
      };
    },
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
      const p = plugin as {
        metadata: { id: string; name: string };
        defaultSchedule: string;
        defaultEnabled: boolean;
        getDefaultSettings?: () => Record<string, unknown>;
        deriveSchedule?: (settings: Record<string, unknown>) => { schedule: string };
      };
      // Derive-schedule plugins seed their default settings and the schedule
      // derived from them, so the stored column is accurate from day one.
      const data = p.deriveSchedule ? (p.getDefaultSettings?.() ?? {}) : {};
      let schedule = p.defaultSchedule;
      if (p.deriveSchedule) {
        try {
          schedule = p.deriveSchedule(data).schedule;
        } catch {
          // Fall back to the declared default; the scheduler re-derives at
          // run time and the next save reconciles the stored column.
        }
      }
      return {
        pluginId: p.metadata.id,
        name: p.metadata.name,
        enabled: p.defaultEnabled,
        ordering: 0,
        data,
        schedule,
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
// NOTE: the five legacy cleanup jobs (delete-expired-hfe, delete-expired-reports,
// delete-expired-flood-events, dispatch-eba-cleanup, delete-old-cron-logs) were
// consolidated into data-retention plugins swept by the single dataRetention cron.
import "./plugins/dataRetention";
import "./plugins/processWmbBatch";
import "./plugins/scheduledBenefitScan";
import "./plugins/sweepExpiredBanElig";
import "./plugins/workerBanActiveScan";
import "./plugins/workerCertificationActiveScan";
import "./plugins/logCleanup";
import "./plugins/memberStatusScan";
import "./plugins/ledgerChargeCron";
import "./plugins/baoCobraBilling";
import "./plugins/baoDpBilling";
import "./plugins/baoCobraStatusScan";
import "./plugins/baoCobraCaseReconcile";
import "./plugins/dispatchJobPoll";
import "./plugins/bulkDeliver";
import "./plugins/t631DispatchJobGroupFetch";
import "./plugins/t631FacilityFetch";
import "./plugins/t631TosFetch";
import "./plugins/t631WorkerFetch";
import "./plugins/gbhetPensionSlaReconcile";
import "./plugins/gbhetPensionSharesReconcile";
import "./plugins/denormBackfill";
import "./plugins/denormStale";
import "./plugins/ebsPump";
import "./plugins/fileConsistencySweep";
