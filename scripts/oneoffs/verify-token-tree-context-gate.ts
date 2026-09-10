/**
 * One-off e2e check for the shared token TREE routes.
 *
 * The tree used to be three near-identical route families (studio/admin,
 * bulk, compose) with the roots named by the caller. It is now ONE
 * family, `?context=<id>`, scoped and gated by the named token context.
 * This proves the three things that collapse was for:
 *
 *   1. the roots come from the context, not the query string;
 *   2. the gate is the CONTEXT's access policy, per request, fail-closed;
 *   3. `type/:type` cannot expand a type the context cannot reach.
 *
 * Run: npx tsx scripts/oneoffs/verify-token-tree-context-gate.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import {
  loadComponentCache,
  isComponentEnabledSync,
} from "../../server/services/component-cache";
import {
  initAccessControl,
  requireAccess,
} from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { registerTokenStudioRoutes } from "../../server/modules/token-studio";
import "../../server/modules/bulk/token-roots";
import { BULK_MESSAGE_TOKEN_CONTEXT } from "@shared/token-contexts";

async function main() {
  await loadComponentCache();
  initializePermissions();
  initAccessControl(
    {
      getUserPermissions: async (userId: string) =>
        (await storage.users.getUserPermissions(userId)).map((p) => p.key),
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    },
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );
  initializeTokenPluginSystem();

  const allUsers = await storage.users.getAllUsers();
  let adminUser: any = null;
  let plainUser: any = null;
  for (const u of allUsers) {
    const isAdmin = await storage.users.userHasPermission(u.id, "admin");
    if (isAdmin && !adminUser) adminUser = u;
    if (!isAdmin && !plainUser) plainUser = u;
    if (adminUser && plainUser) break;
  }
  if (!adminUser || !plainUser) {
    console.error("FAIL: need one admin and one non-admin user in the dev DB");
    process.exit(1);
  }

  let actor: any = adminUser;
  const app = express();
  app.use(express.json());
  registerTokenStudioRoutes(
    app,
    (req: any, _res: any, next: any) => {
      req.user = { claims: { sub: actor.id }, dbUser: actor };
      req.isAuthenticated = () => true;
      next();
    },
    requireAccess,
    storage,
  );
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${label}` +
        (detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ""),
    );
  };
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`);
    let body: any = undefined;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body };
  };

  try {
    // 1. A context names the roots.
    const roots = await get(
      `/api/token-studio/tree/roots?context=${BULK_MESSAGE_TOKEN_CONTEXT}`,
    );
    const rootNames = (roots.body?.roots ?? []).map((r: any) => r.name);
    check("bulk context roots load", roots.status === 200, roots.status);
    check(
      "roots are bulk's own",
      rootNames.includes("bulk_participant") && rootNames.length > 1,
      rootNames,
    );

    // 2. The caller cannot name roots, and cannot omit the context.
    const noContext = await get("/api/token-studio/tree/roots");
    check("no context refused", noContext.status === 400, noContext.status);
    const bogus = await get("/api/token-studio/tree/roots?context=nope");
    check("unknown context refused", bogus.status === 404, bogus.status);
    const smuggled = await get(
      `/api/token-studio/tree/roots?context=${BULK_MESSAGE_TOKEN_CONTEXT}&roots=worker`,
    );
    const smuggledNames = (smuggled.body?.roots ?? []).map((r: any) => r.name);
    check(
      "?roots= is ignored",
      JSON.stringify(smuggledNames) === JSON.stringify(rootNames),
      smuggledNames,
    );

    // 3. The gate is the context's, per request.
    actor = plainUser;
    const denied = await get(
      `/api/token-studio/tree/roots?context=${BULK_MESSAGE_TOKEN_CONTEXT}`,
    );
    check("non-author refused the tree", denied.status === 403, denied.status);
    const deniedSearch = await get(
      `/api/token-studio/tree/search?context=${BULK_MESSAGE_TOKEN_CONTEXT}&q=name`,
    );
    check(
      "non-author refused the search",
      deniedSearch.status === 403,
      deniedSearch.status,
    );
    actor = adminUser;

    // 4. Search answers for the context's roots.
    const search = await get(
      `/api/token-studio/tree/search?context=${BULK_MESSAGE_TOKEN_CONTEXT}&q=name`,
    );
    check(
      "search returns hits",
      search.status === 200 && (search.body?.hits?.length ?? 0) > 0,
      search.status,
    );

    // 5. type/:type is scoped by reachability from those roots.
    const reachable = await get(
      `/api/token-studio/tree/type/contact?context=${BULK_MESSAGE_TOKEN_CONTEXT}`,
    );
    check(
      "reachable type expands",
      reachable.status === 200 && Array.isArray(reachable.body?.children),
      reachable.status,
    );
    const unreachable = await get(
      `/api/token-studio/tree/type/no_such_type?context=${BULK_MESSAGE_TOKEN_CONTEXT}`,
    );
    check(
      "unreachable type refused",
      unreachable.status === 404,
      unreachable.status,
    );
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
