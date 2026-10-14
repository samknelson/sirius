/**
 * Real independent process. All data lives in a parent-created disposable
 * schema; no bootstrap, jobs, notifications or public configuration writes.
 */
import { pool } from "../../../server/storage/db";
import { ConfigurationCoherency } from "../../../server/services/configuration-coherency";
import { readConfigurationRevisions, readConfigurationSnapshot } from "../../../server/storage/configuration-revisions";
import { runOutsideTransaction, runInTransaction, getClient } from "../../../server/storage/transaction-context";
import { sql } from "drizzle-orm";

const namespace = process.argv[2];
if (!/^config_test_[a-f0-9]+$/.test(namespace)) throw new Error("Expected an isolated configuration test schema");
pool.options.options = `-c search_path=${namespace}`;

const { refreshEnvOverrides, getEnvOverrideMap } = await import("../../../server/services/env-overrides");
const { loadTerminology, getCachedTerminology } = await import("../../../server/modules/terminology");
const { armMaintenanceEnforcement, refreshMaintenanceFlag, isMaintenanceActive } = await import("../../../server/services/maintenance-mode");
const { invalidateAllPluginConfigCaches, getEnabledConfigsForKind } = await import("../../../server/plugins/_core/plugin-config-cache");
const { allowInMaintenanceMode } = await import("../../../server/storage/maintenance");

await armMaintenanceEnforcement();
const coherency = new ConfigurationCoherency(readConfigurationRevisions, runOutsideTransaction, () => {});
coherency.register({ id: "plugins", scopes: ["plugins"], invalidate: invalidateAllPluginConfigCaches });
coherency.register({ id: "environment", scopes: ["environment"], refresh: refreshEnvOverrides });
coherency.register({ id: "terminology", scopes: ["terminology"], refresh: async () => { await loadTerminology(); } });
coherency.register({ id: "maintenance", scopes: ["maintenance"], refresh: () => refreshMaintenanceFlag(false) });

async function state() {
  return {
    env: Object.fromEntries(getEnvOverrideMap()),
    maintenance: isMaintenanceActive(),
    terminology: getCachedTerminology(),
    plugins: (await getEnabledConfigsForKind("event-notifier")).map(row => ({
      name: row.config.name, data: row.config.data, media: (row.subsidiary as { media?: string })?.media,
    })),
  };
}

process.on("message", async (message: { id: number; command: string }) => {
  try {
    let response: unknown;
    if (message.command === "stop") {
      await pool.end();
      process.send?.({ id: message.id, response: "stopped" }, () => process.exit(0));
      return;
    }
    if (message.command === "poll") await coherency.poll();
    if (message.command === "timeout") {
      await readConfigurationSnapshot(() => getClient().execute(sql`SELECT pg_sleep(10)`));
    }
    if (message.command === "ambient") {
      await runInTransaction(async () => {
        await getClient().execute(sql`UPDATE variables SET value = '"uncommitted"'::jsonb WHERE name = 'ENV_COHERENCY_TEST'`);
        await coherency.poll(); // MUST read committed data outside this transaction.
        response = await state();
        throw new Error("intentional rollback");
      }).catch(error => { if (error.message !== "intentional rollback") throw error; });
    } else if (message.command === "escape") {
      await allowInMaintenanceMode(async () => {
        await getClient().execute(sql`UPDATE variables SET value = '"live"'::jsonb WHERE name = 'system_mode'`);
      });
      await coherency.poll();
    }
    response ??= await state();
    process.send?.({ id: message.id, response });
  } catch (error) {
    process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
process.send?.({ ready: true });
