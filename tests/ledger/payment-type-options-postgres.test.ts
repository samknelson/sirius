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

const state = vi.hoisted(() => ({ db: null as any, als: null as any }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.als.getStore() ?? state.db,
  runInTransaction: (fn: () => Promise<unknown>) => state.als.getStore() ? fn()
    : state.db.transaction((tx: any) => state.als.run(tx, fn)),
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (config: any) => config,
  withStorageLogging: (storage: any) => storage,
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: vi.fn() }, EventType: {} }));
vi.mock("../../server/modules/ledger/payment-type-correction", () => ({ registerPaymentTypeCorrectionRoutes: vi.fn() }));
vi.mock("../../server/modules/components", () => ({
  isComponentEnabled: async () => true,
  requireComponent: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: any, _res: any, next: any) => next(),
}));
import { createUnifiedOptionsStorage, optionsMetadata } from "../../server/storage/unified-options";
import { createLedgerPaymentStorage } from "../../server/storage/ledger";
import { runInTransaction } from "../../server/storage/transaction-context";
import { getOptionsType } from "../../server/modules/options-registry";
import { runOptionsImport } from "../../server/modules/options-transfer";
import { registerConsolidatedOptionsRoutes } from "../../server/modules/options-routes";

// Real isolated PostgreSQL with synthetic data only; never uses DATABASE_URL.
describe("option validation through storage, HTTP, imports and concurrent posting", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  let server: Server;
  let origin: string;
  const options = createUnifiedOptionsStorage();
  const payments = createLedgerPaymentStorage();
  const type = "ledger-payment-type";
  const originalHook = optionsMetadata[type].beforeWrite!;
  const post = () => runInTransaction(() => payments.create({
    paymentType: "type", ledgerEaId: "ea", status: "cleared", amount: "10.00",
  }));
  beforeAll(async () => {
    root = mkdtempSync(`${tmpdir()}/option-validation-pg-`);
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/pg.log`,
      "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 6, statement_timeout: 5000 });
    state.db = drizzle(pool);
    state.als = new AsyncLocalStorage();
    await pool.query(`
      CREATE TABLE options_ledger_payment_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text,
        sirius_id text, category text DEFAULT 'financial', currency_code text DEFAULT 'USD',
        direction text NOT NULL DEFAULT 'credit', sequence integer DEFAULT 0, data jsonb
      );
      CREATE TABLE ledger_accounts (
        id varchar PRIMARY KEY, name text, description text, currency_code text,
        is_active boolean, data jsonb, sirius_id text, gateway_config_id varchar
      );
      CREATE TABLE ledger_ea (id varchar PRIMARY KEY, account_id varchar, entity_type text, entity_id varchar, data jsonb);
      CREATE TABLE ledger_payments (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), status text, allocated boolean DEFAULT false,
        amount numeric, payment_type varchar REFERENCES options_ledger_payment_type,
        ledger_ea_id varchar, details jsonb, date_received timestamp, date_cleared timestamp, memo text
      );
      CREATE TABLE options_department (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text, data jsonb);
      CREATE TABLE options_worker_ratings (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name text, parent varchar, sirius_id varchar, data jsonb);
      INSERT INTO ledger_accounts(id,name,currency_code) VALUES ('account','Fixture','USD');
      INSERT INTO ledger_ea VALUES ('ea','account','worker','fixture',NULL);
    `);
    const app = express();
    app.use(express.json());
    registerConsolidatedOptionsRoutes(app);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    optionsMetadata[type].beforeWrite = originalHook;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (pool) await pool.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    optionsMetadata[type].beforeWrite = originalHook;
    await pool.query(`TRUNCATE ledger_payments,options_ledger_payment_type,options_department,options_worker_ratings;
      INSERT INTO options_ledger_payment_type(id,name) VALUES ('type','Fixture');`);
  });

  it("registers validation without route initialization and keeps callbacks out of definitions", () => {
    expect(originalHook).toBeTypeOf("function");
    expect(options.getDefinition(type)).not.toHaveProperty("beforeWrite");
    const core = readFileSync("server/storage/unified-options.ts", "utf8");
    for (const key of Object.keys(optionsMetadata)) expect(core).not.toContain(`"${key}"`);
    expect(core).not.toMatch(/@shared\/schema|cleared payments|Ledger effect/);
  });
  it("keeps the database default, accepts both directions, rejects explicit invalid values", async () => {
    expect(await options.create(type, { name: "Default" })).toMatchObject({ direction: "credit" });
    for (const direction of ["charge", "credit"]) {
      expect(await options.create(type, { name: direction, direction })).toMatchObject({ direction });
    }
    for (const direction of [null, "", "other", 0, false]) {
      await expect(options.create(type, { name: "Invalid", direction })).rejects.toThrow("Charge or Credit");
      await expect(options.update(type, "type", { direction })).rejects.toThrow("Charge or Credit");
    }
    expect((await options.list(type)).length).toBe(4);
    expect(await options.update(type, "missing", { direction: "charge" })).toBeUndefined();
  });
  it("allows unchanged direction and unrelated edits, but not reinterpreting cleared payments", async () => {
    await post();
    await expect(options.update(type, "type", { direction: "charge" })).rejects.toThrow("audited historical correction");
    expect(await options.update(type, "type", { direction: "credit", name: "Same" })).toMatchObject({ name: "Same" });
    expect(await options.update(type, "type", { name: "Unrelated" })).toMatchObject({ direction: "credit" });
  });
  it("awaits generic asynchronous hooks and rolls back their writes on rejection", async () => {
    const metadata = optionsMetadata.department;
    metadata.beforeWrite = async ({ client, operation, values, id }) => {
      expect(state.als.getStore()).toBe(client);
      expect(values.name).toBe("Rejected");
      expect(operation === "create" ? id === undefined : id === "department").toBe(true);
      await client.execute((await import("drizzle-orm")).sql`INSERT INTO options_department(id,name) VALUES ('side-effect','rolled back')`);
      await Promise.resolve();
      throw new Error("Async refusal");
    };
    try {
      await expect(options.create("department", { name: "Rejected" })).rejects.toThrow("Async refusal");
      await expect(options.update("department", "department", { name: "Rejected" })).rejects.toThrow("Async refusal");
      expect(await options.list("department")).toEqual([]);
    } finally { delete metadata.beforeWrite; }
    const row = await options.create("department", { name: "Allowed" });
    expect(await options.update("department", row.id, { name: "Edited" })).toMatchObject({ name: "Edited" });
  });
  it("retains parent validation for other lists", async () => {
    await expect(options.create("worker-rating", { name: "Child", parent: "missing" })).rejects.toThrow("Parent does not exist");
    const row = await options.create("worker-rating", { name: "Parent" });
    await expect(options.update("worker-rating", row.id, { parent: row.id })).rejects.toThrow("own parent");
  });
  it("enforces the historical guard through HTTP and import application", async () => {
    await post();
    const response = await fetch(`${origin}/api/options/${type}/type`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: "charge" }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("audited historical correction") });
    const result = await runOptionsImport({
      type, config: getOptionsType(type)!, dryRun: false,
      options: { create: true, update: true, delete: false },
      text: JSON.stringify({ optionsType: type, records: [{ id: "type", name: "Fixture", direction: "charge" }] }),
    });
    expect(result.applied).toBe(false);
    expect(JSON.stringify(result.errors)).toContain("audited historical correction");
    expect(await options.get(type, "type")).toMatchObject({ direction: "credit" });
  });
  it("preserves HTTP and import create defaults and explicit-value error behavior", async () => {
    const create = (body: object) => fetch(`${origin}/api/options/${type}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const response = await create({ name: "HTTP default", category: "financial" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ direction: "credit" });
    expect((await create({ name: "Invalid", category: "financial", direction: "invalid" })).status).toBe(400);
    const nullResponse = await create({ name: "Null", category: "financial", direction: null });
    // Existing route behavior: storage validation errors use the generic error response.
    expect(nullResponse.status).toBe(500);
    expect(await nullResponse.json()).toMatchObject({ message: expect.stringContaining("Charge or Credit") });
    const result = await runOptionsImport({
      type, config: getOptionsType(type)!, dryRun: false,
      options: { create: true, update: true, delete: false },
      text: JSON.stringify({ optionsType: type, records: [{ name: "Import default", category: "financial" }] }),
    });
    expect(result.applied).toBe(true);
    expect((await options.list(type)).find(row => row.name === "Import default")).toMatchObject({ direction: "credit" });
  });

  async function waitForLock() {
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'");
      if (rows.length) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Competing write never waited on a PostgreSQL lock");
  }
  it("holds the validation lock until the option write commits, blocking actual payment creation", async () => {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>(resolve => { locked = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    optionsMetadata[type].beforeWrite = async context => {
      await originalHook(context);
      locked();
      await gate;
    };
    const save = options.update(type, "type", { direction: "charge" });
    await held;
    const posting = post();
    try { await waitForLock(); } finally { release(); }
    await Promise.all([save, posting]);
    expect(await options.get(type, "type")).toMatchObject({ direction: "charge" });
  });
  it("waits for a posting transaction, then refuses the change after seeing its cleared payment", async () => {
    let release!: () => void;
    let posted!: () => void;
    const held = new Promise<void>(resolve => { posted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const posting = runInTransaction(async () => { await post(); posted(); await gate; });
    await held;
    const save = options.update(type, "type", { direction: "charge" });
    const refused = expect(save).rejects.toThrow("audited historical correction");
    try { await waitForLock(); } finally { release(); }
    await Promise.all([posting, refused]);
    expect(await options.get(type, "type")).toMatchObject({ direction: "credit" });
  });
});
