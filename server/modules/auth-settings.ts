import type { Express } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { providerRegistry } from "../auth";
import {
  AUTH_SETTINGS_VARIABLE,
  authSettingsSchema,
  getAuthSettings,
} from "../auth/auth-settings";

/**
 * Admin endpoints for the Auth Settings page.
 *
 * GET returns the configured auth providers (from the runtime registry —
 * what is actually wired via environment config) alongside the stored
 * settings. PUT validates shape via zod AND that every mapped role exists,
 * then writes the single `auth_settings` variables row.
 */
export function registerAuthSettingsRoutes(app: Express) {
  app.get("/api/admin/auth-settings", requireAccess("admin"), async (_req, res) => {
    try {
      const settings = await getAuthSettings(storage);
      const providers = providerRegistry.getAll().map((p) => ({
        type: p.type,
        isDefault: providerRegistry.getDefault()?.type === p.type,
      }));
      res.json({ providers, settings });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch auth settings" });
    }
  });

  app.put("/api/admin/auth-settings", requireAccess("admin"), async (req, res) => {
    try {
      const parsed = authSettingsSchema.safeParse(req.body?.settings);
      if (!parsed.success) {
        res.status(400).json({
          message: "Invalid auth settings",
          errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
      }
      const settings = parsed.data;

      // Every mapped role must exist.
      const roles = await storage.users.getAllRoles();
      const roleIds = new Set(roles.map((r) => r.id));
      const unknown = settings.samlRoleMappings
        .map((m) => m.roleId)
        .filter((id) => !roleIds.has(id));
      if (unknown.length > 0) {
        res.status(400).json({
          message: `Unknown role id(s): ${Array.from(new Set(unknown)).join(", ")}`,
        });
        return;
      }

      const existing = await storage.variables.getByName(AUTH_SETTINGS_VARIABLE);
      const saved = existing
        ? await storage.variables.update(existing.id, { value: settings })
        : await storage.variables.create({ name: AUTH_SETTINGS_VARIABLE, value: settings });

      res.json({ settings: saved?.value ?? settings });
    } catch (error) {
      res.status(500).json({ message: "Failed to save auth settings" });
    }
  });
}
