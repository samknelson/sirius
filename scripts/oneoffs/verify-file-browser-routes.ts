/**
 * One-off e2e check for Task #924: the admin file-browser routes must list
 * filesystems, browse with DB-row annotation (orphan flagging), upload
 * (create + replace), download, and delete (row-first) through the service
 * layer.
 *
 * Run:
 *   FILESYSTEMS='{"browsertest":{"name":"Browser Test","access":"private","provider":"local","provider_settings":{"base_path":"/tmp/browsertest-fs"}}}' \
 *   npx tsx scripts/oneoffs/verify-file-browser-routes.ts
 */
import express from "express";
import * as fs from "fs/promises";
import { storage } from "../../server/storage";
import { loadComponentCache, isComponentEnabledSync } from "../../server/services/component-cache";
import { initAccessControl } from "../../server/services/access-policy-evaluator";
import { initializePermissions } from "../../shared/permissions";
import "../../shared/access-policies/loader";
import { initFileSystems } from "../../server/services/files";
import { registerFileBrowserRoutes } from "../../server/modules/file-browser";

const FS_ID = "browsertest";
const BASE = "/tmp/browsertest-fs";

async function main() {
  await fs.rm(BASE, { recursive: true, force: true });
  await fs.mkdir(BASE, { recursive: true });

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

  // Find a real admin user so requireAccess('admin') evaluates truthfully.
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
  console.log("admin user:", adminUser.email ?? adminUser.id);

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
    // Seed: one orphan object (no row), one tracked file via upload route.
    await fs.writeFile(`${BASE}/orphan.bin`, "orphan-bytes");

    // 1. filesystems list includes the configured fs
    const fsRes = await fetch(`${base}/api/admin/filesystems`);
    const fsText = await fsRes.text();
    let fsList: any;
    try { fsList = JSON.parse(fsText); } catch { fsList = fsText; }
    check(
      "filesystems lists browsertest",
      fsRes.status === 200 && Array.isArray(fsList) && fsList.some((f: any) => f.id === FS_ID && f.configured),
      { status: fsRes.status, body: Array.isArray(fsList) ? undefined : fsText.slice(0, 300) },
    );

    // 2. upload (auto path)
    const form = new FormData();
    form.append("file", new Blob(["hello upload"], { type: "text/plain" }), "hello.txt");
    const upRes = await fetch(`${base}/api/admin/filesystems/${FS_ID}/upload`, { method: "POST", body: form });
    const uploaded = await upRes.json();
    check("upload 201 + live row", upRes.status === 201 && uploaded.status === "live" && uploaded.fileSystemId === FS_ID, uploaded.storagePath);

    // 3. upload to explicit path, then replace it
    const form2 = new FormData();
    form2.append("file", new Blob(["v1"], { type: "text/plain" }), "report.txt");
    form2.append("path", "reports/report.txt");
    const up2 = await fetch(`${base}/api/admin/filesystems/${FS_ID}/upload`, { method: "POST", body: form2 });
    const created = await up2.json();
    check("upload to explicit path", up2.status === 201 && created.storagePath === "reports/report.txt");

    const form3 = new FormData();
    form3.append("file", new Blob(["version-two-longer"], { type: "text/plain" }), "report-v2.txt");
    form3.append("path", "reports/report.txt");
    const up3 = await fetch(`${base}/api/admin/filesystems/${FS_ID}/upload`, { method: "POST", body: form3 });
    const replaced = await up3.json();
    check(
      "replace updates same row",
      up3.status === 200 && replaced.id === created.id && replaced.size === "version-two-longer".length,
      { id: replaced.id, size: replaced.size },
    );

    // 4. browse: annotation + orphan flag
    const browse = await (await fetch(`${base}/api/admin/filesystems/${FS_ID}/browse?limit=50`)).json();
    const orphanEntry = browse.entries.find((e: any) => e.path === "orphan.bin");
    const trackedEntry = browse.entries.find((e: any) => e.path === "reports/report.txt");
    check("browse ok status", browse.status === "ok");
    check("orphan flagged", !!orphanEntry && orphanEntry.orphan === true);
    check("tracked entry live + row id", !!trackedEntry && trackedEntry.orphan === false && trackedEntry.rowStatus === "live" && trackedEntry.fileId === created.id);

    // 5. prefix filter
    const prefixed = await (await fetch(`${base}/api/admin/filesystems/${FS_ID}/browse?prefix=reports/`)).json();
    check("prefix filter", prefixed.entries.length === 1 && prefixed.entries[0].path === "reports/report.txt", prefixed.entries.map((e: any) => e.path));

    // 6. download
    const dl = await fetch(`${base}/api/admin/filesystems/${FS_ID}/download?path=${encodeURIComponent("reports/report.txt")}`);
    const body = await dl.text();
    check("download bytes", dl.status === 200 && body === "version-two-longer");
    const dlOrphan = await fetch(`${base}/api/admin/filesystems/${FS_ID}/download?path=orphan.bin`);
    check("download orphan works", dlOrphan.status === 200 && (await dlOrphan.text()) === "orphan-bytes");

    // 7. traversal is rejected
    const trav = await fetch(`${base}/api/admin/filesystems/${FS_ID}/download?path=${encodeURIComponent("../../etc/passwd")}`);
    check("traversal rejected", trav.status === 400, trav.status);

    // 8. delete tracked file: row + object gone
    const del = await fetch(`${base}/api/admin/filesystems/${FS_ID}/object?path=${encodeURIComponent("reports/report.txt")}`, { method: "DELETE" });
    check("delete tracked 200", del.status === 200);
    const rowAfter = await storage.files.getByStoragePath("reports/report.txt", FS_ID);
    const objAfter = await fs.access(`${BASE}/reports/report.txt`).then(() => true, () => false);
    check("row and object removed", !rowAfter && !objAfter);

    // 9. delete orphan (no row)
    const delOrphan = await fetch(`${base}/api/admin/filesystems/${FS_ID}/object?path=orphan.bin`, { method: "DELETE" });
    const orphanGone = !(await fs.access(`${BASE}/orphan.bin`).then(() => true, () => false));
    check("orphan object deleted", delOrphan.status === 200 && orphanGone);

    // 10. DB-only rows (missing / pending_delete with no object) are surfaced
    const missingRow = await storage.files.create({
      fileName: "ghost.txt",
      storagePath: "ghosts/ghost.txt",
      mimeType: "text/plain",
      size: 5,
      uploadedBy: adminUser.id,
      fileSystemId: FS_ID,
      status: "missing",
    });
    const pendingRow = await storage.files.create({
      fileName: "pending.txt",
      storagePath: "ghosts/pending.txt",
      mimeType: "text/plain",
      size: 7,
      uploadedBy: adminUser.id,
      fileSystemId: FS_ID,
      status: "pending_delete",
    });
    const browse2 = await (await fetch(`${base}/api/admin/filesystems/${FS_ID}/browse`)).json();
    const ghost = browse2.entries.find((e: any) => e.path === "ghosts/ghost.txt");
    const pending = browse2.entries.find((e: any) => e.path === "ghosts/pending.txt");
    check("DB-only missing row surfaced", !!ghost && ghost.rowStatus === "missing" && ghost.objectMissing === true && ghost.fileId === missingRow.id);
    check("DB-only pending_delete row surfaced", !!pending && pending.rowStatus === "pending_delete" && pending.objectMissing === true);
    const browsePrefixed = await (await fetch(`${base}/api/admin/filesystems/${FS_ID}/browse?prefix=reports/`)).json();
    check("DB-only rows respect prefix", !browsePrefixed.entries.some((e: any) => e.path.startsWith("ghosts/")));
    await storage.files.delete(missingRow.id);
    await storage.files.delete(pendingRow.id);

    // 11. unconfigured fs browse returns structured status
    const uncfg = await (await fetch(`${base}/api/admin/filesystems/nope/browse`)).json();
    check("unconfigured fs status", uncfg.status === "unconfigured");

    // cleanup remaining rows
    const leftovers = await storage.files.list({ fileSystemId: FS_ID });
    for (const r of leftovers) await storage.files.delete(r.id);
    await fs.rm(BASE, { recursive: true, force: true });
  } finally {
    server.close();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
