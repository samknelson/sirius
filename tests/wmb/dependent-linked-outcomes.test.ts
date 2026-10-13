import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const state = vi.hoisted(() => ({
  storage: {} as any,
  plugins: new Map<string, any>(),
  terminate: null as any,
  client: null as any,
}));
vi.mock("../../server/storage/database", () => ({ storage: new Proxy({}, {
  get: (_, key) => state.storage[key],
}) }));
vi.mock("../../server/storage", () => ({ storage: new Proxy({}, {
  get: (_, key) => state.storage[key],
}) }));
vi.mock("../../server/plugins/trust/eligibility/registry", () => ({
  registerEligibilityPlugin: (p: any) => state.plugins.set(p.metadata.id, p),
  eligibilityPluginRegistry: {
    get: (id: string) => state.plugins.get(id),
    isPluginEnabled: () => true,
  },
}));
vi.mock("../../server/plugins/system/denorm/registry", () => ({
  registerDenormPlugin: (p: any) => { state.terminate = p; },
}));
vi.mock("../../server/modules/components", () => ({ getEnabledComponentIds: async () => ["trust.elections"] }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ get: async () => ({ name: "Child" }) }),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => true }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
  runInSavepoint: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  withWmbScanWrites: (fn: () => Promise<unknown>) => fn(),
  withWmbBenefitRoleHistoryInvalidationBatch: (_: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/plugins/system/denorm/mark-stale", () => ({
  getDenormStaleSeed: async () => null,
}));
vi.mock("../../server/services/s1-write-fence", () => ({ tryAcquireAppWriteFence: vi.fn() }));
vi.mock("../../server/services/event-bus", () => ({
  EventType: { TRUST_WMB_SCAN_WORKER_COMPLETED: "worker-completed", WMB_SAVED: "wmb-saved" },
  eventBus: { emit: async (event: string, payload: any) => {
    if (event !== "worker-completed") return;
    await state.terminate.write(payload.workerId, await state.terminate.compute(payload.workerId));
  } },
}));

import "../../server/plugins/trust/eligibility/plugins/election";
import "../../server/plugins/trust/eligibility/plugins/linked";
import "../../server/plugins/trust/eligibility/plugins/ageout";
import "../../server/plugins/system/denorm/plugins/trustWmbTerminate";
import { runBenefitsScan } from "../../server/services/benefits-scan";
import { processClaimedJob } from "../../server/services/wmb-scan-queue";
import { getWmbResultCounts } from "../../shared/wmb-scan-outcomes";
import { createWmbScanQueueStorage } from "../../server/storage/wmb-scan-queue";
import { createTrustWmbEventsStorage } from "../../server/storage/trust/wmb-events";

type Row = { id: string; workerId: string; benefitId: string; month: number; year: number; employerId: string; sourceRelationId: string | null };

