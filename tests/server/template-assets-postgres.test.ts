import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any, als: null as any }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.als.getStore() ?? state.db,
  runInTransaction: (fn: () => Promise<unknown>) => state.als.getStore() ? fn()
    : state.db.transaction((tx: any) => state.als.run(tx, fn)),
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/db", () => ({
  db: { transaction: (fn: any) => state.db.transaction(fn) },
}));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: vi.fn() }));
vi.mock("../../server/services/entity-files/registry", () => ({
  getEntityFileContext: () => ({ id: "template_asset" }),
  listEntityFileContexts: () => [],
}));
vi.mock("../../server/services/files", () => ({ fileSystemService: { remove: vi.fn() } }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
  storageLogger: { info: vi.fn() },
}));
import migration from "../../scripts/migrate/core/1204_adopt_template_assets";
import { createEntityFilesStorage } from "../../server/storage/entity-files";
import { createFileStorage } from "../../server/storage/files";

/** Isolated real PostgreSQL: no application, staging or production database. */
describe("template assets PostgreSQL lifecycle", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const attachments = createEntityFilesStorage();
  const fileStorage = createFileStorage();
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "template-assets-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 4, statement_timeout: 5000 });
    state.db = drizzle(pool);
    state.als = new AsyncLocalStorage();
    await pool.query(`
      CREATE TABLE files (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), file_name varchar NOT NULL,
        storage_path varchar NOT NULL, mime_type varchar, size integer NOT NULL,
        uploaded_by varchar NOT NULL, uploaded_at timestamp DEFAULT now() NOT NULL,
        entity_type varchar, entity_id varchar, file_system_id varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'live', metadata jsonb,
        UNIQUE(file_system_id,storage_path));
      CREATE TABLE options_file_type (
        id varchar PRIMARY KEY, name text NOT NULL, description text, sirius_id text, data jsonb);
      CREATE TABLE entity_files (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), context_id varchar NOT NULL,
        entity_id varchar NOT NULL, file_id varchar NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
        type_id varchar REFERENCES options_file_type(id), name varchar(255) NOT NULL, data jsonb);
    `);
    await migration.up();
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE entity_files,files,template_assets CASCADE");
  });
  const file = (suffix = "1") => ({
    fileName: "logo.png", storagePath: `custom/${suffix}.png`, mimeType: "image/png",
    size: 67, uploadedBy: "effective-user", fileSystemId: "assets",
    entityType: "entity-files:template_asset", entityId: "owner",
  });
  it("adopts legacy assets idempotently without touching identity, location, attribution or other files", async () => {
    await pool.query(`INSERT INTO files(id,file_name,storage_path,size,uploaded_by,file_system_id,entity_type)
      VALUES ('old','logo.png','letter-template-assets/old.png',67,'historical','legacy-public','template-asset'),
             ('private','document.pdf','private/doc.pdf',20,'historical','private','worker')`);
    const before = (await pool.query("SELECT * FROM files WHERE id='old'")).rows[0];
    await migration.up();
    await migration.up();
    const after = (await pool.query("SELECT * FROM files WHERE id='old'")).rows[0];
    expect(after).toEqual({ ...before, entity_type: "entity-files:template_asset", entity_id: "old" });
    expect((await pool.query("SELECT count(*)::int AS n FROM template_assets")).rows[0].n).toBe(1);
    expect((await attachments.getByFileId("template_asset", "old", "old"))?.file.storagePath).toBe(before.storage_path);
    expect(await attachments.findOrphans("template_asset", 100)).toEqual([]);
    expect((await pool.query("SELECT entity_type FROM files WHERE id='private'")).rows[0].entity_type).toBe("worker");
  });
  it("rolls back owner, file and attachment together on failed attachment insert", async () => {
    await expect(attachments.createWithFile("template_asset", "owner", file(), "logo", "unknown-type", true)).rejects.toThrow();
    for (const table of ["template_assets", "files", "entity_files"]) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    }
  });
  it("refuses conflicting legacy adoption transactionally", async () => {
    await pool.query(`INSERT INTO files(id,file_name,storage_path,size,uploaded_by,file_system_id,entity_type)
      VALUES ('old','logo.png','old.png',67,'historical','public','template-asset')`);
    await pool.query(`INSERT INTO entity_files(context_id,entity_id,file_id,name) VALUES ('worker','worker','old','document')`);
    await expect(migration.up()).rejects.toThrow("another attachment");
    expect((await pool.query("SELECT count(*)::int AS n FROM template_assets")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT entity_type FROM files")).rows[0].entity_type).toBe("template-asset");
  });
  it("rolls back multi-write adoption if attaching fails after the owner insert", async () => {
    await pool.query(`INSERT INTO files(id,file_name,storage_path,size,uploaded_by,file_system_id,entity_type)
      VALUES ('old','logo.png','old.png',67,'historical','public','template-asset');
      CREATE FUNCTION refuse_test_attachment() RETURNS trigger LANGUAGE plpgsql AS
        $$ BEGIN RAISE EXCEPTION 'attachment metadata unavailable'; END $$;
      CREATE TRIGGER refuse_test_attachment BEFORE INSERT ON entity_files
        FOR EACH ROW EXECUTE FUNCTION refuse_test_attachment();`);
    try {
      await expect(migration.up()).rejects.toMatchObject({ cause: expect.objectContaining({ message: "attachment metadata unavailable" }) });
      expect((await pool.query("SELECT count(*)::int AS n FROM template_assets")).rows[0].n).toBe(0);
      expect((await pool.query("SELECT entity_type FROM files")).rows[0].entity_type).toBe("template-asset");
    } finally {
      await pool.query("DROP TRIGGER refuse_test_attachment ON entity_files; DROP FUNCTION refuse_test_attachment()");
    }
    await migration.up();
    expect((await attachments.getByFileId("template_asset", "old", "old"))?.file.id).toBe("old");
  });
  it("retains publication independently of templates, refuses replacement, delete, transfer and path changes", async () => {
    const record = await attachments.createWithFile("template_asset", "owner", file(), "logo", null, true);
    expect(record.file.uploadedBy).toBe("effective-user");
    expect(await attachments.assetOwnerExists("owner")).toBe(true);
    await expect(attachments.createWithFile("template_asset", "owner", file("2"), "replacement")).rejects.toThrow("immutable");
    await expect(attachments.update("template_asset", "owner", record.id, { name: "rename" })).rejects.toThrow("immutable");
    await expect(attachments.deleteWithFile("template_asset", "owner", record.id)).rejects.toThrow("immutable");
    await expect(attachments.transferFileOwnership("template_asset", "owner", record.fileId, { entityType: "worker", entityId: "worker" })).rejects.toThrow("immutable");
    await expect(fileStorage.delete(record.fileId)).rejects.toThrow("immutable");
    await expect(fileStorage.update(record.fileId, { storagePath: "moved.png" })).rejects.toThrow("immutable");
    await expect(fileStorage.renameStoragePathPrefix("assets", "custom", "moved")).rejects.toThrow("immutable");
    expect((await attachments.list("template_asset", "owner")).length).toBe(1);
    expect(await attachments.findOrphans("template_asset", 100)).toEqual([]);
  });
  it("serializes concurrent attachment attempts for an existing empty owner", async () => {
    await pool.query("INSERT INTO template_assets(id) VALUES ('owner')");
    const results = await Promise.allSettled([
      attachments.createWithFile("template_asset", "owner", file("one"), "one"),
      attachments.createWithFile("template_asset", "owner", file("two"), "two"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await attachments.list("template_asset", "owner"))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM files")).rows[0].n).toBe(1);
  });
});
