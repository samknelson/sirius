import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "../../logger";
import { registerPluginKind } from "../_core";
import { clientInjectionRegistry, resolveClientInjections } from "./registry";
import type { ClientInjectionPlugin } from "./types";

export { clientInjectionRegistry } from "./registry";
export type * from "./types";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<any>;

/**
 * Auto-discover every plugin file under `./plugins/`. Each file is
 * expected to default-export a `ClientInjectionPlugin` (or export one
 * as a named export — we'll accept any exported value that looks like
 * a plugin). This is what makes new client-injection plugins truly
 * single-file drop-ins: no edits to this file required.
 *
 * Discovery order is the filesystem `readdirSync` order, sorted
 * alphabetically by filename for determinism. The registry preserves
 * registration order, which `resolveClientInjections` uses as the
 * stable fallback after `order` ascending.
 */
async function registerClientInjectionPlugins(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pluginsDir = join(here, "plugins");

  let files: string[] = [];
  try {
    files = readdirSync(pluginsDir)
      .filter((f) => /\.(ts|js|mjs|cjs)$/.test(f) && !f.endsWith(".d.ts"))
      .sort();
  } catch (err) {
    logger.warn("Client-injection plugins directory not readable", {
      service: "client-injection-plugins",
      pluginsDir,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const file of files) {
    const fullPath = join(pluginsDir, file);
    try {
      const mod = await import(pathToFileURL(fullPath).href);
      const candidates = Object.values(mod).filter(
        (v): v is ClientInjectionPlugin =>
          !!v &&
          typeof v === "object" &&
          typeof (v as ClientInjectionPlugin).id === "string" &&
          typeof (v as ClientInjectionPlugin).slot === "string" &&
          typeof (v as ClientInjectionPlugin).kind === "string",
      );
      if (candidates.length === 0) {
        logger.warn("Client-injection plugin file exported no plugin", {
          service: "client-injection-plugins",
          file,
        });
        continue;
      }
      for (const plugin of candidates) {
        clientInjectionRegistry.register(plugin);
      }
    } catch (err) {
      logger.error("Failed to load client-injection plugin file", {
        service: "client-injection-plugins",
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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

export async function initializeClientInjectionPluginSystem(): Promise<void> {
  await registerClientInjectionPlugins();
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
