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
vi.mock("../../server/db", () => ({ db: { transaction: (fn: any) => state.db.transaction(fn) } }));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: vi.fn() }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: () => "https://app.example", isEnvironmentVariableSetInProcess: () => true,
}));
vi.mock("../../server/services/files/config", () => ({
  parseFileSystemsEnv: () => new Map([["assets", { access: "public" }]]),
}));
vi.mock("../../server/services/entity-files/registry", () => ({
  getEntityFileContext: (id: string) => ({ id, publishedAsset: id === "letter_template" }),
  listEntityFileContexts: () => [],
}));
vi.mock("../../server/services/files", () => ({
  fileSystemService: { remove: vi.fn() },
  isFileSystemConfigured: () => true,
  getFileSystemConfig: () => ({ access: "public" }),
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() }, storageLogger: { info: vi.fn() },
}));
import oldMigration from "../../scripts/migrate/core/1204_adopt_template_assets";
import migration from "../../scripts/migrate/core/1219_real_owner_public_images";
import { createEntityFilesStorage } from "../../server/storage/entity-files";
import { createFileStorage } from "../../server/storage/files";

describe("public images PostgreSQL upgrade and ownership", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const attachments = createEntityFilesStorage();
  const fileStorage = createFileStorage();
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "public-images-pg-"));
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
      CREATE TABLE letter_templates (id varchar PRIMARY KEY, content jsonb);
      CREATE TABLE variables (id varchar PRIMARY KEY, name varchar, value jsonb);
      CREATE TABLE entity_metadata (context_id varchar);
    `);
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE entity_files,files,letter_templates,variables,entity_metadata CASCADE; DROP TABLE IF EXISTS template_assets");
  });
  const file = (suffix = "1") => ({
    fileName: "logo.png", storagePath: `custom/${suffix}.png`, mimeType: "image/png",
    size: 67, uploadedBy: "effective-user", fileSystemId: "assets",
    entityType: "entity-files:letter_template", entityId: "owner",
  });
  it("fresh install and reruns leave no synthetic owner table", async () => {
    await oldMigration.up();
    await migration.up();
    await migration.up();
    expect((await pool.query("SELECT to_regclass('template_assets') AS name")).rows[0].name).toBeNull();
  });
  it("preserves identities and paths, reparents only unique references, and keeps shared/unreferenced images", async () => {
    for (const id of ["unique", "shared", "unused"]) {
      await pool.query(`INSERT INTO files(id,file_name,storage_path,size,uploaded_by,file_system_id,entity_type)
        VALUES ($1,'logo.png',$2,67,'historical','assets','template-asset')`, [id, `legacy/${id}.png`]);
    }
    const html = (id: string) => `<img src="https://app.example/public-files/assets/legacy/${id}.png">`;
    await pool.query("INSERT INTO letter_templates VALUES ('one',$1),('two',$2)", [
      JSON.stringify({ bodyHtml: html("unique") + html("shared") }),
      JSON.stringify({ bodyHtml: html("shared") }),
    ]);
    await pool.query(`INSERT INTO variables VALUES ('config','entity_files_config',$1)`, [JSON.stringify({
      template_asset: { file_system: "assets", directory: "legacy/:entity-id", allowed: ["png"] },
      worker_public: { file_system: "other", directory: "keep", allowed: ["jpeg"] },
    })]);
    const before = (await pool.query("SELECT * FROM files ORDER BY id")).rows;
    await oldMigration.up();
    await migration.up();
    await migration.up();
    const after = (await pool.query("SELECT * FROM files ORDER BY id")).rows;
    expect(after).toEqual(before.map(row => ({ ...row,
      entity_type: row.id === "unique" ? "entity-files:letter_template" : "published-image",
      entity_id: row.id === "unique" ? "one" : null,
    })));
    expect((await attachments.list("letter_template", "one")).map(a => a.fileId)).toEqual(["unique"]);
    expect((await pool.query("SELECT count(*)::int AS n FROM entity_files")).rows[0].n).toBe(1);
    const config = (await pool.query("SELECT value FROM variables")).rows[0].value;
    expect(config.template_asset).toBeUndefined();
    expect(config.letter_template).toEqual(config.bulk_message);
    expect(config.worker_public.directory).toBe("keep");
    expect((await pool.query("SELECT to_regclass('template_assets') AS name")).rows[0].name).toBeNull();
  });
  it("rolls back retirement when an attachment has conflicting ownership", async () => {
    await pool.query(`INSERT INTO files(id,file_name,storage_path,size,uploaded_by,file_system_id,entity_type)
      VALUES ('old','logo.png','old.png',67,'historical','public','template-asset');
      INSERT INTO entity_files(context_id,entity_id,file_id,name) VALUES ('worker','worker','old','document')`);
    await expect(migration.up()).rejects.toThrow("conflicting ownership");
    expect((await pool.query("SELECT entity_type FROM files")).rows[0].entity_type).toBe("template-asset");
  });
  it("requires a real owner and rolls back file creation if attachment insertion fails", async () => {
    await expect(attachments.createWithFile("letter_template", "missing", file(), "logo")).rejects.toThrow("owner");
    await pool.query("INSERT INTO letter_templates VALUES ('owner','{}')");
    await expect(attachments.createWithFile("letter_template", "owner", file(), "logo", "unknown-type")).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS n FROM files")).rows[0].n).toBe(0);
  });
  it("allows concurrent multiple images and retains them after owner deletion", async () => {
    await pool.query("INSERT INTO letter_templates VALUES ('owner','{}')");
    const [record] = await Promise.all([
      attachments.createWithFile("letter_template", "owner", file("one"), "one"),
      attachments.createWithFile("letter_template", "owner", file("two"), "two"),
    ]);
    expect((await attachments.list("letter_template", "owner"))).toHaveLength(2);
    await pool.query("DELETE FROM letter_templates WHERE id='owner'");
    expect(await attachments.findOrphans("letter_template", 100)).toEqual([]);
    await expect(attachments.deleteWithFile("letter_template", "owner", record.id)).rejects.toThrow("immutable");
    await expect(attachments.update("letter_template", "owner", record.id, { name: "changed" })).rejects.toThrow("immutable");
    await expect(attachments.transferFileOwnership("letter_template", "owner", record.file.id, { entityType: "worker", entityId: "other" })).rejects.toThrow("immutable");
    await expect(fileStorage.delete(record.file.id)).rejects.toThrow("immutable");
    await expect(fileStorage.update(record.file.id, { storagePath: "other" })).rejects.toThrow("immutable");
    expect((await pool.query("SELECT count(*)::int AS n FROM files")).rows[0].n).toBe(2);
  });
});
