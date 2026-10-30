import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any, als: null as any, storage: null as any, checked: [] as any[] }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.als.getStore() ?? state.db,
  runInTransaction: (fn: () => Promise<unknown>) => state.als.getStore() ? fn()
    : state.db.transaction((tx: any) => state.als.run(tx, fn)),
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ get storage() { return state.storage; } }));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  storageLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (value: unknown) => value,
  withStorageLogging: (value: unknown) => value,
}));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: vi.fn() }, EventType: {} }));
vi.mock("../../server/modules/components", () => ({ requireComponent: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string) => (req: any, res: any, next: any) => {
    const role = req.headers["x-fixture-role"];
    if (!role) return res.status(401).end();
    if (policy === "staff" && !["staff", "admin"].includes(role)) return res.status(403).end();
    next();
  },
  checkAccessInline: async (req: any, policy: string, id: string, data: any) => {
    state.checked.push({ policy, id, data });
    return { granted: ["staff", "admin", "owner"].includes(req.headers["x-fixture-role"]) };
  },
}));
vi.mock("../../server/utils/pdfGenerator", () => ({ generateInvoicePdf: vi.fn() }));
vi.mock("../../server/modules/ledger/transaction-query", () => ({ respondWithTransactions: vi.fn() }));
vi.mock("../../server/services/migration-runner", () => ({ registerMigration: vi.fn() }));
import migration from "../../scripts/migrate/core/1206_lock_ledger_identity";
import { installLedgerIdentityProtection } from "../../server/storage/ledger/identity-protection";
import { createLedgerStorage } from "../../server/storage/ledger";
import { registerLedgerEaRoutes } from "../../server/modules/ledger/ea";
import { registerLedgerAccountRoutes } from "../../server/modules/ledger/accounts";
import { ledgerIdentityConflictMessage } from "@shared/ledger/immutable-identity";

/** Real disposable PostgreSQL, never reads DATABASE_URL or a remote database.
 * Auth is an explicit route-harness stub, not a signed-in browser session. */
