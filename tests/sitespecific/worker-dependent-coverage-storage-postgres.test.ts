import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const context = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: context.getClient, runInTransaction: vi.fn(),
}));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: vi.fn() }, EventType: {} }));
vi.mock("../../server/storage/trust/worker-benefit-role-history-invalidation", () => ({
  enqueueWorkerBenefitRoleHistoryInvalidations: vi.fn(),
}));
import { createTrustWmbStorage } from "../../server/storage/trust/wmb";
import { invalidateTableExists } from "../../server/storage/utils";

// Executes the real storage SQL against an isolated temporary PostgreSQL
// cluster. Never connects to or mutates the application's historical data.
describe.skipIf(process.env.WORKER_DEPENDENT_HISTORY_PG !== "1")("subscriber dependent history storage", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const storage = createTrustWmbStorage();
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "dependent-history-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 2, statement_timeout: 3000 });
    context.getClient.mockReturnValue(drizzle(pool));
    await pool.query(`
      CREATE TABLE workers(id varchar PRIMARY KEY, contact_id varchar);
      CREATE TABLE contacts(id varchar PRIMARY KEY, display_name text);
      CREATE TABLE trust_wmb(id varchar PRIMARY KEY, worker_id varchar, employer_id varchar, benefit_id varchar,
        year int, month int, source_relation_id varchar);
    `);
  });
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query(`
      DROP TABLE IF EXISTS worker_relations, options_worker_relation_type, trust_benefits, options_trust_benefit_type;
      CREATE TABLE worker_relations(id varchar PRIMARY KEY, worker_1 varchar, worker_2 varchar, relation_type varchar,
        start_ymd date, end_ymd date);
      CREATE TABLE options_worker_relation_type(id varchar PRIMARY KEY, name varchar);
      CREATE TABLE trust_benefits(id varchar PRIMARY KEY, name varchar, benefit_type varchar);
      CREATE TABLE options_trust_benefit_type(id varchar PRIMARY KEY, data jsonb);
      TRUNCATE workers, contacts, trust_wmb;
      INSERT INTO workers VALUES ('subscriber','sub-contact'),('child','child-contact'),('spouse','spouse-contact');
      INSERT INTO contacts VALUES ('sub-contact','Subscriber'),('child-contact','Child A'),('spouse-contact','Person B');
      INSERT INTO options_worker_relation_type VALUES ('child-type','Child'),('spouse-type','Spouse');
      INSERT INTO options_trust_benefit_type VALUES ('medical','{"icon":"Heart","color":"#123456"}');
      INSERT INTO trust_benefits VALUES ('m','Medical','medical'),('d','Dental',null);
      INSERT INTO worker_relations VALUES
        ('old','subscriber','child','child-type','2019-01-01','2020-01-01'),
        ('spouse-rel','subscriber','spouse','spouse-type',null,null),
        ('other','another-subscriber','child','child-type',null,null);
    `);
    for (const table of ["worker_relations", "options_worker_relation_type", "trust_benefits", "options_trust_benefit_type"]) invalidateTableExists(table);
  });

  it("scopes by the recorded granting relation, bounds exact months, and deduplicates across employers", async () => {
    await pool.query(`INSERT INTO trust_wmb VALUES
      ('a','child','employer-a','m',2025,12,'old'),
      ('b','child','employer-b','m',2025,12,'old'),
      ('c','child','employer-a','d',2025,12,'old'),
      ('d','spouse','employer-a','d',2025,12,'spouse-rel'),
      ('other-grant','child','employer-a','d',2026,1,'other'),
      ('prior','child','employer-a','m',2025,11,'old'),
      ('own','subscriber','employer-a','m',2026,1,null),
      ('future','child','employer-a','m',2027,1,'old')`);
    const evidence = await storage.getSubscriberDependentHistory("subscriber", [{ year: 2025, month: 12 }]);
    expect(evidence.available).toBe(true);
    expect(evidence.rows).toHaveLength(3);
    expect(evidence.rows.filter((row) => row.personId === "child")).toHaveLength(2);
    expect(evidence.rows.find((row) => row.benefitId === "m")).toMatchObject({
      name: "Child A", relationship: "Child", benefitName: "Medical", benefitIcon: "Heart", benefitColor: "#123456",
    });
    expect(evidence.rows.every((row) => row.year === 2025 && row.month === 12)).toBe(true);
    expect(await storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }]))
      .toEqual({ available: true, rows: [] }); // Own benefit + another subscriber's grant are not dependent coverage here.
    expect(await storage.getSubscriberDependentHistoryStart("subscriber", { year: 2026, month: 1 }))
      .toEqual({ available: true, earliest: { year: 2025, month: 11 } });
  });

  it("retains matching WMBs when covered-person, benefit, or relationship display metadata is unresolved", async () => {
    await pool.query(`INSERT INTO trust_wmb VALUES ('missing','missing-person','e','missing-benefit',2026,1,'old')`);
    expect(await storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }]))
      .toEqual({ available: true, rows: [{
        personId: "missing-person", year: 2026, month: 1, name: null, relationship: "Child",
        benefitId: "missing-benefit", benefitName: null, benefitIcon: null, benefitColor: null,
      }] });
    await pool.query("DROP TABLE options_worker_relation_type, trust_benefits, options_trust_benefit_type");
    for (const table of ["options_worker_relation_type", "trust_benefits", "options_trust_benefit_type"]) invalidateTableExists(table);
    const evidence = await storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }]);
    expect(evidence).toMatchObject({ available: true, rows: [{ personId: "missing-person", relationship: null, benefitName: null }] });
  });

  it("reports absent relationship evidence as unavailable, while successful no-matches are available", async () => {
    expect(await storage.getSubscriberDependentHistoryStart("subscriber", { year: 2026, month: 1 }))
      .toEqual({ available: true, earliest: null });
    expect(await storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }]))
      .toEqual({ available: true, rows: [] });
    await pool.query("DROP TABLE worker_relations");
    invalidateTableExists("worker_relations");
    expect(await storage.getSubscriberDependentHistoryStart("subscriber", { year: 2026, month: 1 }))
      .toEqual({ available: false, earliest: null });
    expect(await storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }]))
      .toEqual({ available: false, rows: [] });
  });

  it("propagates database read failures instead of returning empty coverage", async () => {
    await pool.query("ALTER TABLE trust_wmb RENAME TO saved_wmb");
    try {
      await expect(storage.getSubscriberDependentHistory("subscriber", [{ year: 2026, month: 1 }])).rejects.toThrow();
      await expect(storage.getSubscriberDependentHistoryStart("subscriber", { year: 2026, month: 1 })).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE saved_wmb RENAME TO trust_wmb");
    }
  });
});
