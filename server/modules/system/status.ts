import type { Express, Request, Response, NextFunction } from "express";
import { getPluginKind } from "../../plugins/_core/kinds";
import { enforceKindGating } from "../../plugins/_core/gating";
import {
  systemStatusPluginRegistry,
  collectStatus,
  rescanPlugin,
  rescanAll,
  getPluginDetails,
} from "../../plugins/system/status";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Admin-gated system-status routes. Thin wrappers around the collector
 * service (`server/plugins/system/status/collector.ts`) — a future
 * token-gated external monitoring endpoint can reuse the collector without
 * touching these routes.
 *
 * Gating: the kind registers with `requiredPolicy: "admin"`, enforced here
 * via the same `enforceKindGating` used by the unified manifest endpoint.
 * Per-plugin `requiredComponent` / `requiredPolicy` are enforced by
 * `registry.listVisibleTo(req)`.
 */
export function registerSystemStatusRoutes(app: Express, requireAuth: AuthMiddleware) {
  const gate = async (req: Request, res: Response): Promise<boolean> => {
    const registration = getPluginKind("system-status");
    if (!registration) {
      res.status(500).json({ message: "System status plugin kind not registered" });
      return false;
    }
    const kindGate = await enforceKindGating(
      {
        requiredComponent: registration.requiredComponent,
        requiredPolicy: registration.requiredPolicy,
      },
      req,
    );
    if (!kindGate.ok) {
      res.status(kindGate.status).json({ message: kindGate.message });
      return false;
    }
    return true;
  };

  // Latest status for every plugin visible to the caller. Scans on first
  // demand: plugins without a cached result are scanned now.
  app.get("/api/system-status", requireAuth, async (req, res) => {
    try {
      if (!(await gate(req, res))) return;
      const visible = await systemStatusPluginRegistry.listVisibleTo(req);
      const entries = await collectStatus(visible);
      res.setHeader("Cache-Control", "no-store");
      res.json(entries);
    } catch (error) {
      console.error("Failed to collect system status:", error);
      res.status(500).json({ message: "Failed to collect system status" });
    }
  });

  // Force a fresh scan of every visible plugin.
  app.post("/api/system-status/rescan", requireAuth, async (req, res) => {
    try {
      if (!(await gate(req, res))) return;
      const visible = await systemStatusPluginRegistry.listVisibleTo(req);
      const entries = await rescanAll(visible);
      res.setHeader("Cache-Control", "no-store");
      res.json(entries);
    } catch (error) {
      console.error("Failed to rescan system status:", error);
      res.status(500).json({ message: "Failed to rescan system status" });
    }
  });

  // Latest status for ONE visible plugin (Task #1258). Exists so a page that
  // embeds a single status plugin — the admin Restart & Reload page renders
  // Container Information — does not trigger a scan of every other plugin
  // just to show it. Same scan-on-first-demand semantics as the collection.
  app.get("/api/system-status/:id", requireAuth, async (req, res) => {
    try {
      if (!(await gate(req, res))) return;
      const visible = await systemStatusPluginRegistry.listVisibleTo(req);
      const plugin = visible.find((p) => p.id === req.params.id);
      if (!plugin) {
        res.status(404).json({ message: "Unknown system status plugin" });
        return;
      }
      const [entry] = await collectStatus([plugin]);
      res.setHeader("Cache-Control", "no-store");
      res.json(entry);
    } catch (error) {
      console.error("Failed to collect system status entry:", error);
      res.status(500).json({ message: "Failed to collect system status" });
    }
  });

  // On-demand details drill-down for one visible plugin. NEVER cached —
  // each request invokes the plugin's details() fresh — and the payload is
  // never logged (it may contain sensitive-adjacent data).
  app.get("/api/system-status/:id/details", requireAuth, async (req, res) => {
    try {
      if (!(await gate(req, res))) return;
      const visible = await systemStatusPluginRegistry.listVisibleTo(req);
      const plugin = visible.find((p) => p.id === req.params.id);
      if (!plugin) {
        res.status(404).json({ message: "Unknown system status plugin" });
        return;
      }
      if (typeof plugin.details !== "function") {
        res.status(404).json({ message: "This plugin does not provide details" });
        return;
      }
      const details = await getPluginDetails(plugin);
      res.setHeader("Cache-Control", "no-store");
      res.json(details);
    } catch (error) {
      // Deliberately do NOT log the payload; only the failure itself.
      console.error(
        "Failed to load system status details:",
        error instanceof Error ? error.message : "unknown error",
      );
      res.status(500).json({ message: "Failed to load details" });
    }
  });

  // Force a fresh scan of one visible plugin. For "immediate" plugins this
  // simply recomputes (they are never cached), same as a normal collect.
  app.post("/api/system-status/:id/rescan", requireAuth, async (req, res) => {
    try {
      if (!(await gate(req, res))) return;
      const visible = await systemStatusPluginRegistry.listVisibleTo(req);
      const plugin = visible.find((p) => p.id === req.params.id);
      if (!plugin) {
        res.status(404).json({ message: "Unknown system status plugin" });
        return;
      }
      const entry = await rescanPlugin(plugin);
      res.setHeader("Cache-Control", "no-store");
      res.json(entry);
    } catch (error) {
      console.error("Failed to rescan system status plugin:", error);
      res.status(500).json({ message: "Failed to rescan system status plugin" });
    }
  });
}
