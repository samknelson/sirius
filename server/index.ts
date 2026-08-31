import express from "express";
import { createServer } from "http";
import { existsSync, rmSync } from "fs";
import { resolve } from "path";
import { setupVite, serveStatic, log } from "./vite";
import { logger } from "./logger";
import { bootstrapApp } from "./app-init";
import { getEnvironmentVariable } from "./config/env-registry";
import { markBootFailed, markBootReady, markBootReportOnly } from "./services/boot-status";
import { bootStatusGate, registerBootStatusRoutes } from "./services/boot-status-http";

// Dev-only guardrail: remove any stale `dist/` build before booting.
// `npm run dev` (tsx server/index.ts) loads source directly and never
// imports from `dist/`. However, an old `dist/` directory left behind
// by a previous `npm run build` can be served accidentally if anyone
// runs `npm run start` (production-entry) against the same workspace,
// producing confusing "stale code" bugs (see task #138 — dashboard
// plugin /content endpoints returning the old 404 wording from a
// months-old bundle). Removing it here ensures dev never coexists
// with stale compiled artifacts. Production deploys run `npm run build`
// before `npm run start`, so this has no effect on production.
if (getEnvironmentVariable("NODE_ENV") !== "production") {
  const distDir = resolve(import.meta.dirname, "..", "dist");
  if (existsSync(distDir)) {
    try {
      rmSync(distDir, { recursive: true, force: true });
      log(`Removed stale dist/ directory at ${distDir} (dev guardrail)`);
    } catch (err) {
      log(`Warning: failed to remove stale dist/: ${(err as Error).message}`);
    }
  }
}

const app = express();

// Boot-status surface, registered BEFORE any heavy initialization and shared
// verbatim with the production entry point (`server/production-entry.ts`), so
// a boot problem presents identically in both. `/health`, `/boot-status`,
// `/api/health` and `/api/boot-status` all answer in every phase; every other
// request is answered by the gate until the phase is "ready", naming the
// actual phase (starting / init-failed / report-only) rather than always
// claiming to be starting.
registerBootStatusRoutes(app);
app.use('/', bootStatusGate);

// Create HTTP server early for health checks
const server = createServer(app);

// Start listening IMMEDIATELY so health checks pass during initialization
const port = parseInt(getEnvironmentVariable("PORT") || '5000', 10);
server.listen({
  port,
  host: "0.0.0.0",
  reusePort: true,
}, () => {
  log(`Server listening on port ${port}, starting initialization...`);
});

(async () => {
  // Run the shared, ordered application bootstrap (base middleware, init
  // sequence, routes, websocket, cron scheduler, error middleware). This is
  // the single source of truth shared with the production entry point
  // (`server/production-entry.ts` -> `startApp()` in `server/app-init.ts`).
  try {
    await bootstrapApp(app, server);
  } catch (error) {
    // BRINGUP_REPORT_ONLY=1 stops the boot on purpose after printing the
    // bring-up report; that is not a crash. Anything else is a real init
    // failure — and, exactly as in production, the process stays alive and
    // serves the truth over HTTP instead of dying with an unhandled
    // rejection that only the console ever sees.
    if (error instanceof Error && error.name === "BringUpReportOnlyStop") {
      markBootReportOnly(error);
      log(error.message);
      return;
    }
    markBootFailed(error instanceof Error ? error : new Error(String(error)));
    logger.error("Application initialization failed", {
      source: "startup",
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    console.error("Failed to initialize application:", error);
    return;
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Mark app as ready after all initialization is complete
  markBootReady();
  logger.info("Application fully initialized and ready", { source: "startup" });
})();