function fixture() {
  const rows: Row[] = [];
  const saved = new Map<number, any>();
  const events = new Map<string, any[]>();
  const benefitIds = ["medical", "dental", "linked", "chain", "unelected"];
  const benefits = benefitIds.map(id => ({ id, name: id }));
  const election = { id: "e", workerId: "sub", employerId: "employer",
    benefitIds: ["medical", "dental"], relationshipIds: ["selected"], startYmd: "2025-01-01", endYmd: null };
  const relation = { id: "selected", worker1: "sub", worker2: "dep", relationType: "child",
    relationTypeName: "Child", startYmd: "2025-01-01", endYmd: null, otherWorker: { displayName: "Child fixture" } };
  const rule = (benefit: string, pluginId: string, data = {}) => ({
    config: { pluginId, data: { appliesTo: ["start", "continue"], ...data } }, subsidiary: { benefit },
  });
  const rules = [
    ...["medical", "dental", "unelected"].flatMap(id => [
      rule(id, "election"), rule(id, "ageout", { maxYears: 26, appliesToRelationTypeIds: ["child"] }),
    ]),
    rule("linked", "linked", { benefitIds: ["medical"] }),
    rule("chain", "linked", { benefitIds: ["linked"] }),
  ];
  const workers = {
    sub: { id: "sub", contactId: "sub-contact", denormHomeEmployerId: "employer" },
    dep: { id: "dep", contactId: "dep-contact", denormHomeEmployerId: "other-employer" },
  };
  const storage: any = {
    workers: { getWorker: async (id: keyof typeof workers) => workers[id], getWorkerDisplayName: async (id: string) => id },
    contacts: { getContact: async (id: string) => ({
      id, displayName: id === "dep-contact" ? "Child fixture" : "Subscriber fixture",
      birthDate: id === "dep-contact" ? "2000-10-12" : "1980-01-01",
    }) },
    workerTrustElections: { getActiveByWorkerAsOf: async () => election },
    workerRelations: {
      searchWorkerRelations: async () => [relation],
      get: async (id: string) => id === relation.id ? relation : undefined,
    },
    employers: { getEmployer: async (id: string) => ({ id, name: id, denormPolicyId: "policy" }) },
    employerPolicyHistory: { getEmployerPolicyHistory: async () => [] },
    policies: { getPolicyById: async () => ({ id: "policy", name: "Policy", data: { benefitIds } }) },
    variables: { getByName: async () => null },
    pluginConfigs: { search: async () => rules },
    trustBenefits: {
      getAllTrustBenefits: async () => benefits,
      getTrustBenefit: async (id: string) => benefits.find(b => b.id === id),
    },
    trust: { wmb: {
      getWorkerBenefits: async (id: string) => rows.filter(r => r.workerId === id),
      getSubscriberDependentCoverage: async (_id: string, month: number, year: number) => rows.filter(r =>
        r.workerId === "dep" && r.sourceRelationId === "selected" && r.year === year && [month - 1, month].includes(r.month)),
      workerBenefitExists: vi.fn(() => { throw new Error("Scanner must supply effective coverage"); }),
      createWorkerBenefit: async (data: Omit<Row, "id">) => {
        const row = { ...data, id: `row-${rows.length}` }; rows.push(row); return row;
      },
      deleteWorkerBenefit: async (id: string) => { rows.splice(rows.findIndex(r => r.id === id), 1); },
      enqueueBenefitRoleHistoryInvalidations: async () => {},
    } },
    wmbScanQueue: { recordJobResult: async (_id: string, success: boolean, summary: any) => {
      saved.set(storage.scanMonth, { success, summary }); return { scanCompleted: false };
    } },
    trustWmbEvents: {
      getWorkerScanResults: async (id: string) => [...saved].map(([month, result]) => ({
        month, year: 2026, resultSummary: { actions: result.summary.actions.filter((a: any) => a.workerId === id && !a.executionError) },
      })),
      getWorkerBenefitCoverage: async (id: string) => rows.filter(r => r.workerId === id),
      replaceForWorkerAndType: async (id: string, _type: string, payload: any[]) => { events.set(id, payload); },
    },
  };
  state.storage = storage;
  async function queue(month: number) {
    storage.scanMonth = month;
    return processClaimedJob(storage, { id: `job-${month}`, workerId: "sub", month, year: 2026, attempts: 1 } as any);
  }
  return { storage, rows, saved, events, election, relation, benefitIds, rules, queue };
}

