/**
 * One-off check for Task #925: the dev FILESYSTEMS env var must configure
 * three filesystems (legacy/public/private) and each must be reachable
 * through the admin file-browser endpoints.
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-dev-filesystems.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { initFileSystems } from "../../server/services/files";
import { registerFileBrowserRoutes } from "../../server/modules/file-browser";

async function main() {
  await loadComponentCache();
  initializePermissions();
  initAccessControl(
    {
      getUserPermissions: async (userId: string) => {
        const permissions = await storage.users.getUserPermissions(userId);
        return permissions.map((p) => p.key);
      },
      hasPermission: async (userId: string, permissionKey: string) =>
        storage.users.userHasPermission(userId, permissionKey),
      getUser: async (userId: string) => storage.users.getUser(userId),
    },
    storage,
    async (componentId: string) => isComponentEnabledSync(componentId),
  );
  initFileSystems([]);

  const allUsers = await storage.users.getAllUsers();
  let adminUser: any = null;
  for (const u of allUsers) {
    if (await storage.users.userHasPermission(u.id, "admin")) {
      adminUser = u;
      break;
    }
  }
  if (!adminUser) {
    console.error("FAIL: no admin user in dev DB; cannot verify");
    process.exit(1);
  }

  const app = express();
  const fakeAuth = (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: adminUser.id }, dbUser: adminUser };
    req.isAuthenticated = () => true;
    next();
  };
  registerFileBrowserRoutes(app, fakeAuth);
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  let failures = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  };

  try {
    const fsRes = await fetch(`${base}/api/admin/filesystems`);
    const fsList = (await fsRes.json()) as any[];
    for (const id of ["legacy", "public", "private"]) {
      check(`filesystems lists ${id} as configured`, fsRes.status === 200 && fsList.some((f) => f.id === id && f.configured));
    }
    const legacy = fsList.find((f) => f.id === "legacy");
    check("legacy is replit/private", legacy?.provider === "replit" && legacy?.access === "private");
    const pub = fsList.find((f) => f.id === "public");
    check("public is local/public", pub?.provider === "local" && pub?.access === "public");
    const priv = fsList.find((f) => f.id === "private");
    check("private is local/private", priv?.provider === "local" && priv?.access === "private");

    for (const id of ["legacy", "public", "private"]) {
      const res = await fetch(`${base}/api/admin/filesystems/${id}/browse`);
      const body = (await res.json()) as any;
      const okStatus = ["ok", "unsupported"].includes(body.status);
      check(`browse ${id} responds with structured status`, res.status === 200 && okStatus, {
        status: body.status,
        entryCount: Array.isArray(body.entries) ? body.entries.length : null,
      });
    }
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
