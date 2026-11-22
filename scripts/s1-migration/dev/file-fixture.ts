/** Only invoked by rehearse-files.mjs with a clean environment and disposable DB. */
import pg from "pg";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");
import * as schema from "../../../shared/schema";
import { getEnvironmentVariable } from "../lib/script-env";

const url = getEnvironmentVariable("EXTERNAL_DATABASE_URL")!;
const parsed = new URL(url);
if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/s1_file_target") throw new Error("fixture_target_refused");
const client = new pg.Client({ connectionString: url });
await client.connect();
if ((await client.query("SELECT current_database() AS name")).rows[0].name !== "s1_file_target") throw new Error("fixture_identity_refused");
try {
  if (process.argv[2] === "schema") {
    await client.query("CREATE FUNCTION worker_sirius_id_default() RETURNS varchar LANGUAGE sql AS $$ SELECT NULL::varchar $$");
    const before = generateDrizzleJson({});
    const after = generateDrizzleJson(schema);
    for (const statement of await generateMigration(before, after)) await client.query(statement);
    console.log("synthetic schema created");
  } else if (process.argv[2] === "stage") {
    const sourceUrl = new URL(url); sourceUrl.pathname = "/s1_file_source";
    const source = new pg.Pool({ connectionString: sourceUrl.toString() });
    if ((await source.query("SELECT current_database() AS name")).rows[0].name !== "s1_file_source") throw new Error("fixture_source_refused");
    const { ensureStagingSchema, upsertRecords } = await import("../lib/staging");
    const { ensureIdMap } = await import("../lib/idmap");
    const { stageRawFiles } = await import("../lib/file-staging");
    await ensureStagingSchema(); await ensureIdMap();
    // PostgreSQL fixture adapter exercises the exact keyset/count SQL; this
    // does not claim real MariaDB transport acceptance.
    const adapter = { query: async (statement: string, params?: unknown[]) => {
      let i = 0;
      const result = await source.query(statement.replace(/\?/g, () => `$${++i}`), params);
      return [result.rows];
    } };
    await stageRawFiles(adapter as any, 2);
    const beforeInventory = JSON.stringify((await client.query("SELECT * FROM s1_staging.raw_file_managed ORDER BY fid")).rows);
    let calls = 0;
    const interrupted = { query: async (statement: string, params?: unknown[]) => {
      if (++calls === 3) throw new Error("CANARY_SOURCE_ERROR");
      return adapter.query(statement, params);
    } };
    await assert.rejects(() => stageRawFiles(interrupted as any, 2), /inventory not published/);
    assert.equal(JSON.stringify((await client.query("SELECT * FROM s1_staging.raw_file_managed ORDER BY fid")).rows), beforeInventory);
    let countCalls = 0;
    const moving = { query: async (statement: string, params?: unknown[]) => {
      const result = await adapter.query(statement, params);
      if (statement.includes("COUNT(*)") && ++countCalls === 2) result[0][0].n = 999;
      return result;
    } };
    const settled = await stageRawFiles(moving as any, 2);
    assert.equal(settled.status, "verified");
    assert.equal(settled.attempts, 2);
    const snapshot = async () => JSON.stringify({
      inventory: (await client.query("SELECT * FROM s1_staging.raw_file_managed ORDER BY fid")).rows,
      evidence: (await client.query("SELECT * FROM s1_staging.file_inventory_evidence")).rows,
    });
    const stableSnapshot = await snapshot();
    countCalls = 0;
    const alwaysMoving = { query: async (statement: string, params?: unknown[]) => {
      const result = await adapter.query(statement, params);
      if (statement.includes("COUNT(*)") && ++countCalls % 2 === 0) result[0][0].n = 999;
      return result;
    } };
    const skipped = await stageRawFiles(alwaysMoving as any, 2);
    assert.equal(skipped.status, "skipped_changing");
    assert.equal(skipped.attempts, 3);
    assert.equal(countCalls, 6);
    assert.equal(await snapshot(), stableSnapshot);
    assert.equal((await client.query("SELECT status FROM s1_staging.file_inventory_attempt")).rows[0].status, "skipped_changing");
    const removed = (await source.query("DELETE FROM file_managed WHERE fid=7 RETURNING *")).rows[0];
    assert.equal((await stageRawFiles(adapter as any, 2)).staleRemoved, 1);
    assert.equal((await client.query("SELECT count(*)::int n FROM s1_staging.raw_file_managed")).rows[0].n, 6);
    await source.query("INSERT INTO file_managed(fid,uid,filename,uri,filemime,filesize,status,timestamp) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [removed.fid, removed.uid, removed.filename, removed.uri, removed.filemime, removed.filesize, removed.status, removed.timestamp]);
    await stageRawFiles(adapter as any, 2);
    await upsertRecords([
      { bundle: "sirius_worker", nid: 1, fields: {} },
      { bundle: "sirius_worker", nid: 4, fields: {} },
      { bundle: "grievance_shop", nid: 2, fields: { field_grievance_contract: { fid: 4 }, field_grievance_attachments: [{ fid: 5 }] } },
      { bundle: "sirius_payment", nid: 3, fields: {} },
      ...["material", "trust:election_wizard", "comment", "comment", "feed:prior"].map((category, i) => ({
        bundle: "sirius_log", nid: 10 + i, fields: {
          field_sirius_category: category, field_sirius_type: i === 1 ? "draft" : "public",
          field_sirius_log_handler: [i === 3 ? 3 : 1],
          field_sirius_attachments: [{ fid: i < 3 ? i + 1 : i + 3 }],
          field_sirius_json: JSON.stringify({ material: { title: "CANARY_MATERIAL_TITLE" },
            wizard: { trust_election: { documents: [{ fid: 2, relationship_nid: 99 }] } } }),
        },
      })),
    ].map(n => ({ ...n, vid: 1, title: "CANARY_NODE_TITLE", uid: 8, status: 1, created: 1600000000, changed: 1600000000 })));
    await source.end();
    const { pool } = await import("../../../server/storage/db");
    await pool.end();
    console.log("synthetic source staged");
  } else if (process.argv[2] === "loader-owner-missing") {
    // Simulate a single owner disappearing between source resolution and the
    // context preflight. All other reads/writes still use the disposable DB.
    const { storage } = await import("../../../server/storage/database");
    const original = storage.workers.getWorker.bind(storage.workers);
    storage.workers.getWorker = async id => id === "worker-missing-fixture" ? undefined : original(id);
    process.argv = [process.argv[0], process.argv[1], ...process.argv.slice(3)];
    await import("../load-files");
  } else if (process.argv[2] === "access") {
    await import("../../../shared/access-policies/loader");
    const { storage } = await import("../../../server/storage/database");
    const { registerFileRoutes } = await import("../../../server/modules/files");
    const { registerEntityFileContexts } = await import("../../../server/modules/entity-files-contexts");
    const { wireEntityFilesFileReadAccess } = await import("../../../server/services/entity-files/file-read-access");
    const { initAccessControl, registerEntityLoader } = await import("../../../server/services/access-policy-evaluator");
    const { isComponentEnabled } = await import("../../../server/modules/components");
    const express = (await import("express")).default;
    registerEntityFileContexts(); wireEntityFilesFileReadAccess();
    initAccessControl({
      getUserPermissions: async id => id === "synthetic-staff" ? ["staff"] : [],
      hasPermission: async (id, key) => id === "synthetic-staff" && key === "staff",
      getUser: async () => undefined,
    }, storage, isComponentEnabled);
    registerEntityLoader("file", async id => await storage.files.getById(id) ?? null);
    const app = express();
    app.use((req, _res, next) => {
      // This non-staff actor is also the validated uploader of one file:
      // generic uploader access must not bypass the staff-only context.
      const id = req.headers["x-synthetic-actor"] === "staff" ? "synthetic-staff" : "uploader-a";
      (req as any).user = { claims: { sub: id }, dbUser: { id, email: `${id}@example.test`, isActive: true } };
      next();
    });
    registerFileRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address() as { port: number };
      const fileRows = (await client.query("SELECT id FROM files WHERE entity_type IN ('entity-files:worker','entity-files:employer','entity-files:ledger_payment')")).rows;
      assert.ok(fileRows.length >= 3);
      for (const file of fileRows) {
        const url = `http://127.0.0.1:${address.port}/api/files/${file.id}/download`;
        const member = await fetch(url, { headers: { "x-synthetic-actor": "member" } });
        assert.equal(member.status, 403); await member.text();
        const staff = await fetch(url, { headers: { "x-synthetic-actor": "staff" } });
        assert.equal(staff.status, 200); assert.equal(await staff.text(), "synthetic");
        const detail = await fetch(url.replace("/download", ""), { headers: { "x-synthetic-actor": "staff" } });
        assert.equal(detail.status, 200);
        const record = await detail.json() as { uploadedAt: string; mimeType: string; fileName: string };
        assert.equal(new Date(record.uploadedAt).getTime(), 1600000000 * 1000);
        assert.equal(record.mimeType, "application/pdf");
        assert.ok(record.fileName.startsWith("CANARY_FILENAME_"));
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    const { drainStorageSideEffects } = await import("../../../server/storage/drain-storage-side-effects");
    await drainStorageSideEffects();
    const { pool } = await import("../../../server/storage/db"); await pool.end();
    console.log("synthetic staff/member download routes passed");
  } else throw new Error("fixture_command_refused");
} finally { await client.end(); }