describe("dependent configured Election, Linked and Ageout rules", () => {
  beforeEach(() => { state.storage = {}; });

  it("grants unelected linked chains under the subscriber policy with dependent source and employer", async () => {
    const f = fixture();
    const result = await runBenefitsScan(f.storage, "sub", 10, 2026, "live", { includeDependents: true });
    const child = result.people.find(p => p.workerId === "dep")!;
    expect(child.error).toBeUndefined();
    expect(child.actions.filter(a => a.eligible).map(a => a.benefitId).sort()).toEqual(["chain", "dental", "linked", "medical"]);
    expect(child.actions.find(a => a.benefitId === "unelected")).toMatchObject({
      eligible: false, action: "none", pluginResults: expect.arrayContaining([
        expect.objectContaining({ pluginKey: "election", eligible: false, reason: expect.stringContaining("does not cover") }),
      ]),
    });
    expect(f.rows.filter(r => r.workerId === "dep")).toHaveLength(4);
    for (const row of f.rows.filter(r => r.workerId === "dep")) {
      expect(row).toMatchObject({ employerId: "employer", sourceRelationId: "selected" });
    }
    expect(f.storage.trust.wmb.workerBenefitExists).not.toHaveBeenCalled();
  });

  it("persists chronological October grants and November no-delete continuations into confirmed termination handoff", async () => {
    const f = fixture();
    expect((await f.queue(10)).success).toBe(true);
    expect((await f.queue(11)).success).toBe(true);
    const november = f.saved.get(11).summary;
    expect(november.people.find((p: any) => p.workerId === "dep")).toMatchObject({ name: "Child fixture", sourceRelationId: "selected" });
    const failed = november.actions.filter((a: any) => a.workerId === "dep" && a.scanType === "continue");
    expect(failed).toHaveLength(4);
    expect(failed.every((a: any) => !a.eligible && a.action === "none" && !a.executionError)).toBe(true);
    expect(failed.find((a: any) => a.benefitId === "medical").pluginResults).toContainEqual(
      expect.objectContaining({ pluginKey: "ageout", eligible: false, reason: expect.stringContaining("26 years 1 month old, above maximum age of 26 years") }),
    );
    expect(failed.find((a: any) => a.benefitId === "linked").pluginResults).toContainEqual(
      expect.objectContaining({ pluginKey: "linked", eligible: false }),
    );
    expect(getWmbResultCounts({ actions: failed }).terminated).toBe(4);
    expect(f.events.get("dep")?.filter(e => e.month === 11).map(e => e.benefitId).sort()).toEqual(["chain", "dental", "linked", "medical"]);
    expect(f.rows.filter(r => r.workerId === "dep" && r.month === 11)).toHaveLength(0);
    expect(f.rows.filter(r => r.workerId === "sub" && r.month === 11 && r.benefitId === "medical")).toHaveLength(1);
  });

  it("keeps November-first as failed starts, even after later October grants", async () => {
    const f = fixture();
    await f.queue(11);
    const saved = f.saved.get(11).summary;
    expect(saved.people.find((p: any) => p.workerId === "dep").actions.every((a: any) => a.scanType === "start" && !a.eligible)).toBe(true);
    expect(f.events.get("dep")).toEqual([]);
    await f.queue(10);
    // Replaying denorm must not reinterpret the old snapshot using new October rows.
    await state.terminate.write("dep", await state.terminate.compute("dep"));
    expect(f.events.get("dep")).toEqual([]);
    expect(f.saved.get(11).summary).toBe(saved);
  });

  it("removes linked chains when source fails and never borrows other ownership or subscriber coverage", async () => {
    const f = fixture();
    await f.queue(10);
    f.rows.push({ id: "unrelated-medical", workerId: "dep", benefitId: "medical", month: 11, year: 2026,
      sourceRelationId: "another-subscriber", employerId: "other" });
    f.rows.push({ id: "independent-medical", workerId: "dep", benefitId: "medical", month: 11, year: 2026,
      sourceRelationId: null, employerId: "other" });
    for (const benefitId of ["linked", "chain"]) f.rows.push({ id: `current-${benefitId}`, workerId: "dep", benefitId,
      month: 11, year: 2026, sourceRelationId: "selected", employerId: "employer" });
    await f.queue(11);
    expect(f.saved.get(11).summary.actions.filter((a: any) => a.workerId === "dep" && a.action === "delete")).toHaveLength(2);
    expect(f.rows.filter(r => r.workerId === "dep" && r.month === 11).map(r => r.id)).toEqual(["unrelated-medical", "independent-medical"]);
  });

  it("stop-only removed relationships cannot start unrelated policy benefits", async () => {
    const f = fixture();
    await f.queue(10);
    f.election.relationshipIds = [];
    await f.queue(11);
    const child = f.saved.get(11).summary.people.find((p: any) => p.workerId === "dep");
    expect(child.actions.map((a: any) => a.benefitId).sort()).toEqual(["chain", "dental", "linked", "medical"]);
    expect(child.actions.every((a: any) => !a.eligible && a.action === "none" && a.pluginResults[0].pluginKey === "coverage-context")).toBe(true);
  });

  it("rejects invalid relationship direction and policy-removed benefits", async () => {
    const f = fixture();
    await f.queue(10);
    f.benefitIds.splice(f.benefitIds.indexOf("linked"), 1);
    f.relation.worker1 = "unrelated";
    const result = await runBenefitsScan(f.storage, "sub", 11, 2026, "test", { includeDependents: true });
    expect(result.people.find(p => p.workerId === "dep")?.actions.every(a => !a.eligible)).toBe(true);
    expect(result.people.find(p => p.workerId === "dep")?.actions.find(a => a.benefitId === "linked")?.pluginResults).toContainEqual(
      expect.objectContaining({ pluginKey: "coverage-context", reason: "Benefit is no longer in the subscriber policy" }),
    );
    expect(f.rows.filter(r => r.month === 11)).toHaveLength(0);
  });

  it("reports a selected relationship whose executor ownership or dates are invalid as an execution error", async () => {
    const f = fixture();
    f.storage.workerRelations.get = async () => ({ ...f.relation, endYmd: "2026-09-30" });
    const result = await runBenefitsScan(f.storage, "sub", 10, 2026, "live", { includeDependents: true });
    expect(result.people.find(p => p.workerId === "dep")?.error).toContain("No active relationship");
    expect(f.rows.filter(r => r.workerId === "dep")).toHaveLength(0);
  });
});

