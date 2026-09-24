import type { Express, Request, Response, NextFunction } from "express";
import {
  getPluginKind,
  enforceKindGating,
  enforcePluginGating,
} from "../../plugins/_core";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Generic plugin admin endpoints. All four kinds (dashboard,
 * dispatch-eligibility, charge, trust-eligibility) share these URLs;
 * a kind only exposes a sub-set by providing the matching callback on
 * its `PluginKindRegistration` (see `server/plugins/_core/kinds.ts`).
 *
 * The auth/gating model mirrors the unified manifest endpoint
 * (`plugins-manifest.ts`):
 *   - The route requires authentication.
 *   - The kind's `requiredComponent` / `requiredPolicy` apply (same
 *     stack the legacy per-kind admin endpoints carried).
 *   - For single-plugin endpoints, the plugin's own
 *     `requiredComponent` / `requiredPolicy` apply on top.
 *
 * Endpoints:
 *   POST /api/plugins/:kind/:id/validate-config
 *   GET  /api/plugins/:kind/:id/settings
 *   PUT  /api/plugins/:kind/:id/settings
 *
 * Endpoints 404 when the kind does not expose the corresponding
 * capability.
 */
export function registerPluginsAdminRoutes(app: Express, requireAuth: AuthMiddleware) {
  // Lookup + kind-level gating helper. Returns the registration or
  // null after sending the appropriate error response.
  async function resolveKind(req: Request, res: Response) {
    const { kind } = req.params;
    const registration = getPluginKind(kind);
    if (!registration) {
      res.status(404).json({ message: `Unknown plugin kind: ${kind}` });
      return null;
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
      return null;
    }
    return registration;
  }

  // Resolve a single plugin (by id) under a kind, applying per-plugin
  // component + access-policy gating. Returns the plugin or null after
  // sending the error response.
  async function resolvePlugin(req: Request, res: Response) {
    const registration = await resolveKind(req, res);
    if (!registration) return null;
    const plugin = registration.registry.get(req.params.id);
    if (!plugin) {
      res.status(404).json({ message: `Plugin '${req.params.id}' not found` });
      return null;
    }
    const meta = registration.registry.getMetadata(plugin);
    const gate = await enforcePluginGating(meta, req);
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.message });
      return null;
    }
    return { registration, plugin };
  }

  app.post("/api/plugins/:kind/:id/validate-config", requireAuth, async (req, res) => {
    try {
      const resolved = await resolvePlugin(req, res);
      if (!resolved) return;
      const { registration, plugin } = resolved;
      if (!registration.validateConfig) {
        res.status(404).json({ message: `Kind '${req.params.kind}' does not support validate-config` });
        return;
      }
      const result = await registration.validateConfig(plugin, req.body?.config);
      res.json(result);
    } catch (error) {
      console.error("Failed to validate plugin config:", error);
      res.status(500).json({ message: "Failed to validate plugin configuration" });
    }
  });

  app.get("/api/plugins/:kind/:id/settings", requireAuth, async (req, res) => {
    try {
      const resolved = await resolvePlugin(req, res);
      if (!resolved) return;
      const { registration, plugin } = resolved;
      if (!registration.getSettings) {
        res.status(404).json({ message: `Kind '${req.params.kind}' does not expose settings` });
        return;
      }
      const payload = await registration.getSettings(plugin);
      if (!payload) {
        res.status(404).json({ message: "Plugin has no settings schema" });
        return;
      }
      res.json(payload);
    } catch (error) {
      console.error("Failed to fetch plugin settings:", error);
      res.status(500).json({ message: "Failed to fetch plugin settings" });
    }
  });

  app.put("/api/plugins/:kind/:id/settings", requireAuth, async (req, res) => {
    try {
      const resolved = await resolvePlugin(req, res);
      if (!resolved) return;
      const { registration, plugin } = resolved;
      if (!registration.saveSettings) {
        res.status(404).json({ message: `Kind '${req.params.kind}' does not support saving settings` });
        return;
      }
      const result = await registration.saveSettings(plugin, req.body);
      if (result && typeof result === "object" && "valid" in result && result.valid === false) {
        res.status(400).json({ message: "Invalid settings format", errors: result.errors ?? [] });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to save plugin settings:", error);
      res.status(500).json({ message: "Failed to save plugin settings" });
    }
  });
}
