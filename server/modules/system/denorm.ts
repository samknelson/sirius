import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { denormPluginRegistry } from "../../plugins/system/denorm/registry";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Admin-only, read-only visibility into the denorm system. Each denorm plugin
 * has a `plugin_configs` row of kind `denorm`, and every record it keeps in
 * sync is tracked in the `denorm` table with a status of ok / stale / error.
 *
 * These endpoints surface the per-config status breakdown so an operator can
 * see, at a glance, how many records each denorm plugin is keeping fresh.
 * They are intentionally read-only — mutating tools (set-all-stale, force
 * backfill) are a later task. Routes stay thin and all DB access goes through
 * the storage layer.
 */
export function registerDenormRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  /** Map a denorm plugin id to its human-readable name from the registry. */
  function pluginNameFor(pluginId: string): string {
    const plugin = denormPluginRegistry.get(pluginId);
    return plugin?.metadata.name ?? pluginId;
  }

  // List every denorm plugin config with its status breakdown.
  app.get("/api/denorm/configs", requireAccess("admin"), async (_req, res) => {
    try {
      const [configs, countsByConfig] = await Promise.all([
        storage.pluginConfigs.getByKind("denorm"),
        storage.denorm.countByStatusByConfig(),
      ]);

      const zero = { ok: 0, stale: 0, error: 0, total: 0 };
      const result = configs.map((config) => ({
        id: config.id,
        pluginId: config.pluginId,
        name: config.name,
        pluginName: pluginNameFor(config.pluginId),
        enabled: config.enabled,
        counts: countsByConfig[config.id] ?? zero,
      }));

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch denorm configs" });
    }
  });

  // A single denorm plugin config with its status breakdown.
  app.get("/api/denorm/configs/:id", requireAccess("admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.pluginConfigs.get(id);

      if (!config || config.pluginKind !== "denorm") {
        res.status(404).json({ message: "Denorm config not found" });
        return;
      }

      const counts = await storage.denorm.countByStatusForConfig(id);

      res.json({
        id: config.id,
        pluginId: config.pluginId,
        name: config.name,
        pluginName: pluginNameFor(config.pluginId),
        enabled: config.enabled,
        counts,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch denorm config" });
    }
  });
}
