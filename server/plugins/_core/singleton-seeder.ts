import { storage } from "../../storage";
import { runInTransaction } from "../../storage/transaction-context";
import { SingletonViolationError } from "../../storage/system/plugin-configs";
import { logger } from "../../logger";
import { listPluginKinds, getPluginKind } from "./kinds";
import { getPluginConfigAdapter } from "./config-adapter";

/**
 * Boot-time seeder for singleton plugin configs.
 *
 * Replaces the bespoke `bootstrapCronJobs()` with a generic pass over every
 * registered plugin kind. For each kind whose adapter implements
 * `seedDefault`, every plugin marked `metadata.singleton === true` that has no
 * `plugin_configs` row yet gets its single row created from the plugin's
 * defaults (split into base + subsidiary rows via the adapter's `toRows`, then
 * inserted in one transaction). Plugins that already have a row are skipped, so
 * this is safe to run on every boot and never overwrites operator edits.
 *
 * Runs AFTER the data migrations (which backfill pre-existing rows), so in
 * practice it only creates rows for singleton plugins that never had a legacy
 * config (e.g. a newly added cron job).
 */
export async function bootstrapSingletonPluginConfigs(): Promise<void> {
  logger.info("Bootstrapping singleton plugin configs", {
    service: "singleton-seeder",
  });

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const kind of listPluginKinds()) {
    const registration = getPluginKind(kind);
    const adapter = getPluginConfigAdapter(kind);
    if (!registration || !adapter?.seedDefault) continue;

    for (const plugin of registration.registry.list()) {
      const meta = registration.registry.getMetadata(plugin);
      if (!meta.singleton) continue;

      try {
        const existing = await storage.pluginConfigs.getByKindAndPlugin(kind, meta.id);
        if (existing.length > 0) {
          skipped++;
          continue;
        }

        const flat = adapter.seedDefault(plugin);
        if (!flat) {
          skipped++;
          continue;
        }

        const { base, subsidiary } = adapter.toRows(flat);
        // `siriusId` is a shared base dimension threaded by the generic routes;
        // mirror that here so seeded rows match route-created rows.
        base.siriusId = (flat as { siriusId?: string | null }).siriusId ?? null;

        await runInTransaction(async () => {
          // The storage layer reads singleton-ness from the plugin manifest
          // (this plugin is `meta.singleton`), so the create call no longer
          // needs an explicit flag.
          const row = await storage.pluginConfigs.create(base as any);
          if (subsidiary) {
            await storage.pluginConfigs.upsertSubsidiary(kind, {
              id: row.id,
              ...subsidiary,
            });
          }
        });

        logger.info(`Seeded singleton plugin config: ${meta.id}`, {
          service: "singleton-seeder",
          kind,
          pluginId: meta.id,
        });
        created++;
      } catch (error) {
        // A concurrent boot (autoscale) may have seeded the same singleton
        // between our pre-check and insert; the partial unique index turns the
        // loser's insert into a SingletonViolationError. That is the expected
        // outcome, not a failure — count it as skipped.
        if (error instanceof SingletonViolationError) {
          skipped++;
          continue;
        }
        logger.error(`Failed to seed singleton plugin config: ${meta.id}`, {
          service: "singleton-seeder",
          kind,
          pluginId: meta.id,
          error: error instanceof Error ? error.message : String(error),
        });
        errors++;
      }
    }
  }

  logger.info("Singleton plugin config bootstrap completed", {
    service: "singleton-seeder",
    created,
    skipped,
    errors,
  });
}
