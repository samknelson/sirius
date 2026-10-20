import { logger } from "../../logger";
import { withFrameworkWrite } from "../../middleware/request-context";
import { listPluginKinds, getPluginKind } from "./kinds";
import { getPluginConfigAdapter } from "./config-adapter";
import type { PluginConfig } from "@shared/schema";

/**
 * Lazy storage imports keep the storage → _core barrel boot chain cycle-safe.
 * Also used by runtime singleton defaults that now need a persisted identity.
 */
export async function ensureSingletonPluginConfig(
  kind: string, pluginId: string,
): Promise<{ config: PluginConfig; created: boolean } | null> {
  const registration = getPluginKind(kind);
  const adapter = getPluginConfigAdapter(kind);
  const plugin = registration?.registry.get(pluginId);
  if (!registration || !adapter?.seedDefault || !plugin ||
      !registration.registry.getMetadata(plugin).singleton) {
    throw new Error(`Not a seedable singleton: ${kind}/${pluginId}`);
  }
  const { storage } = await import("../../storage");
  const { runInTransaction, runOutsideTransaction } = await import("../../storage/transaction-context");
  const { SingletonViolationError } = await import("../../storage/system/plugin-configs");
  return runOutsideTransaction(async () => {
    const existing = await storage.pluginConfigs.getByKindAndPlugin(kind, pluginId);
    if (existing.length) return { config: existing[0], created: false };
    const flat = adapter.seedDefault!(plugin);
    if (!flat) return null;
    const { base, subsidiary } = adapter.toRows(flat);
    base.siriusId = (flat as { siriusId?: string | null }).siriusId ?? null;
    try {
      const config = await withFrameworkWrite(() => runInTransaction(async () => {
        const row = await storage.pluginConfigs.create(base as any);
        if (subsidiary) await storage.pluginConfigs.upsertSubsidiary(kind, { id: row.id, ...subsidiary });
        return row;
      }));
      return { config, created: true };
    } catch (error) {
      // A competing boot may have won. Read its row OUTSIDE the aborted tx.
      if (!(error instanceof SingletonViolationError)) throw error;
      const winner = await storage.pluginConfigs.getByKindAndPlugin(kind, pluginId);
      if (!winner.length) throw error;
      return { config: winner[0], created: false };
    }
  });
}

export async function bootstrapSingletonPluginConfigs(): Promise<void> {
  logger.info("Bootstrapping singleton plugin configs", { service: "singleton-seeder" });
  let created = 0, skipped = 0, errors = 0;
  for (const kind of listPluginKinds()) {
    const registration = getPluginKind(kind);
    const adapter = getPluginConfigAdapter(kind);
    if (!registration || !adapter?.seedDefault) continue;
    for (const plugin of registration.registry.list()) {
      const meta = registration.registry.getMetadata(plugin);
      if (!meta.singleton) continue;
      try {
        if ((await ensureSingletonPluginConfig(kind, meta.id))?.created) created++;
        else skipped++;
      } catch (error) {
        errors++;
        logger.error(`Failed to seed singleton plugin config: ${meta.id}`, {
          service: "singleton-seeder", kind, pluginId: meta.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  logger.info("Singleton plugin config bootstrap completed", { service: "singleton-seeder", created, skipped, errors });
}
