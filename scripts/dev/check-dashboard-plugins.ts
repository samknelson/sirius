/**
 * Smoke test for dashboard plugin /content endpoints.
 *
 * Two layers of verification:
 *
 * 1. Static check: every plugin we expose at
 *    `/api/dashboard-plugins/:pluginId/content` is registered in the
 *    `dashboardPluginRegistry` with a non-null `content` resolver.
 *    A missing/null resolver is exactly what produced task #138's
 *    user-visible 404 "no content resolver" error.
 *
 * 2. Runtime check: mount the real `registerDashboardRoutes` on a
 *    fresh express app with a stubbed `requireAuth` middleware that
 *    injects an authenticated request, then make in-process HTTP
 *    calls to both `/api/dashboard-plugins/edls-summary/content` and
 *    `/api/dashboard-plugins/my-steward/content`. The route MUST NOT
 *    return 404 — it must reach the registry and execute (or be
 *    gated 403). A 404 response means the route/registry wiring is
 *    broken.
 *
 * Run with:  npx tsx scripts/dev/check-dashboard-plugins.ts
 */
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { AddressInfo } from "net";
import {
  registerDashboardPlugins,
  dashboardPluginRegistry,
} from "../../server/plugins/dashboard";
import { registerDashboardRoutes } from "../../server/modules/dashboard";

interface SmokeAuthRequest extends Request {
  user: { claims: { sub: string } };
  session: Record<string, unknown>;
  isAuthenticated: () => boolean;
}

const REQUIRED_WITH_CONTENT = [
  "edls-summary",
  "my-steward",
  "welcome-messages",
  "btu-dues-status",
  "btu-bu-summary",
  "employer-monthly-uploads",
];

const HTTP_CHECKS: { url: string; label: string }[] = [
  { url: "/api/dashboard-plugins/edls-summary/content?ymd=2026-05-14", label: "edls-summary" },
  { url: "/api/dashboard-plugins/my-steward/content", label: "my-steward" },
];

async function main() {
  registerDashboardPlugins();

  // ---- Static check ----
  const failures: string[] = [];
  for (const id of REQUIRED_WITH_CONTENT) {
    const plugin = dashboardPluginRegistry.get(id);
    if (!plugin) {
      failures.push(`Plugin '${id}' is not registered`);
      continue;
    }
    if (!plugin.content) {
      failures.push(`Plugin '${id}' has no content resolver (would 404)`);
      continue;
    }
    const kind =
      typeof plugin.content === "function"
        ? "single resolver"
        : `actions: ${Object.keys(plugin.content).join(", ") || "(none)"}`;
    console.log(`[static] OK ${id} -> ${kind}`);
  }

  // ---- Runtime check ----
  const app = express();
  const stubAuth = (req: Request, _res: Response, next: NextFunction) => {
    const r = req as SmokeAuthRequest;
    r.user = { claims: { sub: "smoke-test-user" } };
    r.session = {};
    r.isAuthenticated = () => true;
    next();
  };
  const stubPermission =
    () => (_req: Request, _res: Response, next: NextFunction) => next();
  registerDashboardRoutes(app, stubAuth, stubPermission);

  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  for (const { url, label } of HTTP_CHECKS) {
    const res = await fetch(`http://127.0.0.1:${port}${url}`);
    const body = await res.text();
    if (res.status === 404) {
      failures.push(
        `[runtime] ${label}: GET ${url} returned 404 (route/registry broken). Body: ${body}`,
      );
    } else {
      console.log(
        `[runtime] OK ${label}: GET ${url} -> ${res.status} ` +
          `(non-404 means route reaches registry; 200/403/500 are all proof that the wiring fix from task #138 holds)`,
      );
    }
  }
  await new Promise<void>((r) => server.close(() => r()));

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    `\nAll dashboard plugin /content endpoints are reachable and the registry has resolvers for them.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
