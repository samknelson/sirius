/**
 * Production entry point for deployed environments.
 *
 * Referenced by package.json "build" and "start" scripts:
 *   - build: esbuild bundles this file into dist/production-entry.js
 *   - start: node dist/production-entry.js
 *
 * This file starts an Express server immediately with a health check endpoint
 * and a "starting..." placeholder page, then lazy-loads the full application
 * via app-init.ts. This allows the deployment health check to pass while the
 * application is still initializing (loading plugins, running migrations, etc).
 */
import express from "express";
import { createServer } from "http";
import { existsSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import { markBootFailed, markBootReady, markBootReportOnly } from "./services/boot-status";
// Pure leaf, like boot-status: safe to import before DATABASE_URL exists and
// whether or not app-init ever loaded.
import {
  bootStatusGate,
  registerBootStatusRoutes,
} from "./services/boot-status-http";
import { getEnvironmentVariable } from "./config/env-registry";

/**
 * Stale-build guardrail (see task #138).
 *
 * The dashboard plugin /content endpoints once returned a 404 with the
 * old wording `"No content resolver for plugin '<id>'"`. That wording
 * only ever existed in compiled `dist/` artifacts — the current source
 * uses different wording. The cause was someone running `npm run start`
 * (which executes `node dist/production-entry.js` and lazy-imports
 * `dist/app-init.js`) against a stale `dist/` directory that had not
 * been rebuilt to match the current `server/` source.
 *
 * This guardrail compares the newest mtime under `server/` to the
 * mtime of this compiled bundle (the file currently executing). If
 * source is newer than the build, we exit immediately with a clear
 * error instead of silently serving stale code.
 *
 * The check is skipped in deployed environments (REPLIT_DEPLOYMENT=1)
 * because the deploy pipeline always runs `npm run build` immediately
 * before `npm run start`, and the source tree may not be present in
 * the deployed container at all.
 */
function assertBuildIsFresh(): void {
  if (getEnvironmentVariable("REPLIT_DEPLOYMENT") === "1") return;
  if (getEnvironmentVariable("SKIP_DIST_FRESHNESS_CHECK") === "1") return;

  try {
    const projectRoot = resolve(import.meta.dirname, "..");
    const sourceDir = join(projectRoot, "server");
    const selfPath = new URL(import.meta.url).pathname;
    if (!existsSync(sourceDir) || !existsSync(selfPath)) return;

    const buildMtime = statSync(selfPath).mtimeMs;
    let newestSourceMtime = 0;
    let newestSourcePath = "";
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const m = statSync(full).mtimeMs;
          if (m > newestSourceMtime) {
            newestSourceMtime = m;
            newestSourcePath = full;
          }
        }
      }
    };
    walk(sourceDir);

    if (newestSourceMtime > buildMtime + 1000) {
      console.error(
        `[stale-build] dist/ is older than server/ source — refusing to start.\n` +
          `  build mtime:  ${new Date(buildMtime).toISOString()} (${selfPath})\n` +
          `  source mtime: ${new Date(newestSourceMtime).toISOString()} (${newestSourcePath})\n` +
          `Run \`npm run build\` before \`npm run start\`, or use \`npm run dev\` for source-mode development.`,
      );
      process.exit(1);
    }
  } catch (err) {
    console.warn(`[stale-build] freshness check skipped: ${(err as Error).message}`);
  }
}

assertBuildIsFresh();

const app = express();
const server = createServer(app);

/**
 * Init-failure surfacing (permanent deployment feature).
 *
 * If the boot sequence (`startApp` → `bootstrapApp`) throws, we do NOT
 * process.exit(1): that crash-loops the ECS container and the only record of
 * the error is the container log, which operators without AWS access cannot
 * reach. Instead the process stays alive, the boot-status addresses report
 * `init-failed` (still HTTP 200 so the deploy stabilizes and the task isn't
 * cycled), and every other request answers 503 with that same truthful
 * state instead of claiming to be starting.
 *
 * Detail exposure is gated: the full error message + stack trace are only
 * rendered when EXPOSE_BOOT_ERRORS=1 (set per environment — on for
 * Development, off for QA/Production so internals are never leaked
 * publicly). Without the flag the response still names the phase and the
 * blocker, and points the operator at the server logs.
 *
 * Both the phase and the rendering live in `services/boot-status{,-http}.ts`,
 * shared with the development entry point so the two cannot diverge.
 *
 * Boot-status addresses are registered FIRST: they must answer while the
 * boot is still running or has already failed, which is the only time they
 * matter. `/health` is the long-standing one; the `/api/…` spellings are the
 * only ones that reach the API service through the ALB, and `/boot-status`
 * is a spelling no load-balancer fixed-response health rule occupies.
 */
registerBootStatusRoutes(app);

// Everything else, while this process is not ready: the root path keeps
// answering 200 and every other path answers 503 — but with a body naming
// the ACTUAL phase (starting / init-failed / report-only), the boot
// identity, the blocker and the drift result. Steps aside once ready.
app.use('/', bootStatusGate);

const port = parseInt(getEnvironmentVariable("PORT") || '5000', 10);

server.listen({
  port,
  host: "0.0.0.0",
  reusePort: true,
}, async () => {
  console.log(`Server listening on port ${port}, loading application...`);
  
  try {
    // Assemble DATABASE_URL from component env vars (DB_HOST/DB_PORT/DB_NAME/
    // DB_SECRET) before app-init loads server/storage/db.ts, which requires it
    // at module load. No-op when DATABASE_URL is already set. See
    // server/config/assemble-database-url.ts.
    const { assembleDatabaseUrl } = await import('./config/assemble-database-url');
    assembleDatabaseUrl();
    const { startApp } = await import('./app-init');
    await startApp(app, server, () => {
      markBootReady();
      console.log(`Application fully initialized and ready`);
    });
  } catch (error) {
    // A report-only stop is a deliberate outcome, not a crash: keep serving
    // the report over HTTP (this deployment exists to be read, and exiting
    // would only crash-loop the container).
    if (error instanceof Error && error.name === 'BringUpReportOnlyStop') {
      markBootReportOnly(error);
      console.log(error.message);
      return;
    }
    console.error('Failed to initialize application:', error);
    // Permanent init-failure mode (see the comment above): record the phase
    // and keep serving the boot-status addresses instead of exiting, so the
    // failure is observable over HTTP.
    markBootFailed(error instanceof Error ? error : new Error(String(error)));
  }
});