describe("permanent ledger identity across HTTP, storage and PostgreSQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    root = mkdtempSync(`${tmpdir()}/ledger-identity-pg-`);
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`,
      "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 6, statement_timeout: 5000 });
    state.db = drizzle(pool);
    state.als = new AsyncLocalStorage();
    state.storage = { ledger: createLedgerStorage() };
    // Absent optional schema: both the upgrade and bootstrap/enable installer
    // are safe, even with concurrent calls.
    await Promise.all([migration.up(), installLedgerIdentityProtection()]);
    await pool.query(`
      CREATE TABLE ledger_accounts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
        description text, currency_code text NOT NULL DEFAULT 'USD',
        is_active boolean NOT NULL DEFAULT true, data jsonb, sirius_id varchar UNIQUE, gateway_config_id varchar
      );
      CREATE TABLE ledger_ea (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), account_id varchar NOT NULL REFERENCES ledger_accounts,
        entity_type varchar NOT NULL, entity_id varchar NOT NULL, data jsonb,
        UNIQUE(account_id, entity_id)
      );
      CREATE TABLE options_ledger_payment_type (id varchar PRIMARY KEY, name text, category text);
      CREATE TABLE ledger_payments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL, allocated boolean NOT NULL DEFAULT false,
        amount numeric(10,2) NOT NULL, payment_type varchar NOT NULL REFERENCES options_ledger_payment_type,
        ledger_ea_id varchar NOT NULL REFERENCES ledger_ea, details jsonb, date_received timestamp,
        date_cleared timestamp, memo text
      );
      CREATE TABLE ledger (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), charge_plugin varchar NOT NULL, charge_plugin_key varchar NOT NULL,
        charge_plugin_config_id varchar, amount numeric(10,2) NOT NULL, ea_id varchar NOT NULL REFERENCES ledger_ea ON DELETE RESTRICT,
        reference_type varchar, reference_id varchar, date timestamp, memo text, data jsonb, statement_ymd date NOT NULL,
        UNIQUE(charge_plugin,charge_plugin_key)
      );
      CREATE TABLE ledger_payment_attempts (
        id varchar PRIMARY KEY, ledger_ea_id varchar REFERENCES ledger_ea ON DELETE RESTRICT,
        account_id varchar, entity_type varchar, entity_id varchar, currency varchar, amount numeric, status text,
        statement_selection jsonb, gateway_config_id varchar, ledger_payment_id varchar
      );
      CREATE TABLE winston_logs (id serial PRIMARY KEY, module text,operation text,level text,meta jsonb);
      CREATE TABLE identity_test_metadata (id varchar PRIMARY KEY, rev integer, data jsonb);
    `);
    await Promise.all([migration.up(), installLedgerIdentityProtection(), installLedgerIdentityProtection()]);
    const app = express();
    app.use(express.json());
    registerLedgerEaRoutes(app);
    registerLedgerAccountRoutes(app);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 30000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    state.checked = [];
    await pool.query(`
      TRUNCATE ledger,ledger_payments,ledger_payment_attempts,ledger_ea,ledger_accounts,options_ledger_payment_type,identity_test_metadata CASCADE;
      INSERT INTO ledger_accounts(id,name,currency_code) VALUES ('account','Original','USD'),('same-unit','Other','USD'),('cross-unit','Other unit','EUR');
      INSERT INTO ledger_ea(id,account_id,entity_type,entity_id,data) VALUES
        ('ea','account','worker','participant','{"note":"original"}'),
        ('empty','account','employer','empty-participant','{"note":"original"}'),
        ('destination','account','worker','destination-participant',NULL);
      INSERT INTO options_ledger_payment_type VALUES ('type','Cash','financial');
      INSERT INTO ledger_payments(id,status,amount,payment_type,ledger_ea_id,details) VALUES
        ('payment','cleared',40,'type','ea','{"proposedAllocation":[{"eaId":"ea","amount":"40.00","statementYmd":"2026-01-01"}]}');
      INSERT INTO ledger(id,charge_plugin,charge_plugin_key,amount,ea_id,statement_ymd,reference_type,reference_id) VALUES
        ('charge','fixture','charge',100,'ea','2026-01-01',NULL,NULL),
        ('allocation','fixture','allocation',-40,'ea','2026-01-01','payment','payment');
      INSERT INTO ledger_payment_attempts VALUES ('attempt','ea','account','worker','participant','USD',40,'succeeded','[{"amount":"40.00"}]','gateway','payment');
      INSERT INTO identity_test_metadata VALUES ('ea',3,'{"note":"original"}');
    `);
  });
  const request = (url: string, body: object, role = "staff", method = "PUT") => fetch(origin + url, {
    method, headers: { "content-type": "application/json", "x-fixture-role": role }, body: JSON.stringify(body),
  });
  async function snapshot() {
    const tables = ["ledger_ea", "ledger_accounts", "ledger", "ledger_payments", "ledger_payment_attempts", "identity_test_metadata"];
    const rows: Record<string, unknown> = {};
    for (const table of tables) rows[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    rows.balance = await state.storage.ledger.ea.getBalance("ea");
    return rows;
  }
  const changes = [
    { entityType: "employer" }, { entityType: "trust_provider" }, { entityId: "private-destination" },
    { accountId: "same-unit" }, { accountId: "cross-unit" }, { accountId: "missing-destination" },
    { entityType: null }, { entityId: null }, { accountId: null },
  ];
  it.each(["staff", "admin", "owner"])("rejects every EA change atomically for %s, empty or populated", async role => {
    for (const id of ["ea", "empty"]) for (const change of changes) {
      const mutation = id === "empty" && change.entityType === "employer" ? { entityType: "worker" } : change;
      const before = await snapshot();
      const response = await request(`/api/ledger/ea/${id}`, { ...mutation, data: { note: "must not save" } }, role);
      expect(response.status).toBe(409);
      expect((await response.json()).message).toContain("permanent");
      expect(await snapshot()).toEqual(before);
      expect(state.checked.at(-1)).toMatchObject({
        policy: "ledger.ea.edit", id: id === "ea" ? "participant" : "empty-participant",
        data: { entityType: id === "ea" ? "worker" : "employer" },
      });
    }
  });
  it("keeps access-denied behavior ahead of parsing and destination disclosure", async () => {
    const before = await snapshot();
    for (const role of ["outsider", "worker-without-access", "employer-without-access"]) {
      for (const body of [{ accountId: "private-destination" }, { entityId: null }]) {
        const response = await request("/api/ledger/ea/ea", body, role);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ message: "Access denied" });
      }
      expect((await request("/api/ledger/accounts/account", { currencyCode: "EUR" }, role)).status).toBe(403);
    }
    expect((await request("/api/ledger/ea/ea", { accountId: "missing" }, "")).status).toBe(401);
    expect(await snapshot()).toEqual(before);
  });
  it("rejects currency changes explicitly through PUT and PATCH, before other fields save", async () => {
    const before = await snapshot();
    for (const role of ["staff", "admin"]) for (const method of ["PUT", "PATCH"]) {
      for (const currencyCode of ["EUR", null]) {
        const response = await request("/api/ledger/accounts/account",
          { currencyCode, name: "must not save", data: { invoicesEnabled: true } }, role, method);
        expect(response.status).toBe(409);
        expect((await response.json()).message).toContain("currency is permanent");
        expect(await snapshot()).toEqual(before);
      }
    }
  });
  it("accepts unchanged echoes, data-only updates, identity-only requests, and new creations", async () => {
    const identity = { entityType: "worker", entityId: "participant", accountId: "account" };
    expect((await request("/api/ledger/ea/ea", { ...identity, data: { note: "edited" } }, "owner")).status).toBe(200);
    expect(await state.storage.ledger.ea.get("ea")).toMatchObject({ ...identity, data: { note: "edited" } });
    expect((await request("/api/ledger/ea/ea", identity)).status).toBe(200);
    expect((await request("/api/ledger/ea/ea", { data: null })).status).toBe(200);
    expect((await request("/api/ledger/accounts/account", { currencyCode: "USD", name: "Renamed", siriusId: " external " })).status).toBe(200);
    expect((await request("/api/ledger/accounts/account", { currencyCode: "USD" })).status).toBe(200);
    expect((await request("/api/ledger/accounts/account", { currencyCode: "USD", data: { invoicesEnabled: true } }, "staff", "PATCH")).status).toBe(200);
    expect(await state.storage.ledger.accounts.get("account")).toMatchObject({ name: "Renamed", siriusId: "external", currencyCode: "USD" });
    const created = await request("/api/ledger/ea", { accountId: "cross-unit", entityType: "worker", entityId: "new-participant" }, "staff", "POST");
    expect(created.status).toBe(201);
    expect((await request("/api/ledger/accounts", { name: "New", currencyCode: "USD" }, "staff", "POST")).status).toBe(201);
  });
  it("guards internal callers and strips runtime-injected primary keys without saving mixed updates", async () => {
    for (const id of ["ea", "empty"]) for (const change of changes) {
      const mutation = id === "empty" && change.entityType === "employer" ? { entityType: "worker" } : change;
      const before = await snapshot();
      await expect(state.storage.ledger.ea.update(id, { ...mutation, data: { note: "lost" } })).rejects.toThrow("permanent");
      expect(await snapshot()).toEqual(before);
    }
    const before = await snapshot();
    await expect(state.storage.ledger.accounts.update("account", { currencyCode: "EUR", name: "lost" })).rejects.toThrow("permanent");
    expect(await snapshot()).toEqual(before);
    await state.storage.ledger.ea.update("ea", { id: "hijacked", data: { note: "valid" } });
    expect(await state.storage.ledger.ea.get("hijacked")).toBeUndefined();
    expect(await state.storage.ledger.ea.get("ea")).toMatchObject({ data: { note: "valid" } });
  });
  it("rejects direct SQL (including replication mode), preserves statement atomicity, accepts equal values", async () => {
    for (const id of ["ea", "empty"]) for (const [column, value] of [
      ["entity_type", "employer"], ["entity_id", "other"], ["account_id", "same-unit"], ["account_id", "cross-unit"],
    ]) {
      // 'empty' is already employer.
      const next = column === "entity_type" && id === "empty" ? "worker" : value;
      const before = await snapshot();
      let failure: unknown;
      try { await pool.query(`UPDATE ledger_ea SET ${column}=$1,data='{"note":"lost"}' WHERE id=$2`, [next, id]); }
      catch (error) { failure = error; }
      expect(ledgerIdentityConflictMessage(failure)).toContain("permanent");
      expect(await snapshot()).toEqual(before);
    }
    const before = await snapshot();
    await expect(pool.query(`UPDATE ledger_accounts SET currency_code='EUR',name='lost' WHERE id='account'`)).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`UPDATE ledger_ea SET entity_id=CASE WHEN id='ea' THEN 'changed' ELSE entity_id END,data='{}'`)).rejects.toMatchObject({ code: "23514" });
    const client = await pool.connect();
    try {
      await client.query("SET session_replication_role = replica");
      await expect(client.query(`UPDATE ledger_ea SET entity_id='changed' WHERE id='ea'`)).rejects.toMatchObject({ code: "23514" });
    } finally { await client.query("RESET session_replication_role"); client.release(); }
    expect(await snapshot()).toEqual(before);
    await pool.query(`UPDATE ledger_ea SET entity_type=entity_type,entity_id=entity_id,account_id=account_id,data='{"note":"ok"}'`);
    await pool.query(`UPDATE ledger_accounts SET currency_code=currency_code,description='ok'`);
  });
  it("serializes competing writes without any successful ownership change", async () => {
    const before = await snapshot();
    const results = await Promise.allSettled([
      state.storage.ledger.ea.update("ea", { entityId: "race-a", data: {} }),
      state.storage.ledger.ea.update("ea", { accountId: "cross-unit", data: {} }),
      pool.query(`UPDATE ledger_ea SET entity_type='provider',data='{}' WHERE id='ea'`),
      pool.query(`UPDATE ledger_accounts SET currency_code='EUR',name='lost' WHERE id='account'`),
    ]);
    expect(results.every(result => result.status === "rejected")).toBe(true);
    expect(await snapshot()).toEqual(before);
    const valid = await Promise.all([
      state.storage.ledger.ea.update("ea", { entityId: "participant", data: { note: "valid" } }),
      request("/api/ledger/ea/ea", { entityId: "race-b", data: {} }),
    ]);
    expect(valid[1].status).toBe(409);
    expect(await state.storage.ledger.ea.get("ea")).toMatchObject({ entityId: "participant", data: { note: "valid" } });
  });
  it("leaves transaction-level reconciliation and allocations writable, never EA ownership", async () => {
    await state.storage.ledger.entries.update("charge", { eaId: "destination" });
    // Approved source-proof repair uses this path, not ea.update.
    await state.storage.ledger.payments.updateForMigration("payment", { ledgerEaId: "destination" });
    await state.storage.ledger.entries.update("allocation", { eaId: "destination" });
    expect(await state.storage.ledger.ea.getBalance("destination")).toBe("60.00");
    expect(await state.storage.ledger.ea.getBalance("ea")).toBe("0.00");
    expect((await pool.query("SELECT ledger_ea_id,entity_id FROM ledger_payment_attempts")).rows[0]).toEqual({ ledger_ea_id: "ea", entity_id: "participant" });
    const response = await request("/api/ledger/ea/ea", {}, "staff", "DELETE");
    expect(response.status).toBe(409); // attempt still references this EA
    expect((await request("/api/ledger/ea/empty", {}, "staff", "DELETE")).status).toBe(204);
  });
  it("runs the aggregate integrity procedure read-only without exposing participant or gateway IDs", async () => {
    const before = await snapshot();
    const output = execFileSync("psql", ["-X", "-h", root, "-U", "postgres", "-d", "postgres",
      "--set=ON_ERROR_STOP=1", "--file=docs/ledger-identity-review.sql"], { encoding: "utf8" });
    expect(output).toContain("coordinate_mismatches");
    expect(output).toContain("observed_payment_reattributions");
    expect(output).toContain("ROLLBACK");
    expect(output).not.toContain("empty-participant");
    expect(output).not.toContain("destination-participant");
    expect(await snapshot()).toEqual(before);
  });
  it("reinstalls after fresh schema creation, handles partial absence, and remains ALWAYS enabled", async () => {
    await pool.query("DROP TABLE ledger_ea CASCADE");
    await installLedgerIdentityProtection(); // one table absent
    await pool.query(`CREATE TABLE ledger_ea(id varchar PRIMARY KEY,entity_type varchar,entity_id varchar,account_id varchar,data jsonb);
      INSERT INTO ledger_ea VALUES ('ea','worker','participant','account',NULL)`);
    await Promise.all([installLedgerIdentityProtection(), migration.up()]);
    await expect(pool.query(`UPDATE ledger_ea SET entity_id='changed' WHERE id='ea'`)).rejects.toMatchObject({ code: "23514" });
    const triggers = await pool.query(`SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('ledger_ea_identity_immutable','ledger_accounts_currency_immutable') ORDER BY tgname`);
    expect(triggers.rows).toEqual([
      { tgname: "ledger_accounts_currency_immutable", tgenabled: "A" },
      { tgname: "ledger_ea_identity_immutable", tgenabled: "A" },
    ]);
  });
});

it("installs after bootstrap and before routes, and before enabling ledger access", () => {
  const boot = readFileSync("server/app-init.ts", "utf8");
  const enable = readFileSync("server/modules/components.ts", "utf8");
  expect(boot.indexOf("await installLedgerIdentityProtection()")).toBeGreaterThan(boot.indexOf("await runSchemaBringUp()"));
  expect(boot.indexOf("await installLedgerIdentityProtection()")).toBeLessThan(boot.indexOf("await armMaintenanceEnforcement()"));
  const branch = enable.indexOf('componentId === "ledger" && enabled');
  expect(branch).toBeGreaterThan(-1);
  expect(enable.indexOf("await installLedgerIdentityProtection()", branch)).toBeLessThan(enable.indexOf("await updateComponentCache(componentId, enabled)", branch));
  const repair = readFileSync("scripts/s1-migration/lib/financial-link-repair.ts", "utf8");
  expect(repair).toContain("storage.ledger.entries.update");
  expect(repair).toContain("storage.ledger.payments.updateForMigration");
  expect(repair).not.toContain("storage.ledger.ea.update");
});
