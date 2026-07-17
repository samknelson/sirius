import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { denormPluginRegistry } from "../../plugins/system/denorm/registry";
import { backfillAllDenorm } from "../../plugins/system/denorm/backfill";
import { recomputeStaleDenorm } from "../../plugins/system/denorm/recompute";

/**
 * Resolve a request-body `mode` into the wrapper's `"live" | "test"`. An absent
 * mode defaults to `"live"`; any other value is rejected so a malformed request
 * never silently triggers a real write run. Mirrors the cron run endpoint.
 */
function parseMode(value: unknown): "live" | "test" | null {
  if (value === undefined || value === "live") return "live";
  if (value === "test") return "test";
  return null;
}

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Admin-only visibility and tooling for the denorm system. Each denorm plugin
 * has a `plugin_configs` row of kind `denorm`, and every record it keeps in
 * sync is tracked in the `denorm` table with a status of ok / stale / error.
 *
 * The read endpoints surface the per-config status breakdown so an operator can
 * see, at a glance, how many records each denorm plugin is keeping fresh. The
 * clear endpoint deletes a config's records so the next backfill sweep rebuilds
 * them. Routes stay thin and all DB access goes through the storage layer.
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

  // Registry-only view of every denorm plugin's declared storage
  // relationships (reads + writes with sole-writer claims). No DB access —
  // the declarations live on the plugin objects themselves.
  app.get("/api/denorm/relationships", requireAccess("admin"), (_req, res) => {
    const result = denormPluginRegistry.list().map((plugin) => ({
      pluginId: plugin.metadata.id,
      pluginName: plugin.metadata.name,
      entityType: plugin.entityType,
      events: (plugin.eventHandlers ?? []).map((h) => h.event),
      reads: plugin.reads,
      writes: plugin.writes,
    }));
    res.json(result);
  });

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

  // Clear (delete) every denorm record for a single config, forcing a full
  // rebuild on the next backfill sweep. Destructive; admin-only.
  app.post("/api/denorm/configs/:id/clear", requireAccess("admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.pluginConfigs.get(id);

      if (!config || config.pluginKind !== "denorm") {
        res.status(404).json({ message: "Denorm config not found" });
        return;
      }

      const deleted = await storage.denorm.clearForConfig(id);

      res.json({ deleted });
    } catch (error) {
      res.status(500).json({ message: "Failed to clear denorm config" });
    }
  });

  // Run the backfill sweep for just this config's plugin (enqueue missing rows
  // as stale, delete widow rows). Accepts mode "live" | "test" (dry-run).
  // Thin: resolves the config then calls the shared wrapper scoped by pluginId.
  // Note: per-plugin runs are not recorded in the cron run history.
  app.post("/api/denorm/configs/:id/backfill", requireAccess("admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.pluginConfigs.get(id);

      if (!config || config.pluginKind !== "denorm") {
        res.status(404).json({ message: "Denorm config not found" });
        return;
      }

      const mode = parseMode(req.body?.mode);
      if (mode === null) {
        res.status(400).json({ message: "Invalid mode. Must be 'live' or 'test'" });
        return;
      }

      const summary = await backfillAllDenorm({ mode, pluginId: config.pluginId });

      res.json({ mode, ...summary });
    } catch (error) {
      res.status(500).json({ message: "Failed to run denorm backfill" });
    }
  });

  // Recompute the stale rows for just this config's plugin, marking them ok (or
  // error on failure). Accepts mode "live" | "test" (dry-run). Thin: resolves
  // the config then calls the shared wrapper scoped by pluginId.
  // Note: per-plugin runs are not recorded in the cron run history.
  app.post("/api/denorm/configs/:id/recompute", requireAccess("admin"), async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.pluginConfigs.get(id);

      if (!config || config.pluginKind !== "denorm") {
        res.status(404).json({ message: "Denorm config not found" });
        return;
      }

      const mode = parseMode(req.body?.mode);
      if (mode === null) {
        res.status(400).json({ message: "Invalid mode. Must be 'live' or 'test'" });
        return;
      }

      const summary = await recomputeStaleDenorm({ mode, pluginId: config.pluginId });

      res.json({ mode, ...summary });
    } catch (error) {
      res.status(500).json({ message: "Failed to run denorm recompute" });
    }
  });
}
