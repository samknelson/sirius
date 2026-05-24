import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "../../logger";
import { registerPluginKind } from "../_core";
import { clientInjectionRegistry, resolveClientInjections } from "./registry";
import { weglotSdkPlugin } from "./plugins/weglot-sdk";
import { weglotInitPlugin } from "./plugins/weglot-init";

export { clientInjectionRegistry } from "./registry";
export type * from "./types";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;

function registerClientInjectionPlugins(): void {
  clientInjectionRegistry.register(weglotSdkPlugin);
  clientInjectionRegistry.register(weglotInitPlugin);
  logger.info("Client-injection plugins registered", {
    service: "client-injection-plugins",
    plugins: clientInjectionRegistry.listIds(),
  });
}

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

export function initializeClientInjectionPluginSystem(): void {
  registerClientInjectionPlugins();
  registerClientInjectionKind();
}

/**
 * Public resolved-manifest endpoint. Registered BEFORE the generic
 * `/api/plugins/:kind/manifest` dispatcher so this handler intercepts
 * the `client-injection` kind and returns the grouped, fully-resolved
 * `{ head, bodyEnd }` shape that `<ServerInjections />` consumes.
 *
 * The generic manifest dispatcher still serves a flat metadata array
 * for any other tooling that asks for it (it just never wins the
 * race here for this specific path).
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
