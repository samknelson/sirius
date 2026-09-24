// Import `registerPluginKind` from the defining submodule, NOT the `../_core`
// barrel (the barrel re-exports the singleton seeder, which imports storage —
// going through it re-forms the storage↔_core init cycle in the prod bundle).
import type { Express, Request, Response, NextFunction } from "express";
import { registerPluginKind } from "../_core/kinds";
import { menuPluginRegistry } from "./registry";
import { resolveMenuForRequest } from "./resolve";

export { menuPluginRegistry, registerMenuPlugin } from "./registry";
export type { MenuGate, MenuItemDef, MenuPlugin, MenuManifestEntry } from "./types";
export { resolveMenuForRequest } from "./resolve";

// Side-effect: register the bundled menu plugins.
import "./plugins/default";
import "./plugins/edls";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

let kindRegistered = false;

/**
 * Register menus as a plugin kind on the shared framework. Kind-level
 * manifest access is admin-only: the manifest is consumed by the Site
 * Configuration page's "Main menu" selector.
 */
export function registerMenuPluginKind(): void {
  if (kindRegistered) return;
  kindRegistered = true;
  registerPluginKind({
    kind: "menu",
    registry: menuPluginRegistry,
    label: "Menus",
    description: "Main-navigation menu layouts selectable in Site Configuration.",
    requiredPolicy: "admin",
  });
}

export function initializeMenuPluginSystem(): void {
  registerMenuPluginKind();
}

/**
 * GET /api/menu — resolve the selected menu plugin's tree for the current
 * user. Any authenticated user may call it; gating happens per item.
 *
 * Admins may pass `?plugin=<id>` to preview a different menu layout
 * (resolved for themselves) without changing the site-wide selection.
 */
export function registerMenuRoutes(app: Express, requireAuth: AuthMiddleware): void {
  app.get("/api/menu", requireAuth, async (req, res) => {
    try {
      let overridePluginId: string | undefined;
      const requested = req.query.plugin;
      if (typeof requested === "string" && requested.length > 0) {
        const { checkAccessInline } = await import("../../services/access-policy-evaluator");
        const access = await checkAccessInline(req, "admin");
        if (!access.granted) {
          return res.status(403).json({ message: "Admin access required to preview a menu layout" });
        }
        if (!menuPluginRegistry.has(requested)) {
          return res.status(404).json({ message: `Unknown menu plugin: ${requested}` });
        }
        overridePluginId = requested;
      }
      const menu = await resolveMenuForRequest(req, overridePluginId);
      res.json(menu);
    } catch (error) {
      console.error("Failed to resolve menu:", error);
      res.status(500).json({ message: "Failed to resolve menu" });
    }
  });
}
