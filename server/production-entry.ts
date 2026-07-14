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
  if (process.env.REPLIT_DEPLOYMENT === "1") return;
  if (process.env.SKIP_DIST_FRESHNESS_CHECK === "1") return;

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

let appReady = false;
// TEMPORARY DIAGNOSTIC (remove after debugging the freeman-dev boot failure):
// If bootstrapApp throws during init we normally process.exit(1), which
// crash-loops the container and the only record is the container log — which
// is unreachable without AWS access. Instead we capture the error here and
// surface it through /health so it can be read over HTTP. The process stays
// alive (health returns 200) so the ECS deploy stabilizes.
let initError: Error | null = null;

app.get('/health', (_req, res) => {
  if (initError) {
    res.status(200).json({
      status: 'init-failed',
      error: initError.message,
      stack: initError.stack,
    });
    return;
  }
  res.status(200).json({ status: appReady ? 'ready' : 'starting' });
});

app.use('/', (req, res, next) => {
  if (appReady) {
    return next();
  }
  
  if (req.path === '/') {
    const acceptHeader = req.headers.accept || '';
    // TEMPORARY DIAGNOSTIC (remove after debugging the freeman-dev boot
    // failure): if boot threw, render the captured error + stack on the
    // placeholder page so it is visible in the browser (the ALB shadows
    // /health with its own fixed response, so the JSON there is unreachable).
    if (initError) {
      if (acceptHeader.includes('text/html')) {
        const escapeHtml = (s: string) =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        res.status(200).set({ 'Content-Type': 'text/html' }).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Init failed</title>
              <style>
                body { font-family: system-ui, sans-serif; margin: 2rem; background: #fff; color: #111; }
                h1 { color: #b00020; }
                pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
              </style>
            </head>
            <body>
              <h1>Application initialization failed</h1>
              <p><strong>${escapeHtml(initError.message)}</strong></p>
              <pre>${escapeHtml(initError.stack || '(no stack)')}</pre>
            </body>
          </html>
        `);
        return;
      }
      res.status(200).json({
        status: 'init-failed',
        error: initError.message,
        stack: initError.stack,
      });
      return;
    }
    if (acceptHeader.includes('text/html')) {
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
      return;
    } else {
      res.status(200).json({ status: 'starting' });
      return;
    }
  }
  
  res.status(503).json({ message: 'Application is starting, please wait...' });
});

const port = parseInt(process.env.PORT || '5000', 10);

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
      appReady = true;
      console.log(`Application fully initialized and ready`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    // TEMPORARY DIAGNOSTIC (remove after debugging the freeman-dev boot
    // failure): capture the error and keep serving /health instead of
    // exiting, so the real error is retrievable over HTTP.
    initError = error instanceof Error ? error : new Error(String(error));
  }
});
