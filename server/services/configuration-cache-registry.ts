import { ConfigurationCoherency } from "./configuration-coherency";
import { readConfigurationRevisions } from "../storage/configuration-revisions";
import { runOutsideTransaction } from "../storage/transaction-context";
import { logger } from "../logger";

export const configurationCoherency = new ConfigurationCoherency(
  readConfigurationRevisions,
  runOutsideTransaction,
  error => logger.warn("Configuration refresh failed; retry pending", {
    service: "configuration-coherency", error: String(error),
  }),
);

let initialized = false;

/** Shared boot path for api-user AND api-ws. Executable work has explicit ownership. */
export async function initializeConfigurationCoherency(ownsCron: boolean): Promise<void> {
  if (initialized) return;
  const { loadComponentCache } = await import("./component/cache");
  const { invalidateAllPluginConfigCaches } = await import("../plugins/_core/plugin-config-cache");
  const { refreshEnvOverrides, invalidateEnvOverrideSnapshot } = await import("./env-overrides");
  const { loadTerminology, invalidateTerminologyCache } = await import("../modules/terminology");
  const { refreshMaintenanceFlag, invalidateMaintenanceSnapshot } = await import("./maintenance-mode");
  const { cronScheduler } = await import("../plugins/system/cron/scheduler");
  const { getReloadableSubsystem } = await import("./reload-registry");
  cronScheduler.setOwnership(ownsCron);

  // Preserve authoritative component reads on EVERY tick, including commit-only
  // changes, failure-closed gates, permission listeners and catalog revisions.
  configurationCoherency.register({
    id: "components", label: "Component state and derived gates", scopes: [], everyPoll: true,
    refresh: async () => { await loadComponentCache(); },
  });
  configurationCoherency.register({
    id: "plugin-configs", label: "Enabled plugin configuration caches", scopes: ["plugins"], invalidate: invalidateAllPluginConfigCaches,
  });
  configurationCoherency.register({
    id: "env-overrides", label: "Environment override map", scopes: ["environment"], invalidate: invalidateEnvOverrideSnapshot,
    refresh: refreshEnvOverrides,
  });
  configurationCoherency.register({
    id: "maintenance", label: "Maintenance enforcement", scopes: ["maintenance"], invalidate: invalidateMaintenanceSnapshot,
    refresh: () => refreshMaintenanceFlag(false),
  });
  configurationCoherency.register({
    id: "terminology", label: "Site terminology", scopes: ["terminology"], invalidate: invalidateTerminologyCache,
    refresh: async () => { await loadTerminology(); },
  });
  if (ownsCron) configurationCoherency.register({
    id: "cron", label: "Cron schedule", scopes: ["cron"], after: ["plugin-configs", "maintenance"],
    invalidate: () => cronScheduler.invalidateSnapshot(),
    refresh: async () => {
      // During maintenance-startup deferral this stays stopped. Exit starts it
      // through the existing named deferral, never from an api-ws process.
      if (cronScheduler.isStarted()) {
        await cronScheduler.reload();
        return cronScheduler.getScheduleSummary();
      }
      return "Cron startup is deferred in this process; no jobs started.";
    },
  });
  configurationCoherency.register({
    id: "filesystems", label: "Filesystem registry", scopes: [], after: ["env-overrides"],
    refresh: async () => { await getReloadableSubsystem("filesystems")!.reload(); },
  });
  initialized = true;
  // Refresh before serving; watcher remains read-capable in maintenance.
  await configurationCoherency.poll();
  configurationCoherency.start();
}

/** Import-safe from storage: registration/imports are deferred until boot. */
export function notifyLocalConfigurationCommit(): void {
  if (initialized) configurationCoherency.requestRefresh();
}
