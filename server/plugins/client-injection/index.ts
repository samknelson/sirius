import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "../../logger";
import { registerPluginKind } from "../_core";
import { clientInjectionRegistry, resolveClientInjections } from "./registry";

export { clientInjectionRegistry, registerClientInjection } from "./registry";
export type * from "./types";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;

let kindRegistered = false;
function registerClientInjectionKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "client-injection",
    registry: clientInjectionRegistry,
    sortEntries: (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  });
  kindRegistered = true;
}

/**
 * Initialize the client-injection plugin system.
 *
 * Plugins self-register at module top level. The side-effect imports at the
 * bottom of this file load each plugin once and trigger its
 * `registerClientInjection(...)` call. To add a new plugin: drop a file
 * under `./plugins/` and add one `import "./plugins/<name>"` line below.
 *
 * (This matches the convention used by every other plugin kind in the
 * repo — see `server/plugins/_core/README.md` → "Plugin registration
 * convention".)
 */
export function initializeClientInjectionPluginSystem(): void {
  registerClientInjectionKind();
  logger.info("Client-injection plugins registered", {
    service: "client-injection-plugins",
    plugins: clientInjectionRegistry.listIds(),
  });
}

/**
 * Public resolved-manifest endpoint. Registered BEFORE the generic
 * `/api/plugins/:kind/manifest` dispatcher so this handler intercepts
 * the `client-injection` kind and returns the grouped, fully-resolved
 * `{ head, bodyEnd }` shape that `<ServerInjections />` consumes.
 */
export function registerClientInjectionManifestRoute(
  app: Express,
  requireAuth: AuthMiddleware,
): void {
  app.get(
    "/api/plugins/client-injection/manifest",
    requireAuth,
    async (req, res) => {
      try {
        const resolved = await resolveClientInjections(req);
        res.setHeader("Cache-Control", "no-store");
        res.json(resolved);
      } catch (error) {
        logger.error("Failed to resolve client injections", {
          service: "client-injection-plugins",
          error: error instanceof Error ? error.message : String(error),
        });
        res
          .status(500)
          .json({ message: "Failed to resolve client injections" });
      }
    },
  );
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/weglot-sdk";
import "./plugins/weglot-init";
