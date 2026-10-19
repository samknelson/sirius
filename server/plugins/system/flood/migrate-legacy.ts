import { floodPluginRegistry } from "./registry";
import { floodSettingsSchema } from "./types";
import { logger } from "../../../logger";
import { withFrameworkWrite } from "../../../middleware/request-context";

/** One-time, idempotent import. Never used by enforcement or normal config reads. */
export async function migrateLegacyFloodConfigs(): Promise<void> {
  const { storage } = await import("../../../storage");
  const { runInTransaction } = await import("../../../storage/transaction-context");
  const { SingletonViolationError } = await import("../../../storage/system/plugin-configs");
  const legacy = await storage.variables.getByNamePrefix("flood_");
  for (const variable of legacy) {
    const id = variable.name.slice("flood_".length);
    const plugin = floodPluginRegistry.get(id);
    if (!plugin) {
      logger.warn("Unregistered legacy flood variable retained", { service: "flood-migration", name: variable.name });
      continue;
    }
    // Retry outside the failed transaction if another boot won singleton creation.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await withFrameworkWrite(() => runInTransaction(async () => {
          const source = await storage.variables.getByName(variable.name);
          if (!source) return;
          let value: unknown;
          try { value = typeof source.value === "string" ? JSON.parse(source.value) : source.value; }
          catch {
            logger.warn("Malformed legacy flood variable retained; defaults remain available", {
              service: "flood-migration", name: source.name,
            });
            return;
          }
          const parsed = floodSettingsSchema.safeParse(value);
          if (!parsed.success) {
            logger.warn("Invalid legacy flood limits retained; defaults remain available", {
              service: "flood-migration", name: source.name,
            });
            return;
          }
          const existing = await storage.pluginConfigs.getByKindAndPlugin("flood", id);
          if (existing.length === 0) {
            await storage.pluginConfigs.create({
              pluginKind: "flood", pluginId: id, name: plugin.name,
              enabled: true, ordering: 0, data: parsed.data,
            });
          }
          // Same transaction: failed insert/delete rolls back BOTH halves.
          await storage.variables.delete(source.id);
        }));
        break;
      } catch (error) {
        if (error instanceof SingletonViolationError && attempt === 0) continue;
        // Do not seed defaults after a failed valid import: that would mask it.
        throw error;
      }
    }
  }
}
