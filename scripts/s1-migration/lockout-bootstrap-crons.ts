/**
 * Materialize every singleton cron configuration registered by the current
 * code, then force every cron configuration (singleton or operator-created)
 * disabled. A rerun never restores a plugin's defaultEnabled value.
 *
 * Usage: npx tsx scripts/s1-migration/lockout-bootstrap-crons.ts
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import {
  cronPluginRegistry,
  initializeCronPluginSystem,
} from "../../server/plugins/system/cron";
import { bootstrapSingletonPluginConfigs } from "../../server/plugins/_core/singleton-seeder";
import { acquireMigrationSeedLock } from "./lib/migration-lock";

async function main() {
  const lockClient = await acquireMigrationSeedLock(pool);
  try {
    initializeCronPluginSystem();
    await bootstrapSingletonPluginConfigs();

    const before = await storage.pluginConfigs.getByKind("cron");
    let disabled = 0;
    for (const config of before) {
      if (!config.enabled) continue;
      const updated = await storage.pluginConfigs.update(config.id, { enabled: false });
      if (!updated) throw new Error(`cron config disappeared while disabling: ${config.id}`);
      disabled++;
    }

    const singletonIds = cronPluginRegistry
      .list()
      .filter((plugin) => cronPluginRegistry.getMetadata(plugin).singleton === true)
      .map((plugin) => cronPluginRegistry.getMetadata(plugin).id)
      .sort();
    const errors: string[] = [];
    for (const pluginId of singletonIds) {
      const rows = await storage.pluginConfigs.getByKindAndPlugin("cron", pluginId);
      if (rows.length !== 1) {
        errors.push(`${pluginId}: expected one singleton config, found ${rows.length}`);
        continue;
      }
      const composed = await storage.pluginConfigs.getWithSubsidiary(rows[0].id);
      const schedule = (composed?.subsidiary as { schedule?: unknown } | null)?.schedule;
      if (typeof schedule !== "string" || schedule.trim() === "") {
        errors.push(`${pluginId}: missing cron schedule`);
      }
    }

    const finalRows = await storage.pluginConfigs.getByKind("cron");
    const enabledRows = finalRows.filter((config) => config.enabled);
    if (enabledRows.length > 0) {
      errors.push(`enabled cron configs remain: ${enabledRows.map((row) => row.pluginId).join(", ")}`);
    }
    if (errors.length > 0) {
      throw new Error(`cron lockout verification failed:\n${errors.join("\n")}`);
    }

    console.log(JSON.stringify({
      loader: "lockout-bootstrap-crons",
      singletonConfigs: singletonIds.length,
      totalCronConfigs: finalRows.length,
      disabledThisRun: disabled,
      enabledAfter: 0,
    }, null, 2));
  } finally {
    lockClient?.release();
  }
}

main()
  .then(async () => {
    await pool.end();
    console.log("DONE");
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
