import express from "express";
import { createServer } from "http";
import { existsSync, rmSync } from "fs";
import { resolve } from "path";
import { setupVite, serveStatic, log } from "./vite";
import { logger } from "./logger";
import { bootstrapApp } from "./app-init";

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
if (process.env.NODE_ENV !== "production") {
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

// Health check endpoint - must be registered BEFORE any heavy initialization
// This allows deployment health checks to pass while the app is still starting
let appReady = false;
app.get('/health', (_req, res) => {
  res.status(200).json({ status: appReady ? 'ready' : 'starting' });
});

// Root path handler for health checks during startup
// Once app is ready, this falls through to the SPA handler
app.get('/', (req, res, next) => {
  if (appReady) {
    // App is ready, let normal SPA handler serve the page
    return next();
  }

  // During startup, respond based on Accept header
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('text/html')) {
    // Browser request during startup - serve a loading page
    res.status(200).set({ 'Content-Type': 'text/html' }).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Starting...</title>
          <meta http-equiv="refresh" content="2">
          <style>
            body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .loader { text-align: center; color: #666; }
          </style>
        </head>
        <body>
          <div class="loader">
            <p>Application is starting...</p>
            <p><small>This page will refresh automatically.</small></p>
          </div>
        </body>
      </html>
    `);
  } else {
    // Health check probe - return JSON status
    res.status(200).json({ status: 'starting' });
  }
});

// Create HTTP server early for health checks
const server = createServer(app);

// Start listening IMMEDIATELY so health checks pass during initialization
const port = parseInt(process.env.PORT || '5000', 10);
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
  await bootstrapApp(app, server);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Mark app as ready after all initialization is complete
  appReady = true;
  logger.info("Application fully initialized and ready", { source: "startup" });
})();