// Real queue JSON persistence and terminate-event SQL, in a disposable local
// PostgreSQL cluster. Never reads application database configuration.
describe.skipIf(process.env.WMB_QUEUE_STORAGE_PG !== "1")("chronological dependent outcomes persisted in PostgreSQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  beforeAll(async () => {
    root = mkdtempSync(`${tmpdir()}/wmb-dependent-pg-`);
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 4, statement_timeout: 3000 });
    state.client = drizzle(pool);
    await pool.query(`
      CREATE TABLE trust_wmb_scan_status (
        id varchar PRIMARY KEY, month int, year int, scope_type varchar DEFAULT 'all', scope_employer_id varchar,
        status varchar DEFAULT 'queued', total_queued int DEFAULT 0, processed_success int DEFAULT 0,
        processed_failed int DEFAULT 0, benefits_started int DEFAULT 0, benefits_continued int DEFAULT 0,
        benefits_terminated int DEFAULT 0, queued_at timestamp DEFAULT now(), started_at timestamp,
        completed_at timestamp, last_error text);
      CREATE TABLE trust_wmb_scan_queue (
        id varchar PRIMARY KEY, status_id varchar, worker_id varchar, month int, year int, status varchar,
        trigger_source varchar, result_summary jsonb, scheduled_for timestamp, picked_at timestamp,
        completed_at timestamp, attempts int DEFAULT 0, last_error text);
      CREATE TABLE trust_wmb (
        id varchar PRIMARY KEY, worker_id varchar, benefit_id varchar, employer_id varchar,
        source_relation_id varchar, month int, year int);
      CREATE TABLE trust_wmb_events (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), worker_id varchar, benefit_id varchar, month int, year int, event_type varchar,
        data jsonb, UNIQUE(worker_id, year, month, benefit_id, event_type));
      CREATE TABLE workers(id varchar PRIMARY KEY, sirius_id int, contact_id varchar);
      CREATE TABLE contacts(id varchar PRIMARY KEY, display_name varchar);
    `);
  });
  afterAll(async () => {
    await pool?.end();
    state.client = null;
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE trust_wmb_scan_queue,trust_wmb_scan_status,trust_wmb,trust_wmb_events,workers,contacts");
    await pool.query("INSERT INTO workers VALUES ('sub',1,'contact'); INSERT INTO contacts VALUES ('contact','Subscriber fixture')");
  });

  async function persistedFixture() {
    const f = fixture();
    f.storage.wmbScanQueue = createWmbScanQueueStorage();
    f.storage.trustWmbEvents = createTrustWmbEventsStorage();
    const originalCreate = f.storage.trust.wmb.createWorkerBenefit;
    f.storage.trust.wmb.createWorkerBenefit = async (data: Omit<Row, "id">) => {
      const row = await originalCreate(data);
      await pool.query("INSERT INTO trust_wmb VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [row.id, row.workerId, row.benefitId, row.employerId, row.sourceRelationId, row.month, row.year]);
      return row;
    };
    async function scan(month: number) {
      await pool.query("INSERT INTO trust_wmb_scan_status(id,month,year,total_queued) VALUES ($1,$2,2026,1)", [`status-${month}`, month]);
      await pool.query(`INSERT INTO trust_wmb_scan_queue(id,status_id,worker_id,month,year,status,trigger_source,attempts)
        VALUES ($1,$2,'sub',$3,2026,'processing','fixture',1)`, [`job-${month}`, `status-${month}`, month]);
      expect((await f.queue(month)).success).toBe(true);
      const { rows } = await pool.query("SELECT result_summary FROM trust_wmb_scan_queue WHERE id=$1", [`job-${month}`]);
      return rows[0].result_summary;
    }
    return { f, scan };
  }

  it("real scanner October→November summaries produce dependent confirmed events with saved Ageout/Linked reasons", async () => {
    const { f, scan } = await persistedFixture();
    await scan(10);
    const november = await scan(11);
    expect(november.people.find((p: any) => p.workerId === "dep")).toMatchObject({ name: "Child fixture" });
    const child = november.actions.filter((a: any) => a.workerId === "dep" && a.scanType === "continue");
    expect(child).toHaveLength(4);
    expect(child.every((a: any) => !a.eligible && a.action === "none")).toBe(true);
    const events = await f.storage.trustWmbEvents.listByWorkerAndType("dep", "terminate");
    expect(events.map((e: any) => e.benefitId).sort()).toEqual(["chain", "dental", "linked", "medical"]);
    expect(events.find((e: any) => e.benefitId === "medical").data.failedPlugins).toContainEqual(
      expect.objectContaining({ pluginKey: "ageout", reason: expect.stringContaining("26 years 1 month") }),
    );
    expect(events.find((e: any) => e.benefitId === "linked").data.failedPlugins).toContainEqual(
      expect.objectContaining({ pluginKey: "linked" }),
    );
    const coverage = await pool.query("SELECT * FROM trust_wmb WHERE worker_id='dep' AND month=10");
    expect(coverage.rows).toHaveLength(4);
    expect(coverage.rows.every(r => r.employer_id === "employer" && r.source_relation_id === "selected")).toBe(true);
    const status = await pool.query("SELECT benefits_terminated FROM trust_wmb_scan_status WHERE id='status-11'");
    expect(status.rows[0].benefits_terminated).toBe(4);
    const filtered = await f.storage.wmbScanQueue.getQueueEntriesPaged("status-11", 1, 50, { outcome: "terminated" });
    expect(filtered.total).toBe(1);
  });

  it("November→October persisted failed starts never fabricate termination events", async () => {
    const { f, scan } = await persistedFixture();
    const november = await scan(11);
    expect(november.actions.filter((a: any) => a.workerId === "dep").every((a: any) => a.scanType === "start" && !a.eligible)).toBe(true);
    const status = await pool.query("SELECT benefits_terminated FROM trust_wmb_scan_status WHERE id='status-11'");
    expect(status.rows[0].benefits_terminated).toBe(0);
    const filtered = await f.storage.wmbScanQueue.getQueueEntriesPaged("status-11", 1, 50, { outcome: "terminated" });
    expect(filtered.total).toBe(0);
    await scan(10);
    await state.terminate.write("dep", await state.terminate.compute("dep"));
    expect(await f.storage.trustWmbEvents.listByWorkerAndType("dep", "terminate")).toEqual([]);
  });
});
