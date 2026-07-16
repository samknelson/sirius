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
 */
export function registerMenuRoutes(app: Express, requireAuth: AuthMiddleware): void {
  app.get("/api/menu", requireAuth, async (req, res) => {
    try {
      const menu = await resolveMenuForRequest(req);
      res.json(menu);
    } catch (error) {
      console.error("Failed to resolve menu:", error);
      res.status(500).json({ message: "Failed to resolve menu" });
    }
  });
}
