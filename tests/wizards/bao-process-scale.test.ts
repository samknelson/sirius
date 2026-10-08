import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import { sql } from "drizzle-orm";
const fixture = vi.hoisted(() => ({
  uploads: new Map<string, any>(), logs: [] as Array<{ message: string; meta: any }>,
  profiles: [] as Array<Record<string, number>>,
}));
vi.mock("../../server/logger", () => ({
  storageLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: Object.fromEntries(["debug", "info", "warn", "error"].map(level => [level,
    (message: string, meta: any) => { if (meta?.service === "wizard-process") fixture.logs.push({ message, meta }); }])),
}));
vi.mock("../../server/plugins/wizards/attachments", async original => ({
  ...await original<any>(),
  getWizardAttachment: vi.fn(async (id: string) => fixture.uploads.get(id)),
  downloadWizardAttachment: vi.fn(async (id: string) => fixture.uploads.get(id).bytes),
  createWizardAttachment: vi.fn(async (input: any) => {
    const record = { ...input, id: randomUUID() }; fixture.uploads.set(record.id, record); return record;
  }),
}));
vi.mock("../../server/plugins/_core", async original => ({
  ...await original<any>(), enforcePluginGating: async () => ({ ok: true }),
}));
vi.mock("../../server/plugins/wizards/entity-access", () => ({
  enforceWizardEntityAccess: async () => ({ ok: true }), enforceWizardRecordAccess: async () => ({ ok: true }),
}));
import { storage } from "../../server/storage";
import { db, databaseSourceInfo } from "../../server/storage/db";
import * as schema from "../../shared/schema";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
import "../../server/plugins/wizards/plugins/bao-monthly-hours";
import "../../server/plugins/wizards/plugins/gbhet-legal-workers";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-hourly";
import { registerChargePluginKind } from "../../server/plugins/ledger/charge";
import { withChargeBatchCollector } from "../../server/plugins/ledger/charge/charge-batch";
import { updateComponentCache } from "../../server/services/component-cache";
import { __setDcFundEmployerCache } from "../../server/services/sitespecific/bao/dc-grant";
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";
import { registerWizardRoutes } from "../../server/modules/wizards";

// Business-writing tests may ONLY run with the isolated configuration.
describe.skipIf((databaseSourceInfo as any).source !== "isolated-test").sequential("BAO actual Process dispatcher scale and finalization", () => {
  let employerId: string, accountId: string, industryId: string, msId: string;
  let activeId: string, fmlaId: string;
  beforeAll(async () => {
    registerChargePluginKind();
    await updateComponentCache("sitespecific.bao", true);
    await updateComponentCache("ledger", true);
    __setDcFundEmployerCache(null);
    const [industry] = await db.insert(schema.optionsIndustry).values({ name: "Synthetic Industry" }).returning();
    industryId = industry.id;
    const [ms] = await db.insert(schema.optionsWorkerMs).values({ name: "Synthetic Member", industryId,
      data: { sitespecific: { bao: { threshold: 120 } } } }).returning();
    msId = ms.id;
    const [employer] = await db.insert(schema.employers).values({ name: "Synthetic Employer", industryId }).returning();
    employerId = employer.id;
    const [account] = await db.insert(schema.ledgerAccounts).values({ name: "Synthetic Fund" }).returning();
    accountId = account.id;
    const [active, fmla] = await db.insert(schema.optionsEmploymentStatus).values([
      { name: "Active", code: "active", employed: true }, { name: "FMLA", code: "fmla", employed: true },
    ]).returning();
    activeId = active.id; fmlaId = fmla.id;
    await db.insert(schema.optionsWorkerWs).values([{ name: "Active" }, { name: "FMLA" }]);
    await db.insert(schema.sitespecificBaoEmployerRates).values({ employerId, accountId, effectiveYmd: "2020-01-01", rate: "4.00" });
    const [config] = await db.insert(schema.pluginConfigs).values({
      pluginKind: "charge", pluginId: "bao-hourly", name: "Synthetic Charge", enabled: true, data: {},
    }).returning();
    await db.insert(schema.pluginConfigsCharge).values({ id: config.id, scope: "employer", employerId, account: accountId });
  });
  afterEach(() => { vi.restoreAllMocks(); fixture.logs.length = 0; });

  async function setup(count: number, month: number) {
    const fields = ["ssn", "firstName", "lastName", "dateOfBirth", "employmentStatus", "numberOfHours",
      "phoneNumber", "addressLine1", "city", "state", "postalCode", "withholdingAmount"];
    const rows = [];
    const decisions: Record<string, string> = {};
    let existing = 0, split = 0;
    for (let i = 0; i < count; i++) {
      const ssn = `700-${String(month).padStart(2, "0")}-${String(i + 1).padStart(4, "0")}`;
      const isExisting = i % 5 === 0;
      if (!isExisting) decisions[ssn.replace(/\D/g, "")] = "confirm";
      if (isExisting) {
        const worker = await storage.workers.createWorker("Synthetic Existing");
        await storage.workers.updateWorkerSSN(worker.id, ssn);
        await db.insert(schema.workerMsh).values({ workerId: worker.id, msId, industryId, date: "2020-01-01" });
        existing++; split++;
      }
      rows.push([ssn, "Synthetic", "Fixture", "1985-06-08", isExisting ? "FMLA" : "Active",
        isExisting ? "40" : "160", "5550100", "1 Test Street", "Test City", "MN", "55401", "$12.50"]);
    }
    const id = randomUUID();
    fixture.uploads.set(id, { id, mimeType: "text/csv", fileName: "synthetic.csv", bytes: Buffer.from(stringify([fields, ...rows])) });
    const wizard = await storage.wizards.create({
      type: "bao_monthly_hours", entityId: employerId, currentStep: "process", status: "draft",
      data: { uploadedFileId: id, hasHeaders: true, mode: "create", newWorkerDecisions: decisions, launchArguments: { year: 2090, month },
        columnMapping: Object.fromEntries(fields.map((field, i) => [field, `col_${i}`])),
        validationResults: { totalRows: count, validRows: count, invalidRows: 0 }, previewResults: { completedAt: new Date().toISOString() } },
    });
    await db.insert(schema.files).values({
      id, fileName: "synthetic.csv", storagePath: `synthetic-fixture/${id}`,
      size: fixture.uploads.get(id).bytes.length, mimeType: "text/csv",
      uploadedBy: "synthetic-fixture", fileSystemId: "synthetic-fixture",
      entityType: "entity-files:wizard", entityId: wizard.id,
    });
    await db.insert(schema.entityFiles).values({
      contextId: "wizard", entityId: wizard.id, fileId: id, name: "Synthetic fixture",
    });
    const app = express(); app.use(express.json());
    registerWizardDispatcherRoutes(app, (_req, _res, next) => next());
    registerWizardRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    return { wizard, base, existing, split, server };
  }
  async function finish(base: string, id: string) {
    let loaded: any;
    for (let i = 0; i < 6000; i++) {
      const response = await fetch(`${base}/api/wizards/${id}`);
      expect(response.status).toBe(200);
      loaded = await response.json();
      if (loaded.data.progress.process.status !== "in_progress") return loaded;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Process did not terminate");
  }

  for (const [count, month] of [[500, 1], [2009, 2]]) {
    it(`${count} create-mode rows persist workers, hours, FMLA splits, allocations and finalized charges`, async () => {
      const { wizard, base, existing, split, server } = await setup(count, month);
      let writes = 0, concurrent = 0, maxConcurrent = 0;
      const real = storage.wizards.writeStepProgress.bind(storage.wizards);
      vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
        const progress = !args[4] && !args[3].status;
        if (progress) { writes++; maxConcurrent = Math.max(maxConcurrent, ++concurrent); }
        try {
          if (progress) await new Promise(resolve => setTimeout(resolve, 25));
          return await real(...args);
        } finally { if (progress) concurrent--; }
      });
      const metrics = (await import("../../server/storage/db") as any).wizardTestMetrics;
      metrics.queries = 0;
      const t = Date.now();
      try {
        const admitted = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" });
        expect(admitted.status).toBe(202);
        expect(await admitted.json()).toMatchObject({ protocol: "bao-process-v1" });
        const typeChange = await fetch(`${base}/api/wizards/${wizard.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "gbhet_legal_workers_monthly" }),
        });
        expect(typeChange.status).toBe(409);
        expect((await storage.wizards.getById(wizard.id))?.type).toBe("bao_monthly_hours");
        expect((await fetch(`${base}/api/wizards/${wizard.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: null }),
        })).status).toBe(409);
        const activeDeletion = await fetch(`${base}/api/wizards/${wizard.id}`, { method: "DELETE" });
        expect(activeDeletion.status).toBe(409);
        expect((await activeDeletion.json()).message).toContain("must be retained");
        expect(await storage.entityFiles.getByFileId("wizard", wizard.id, (wizard.data as any).uploadedFileId)).toBeDefined();
        expect((await storage.wizards.getById(wizard.id))?.status).not.toBe("deleting");
        const competing = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" });
        expect(competing.status).toBe(409);
        const loaded = await finish(base, wizard.id);
        expect(loaded.data.progress.process.status).toBe("completed");
        expect(await storage.wizards.update(wizard.id, { type: "gbhet_legal_workers_monthly" })).toBeUndefined();
        expect((await fetch(`${base}/api/wizards/${wizard.id}`, { method: "DELETE" })).status).toBe(409);
        expect(await storage.wizards.delete(wizard.id)).toBe(false);
        expect(await storage.entityFiles.getByFileId("wizard", wizard.id, (wizard.data as any).uploadedFileId)).toBeDefined();
        const result = loaded.data.processResults;
        expect(result).toMatchObject({ totalRows: count, successCount: count, failureCount: 0,
          createdCount: count - existing, updatedCount: existing });
        expect(result.rowResults).toHaveLength(count);
        expect([...new Set(result.rowResults.map((r: any) => r.message.split("issues:")[1]).filter(Boolean))]).toEqual([]);
        const totals = await db.execute(sql`select count(*)::int as count, sum(hours)::int as hours from worker_hours
          where employer_id = ${employerId} and year = 2090 and month = ${month}`);
        expect(totals.rows[0]).toEqual({ count: count + split, hours: (count - split) * 160 + split * 120 });
        const fmla = await db.execute(sql`select count(*)::int as count, sum(hours)::int as hours from worker_hours
          where employer_id = ${employerId} and year = 2090 and month = ${month} and employment_status_id = ${fmlaId}`);
        expect(fmla.rows[0]).toEqual({ count: split, hours: split * 80 });
        const allocations = await storage.baoWithholdingAllocations.getByWizard(wizard.id);
        expect(allocations).toHaveLength(count);
        expect(allocations.reduce((sum, a) => sum + Number(a.amount), 0)).toBe(count * 12.5);
        const charge = await db.execute(sql`select count(*)::int as count, sum(l.amount)::text as amount from ledger l
          join worker_hours h on l.reference_id = h.id and l.reference_type = 'hour'
          where h.employer_id = ${employerId} and h.year = 2090 and h.month = ${month}`);
        expect(charge.rows[0].count).toBe(count + split);
        expect(Number(charge.rows[0].amount)).toBe(((count - split) * 160 + split * 120) * 4);
        expect(maxConcurrent).toBe(1);
        expect(writes).toBeLessThan(count / 10);
        const stepData = await (await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/data`)).json();
        expect(stepData.persistenceProblem).toBeNull();
        expect(stepData.processResults.rowResults).toHaveLength(count);
        expect(fixture.uploads.get(result.resultsFileId)?.bytes.toString()).toContain("Status,Message");
        const navigation = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/navigate`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: "next" }),
        });
        expect(navigation.status).toBe(200);
        expect((await navigation.json()).currentStep).toBe("review");
        const profile = { rows: count, durationMs: Date.now() - t,
          queryCount: metrics.queries, progressWrites: writes, maxConcurrentProgressWrites: maxConcurrent,
          hoursRows: count + split, allocations: allocations.length, charges: charge.rows[0].count as number };
        fixture.profiles.push(profile);
        writeFileSync("/tmp/bao-process-profile.json", JSON.stringify(fixture.profiles, null, 2));
        console.log("PROCESS_PROFILE", JSON.stringify(profile));
        const safe = JSON.stringify(fixture.logs);
        for (const forbidden of ["700-", "Synthetic", "synthetic.csv", "workerId", "rowResults"]) expect(safe).not.toContain(forbidden);
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    }, 300_000);
  }

  it("reports charge flush failure without success, result file generation, or side-effect replay", async () => {
    const { wizard, base, server } = await setup(5, 3);
    const bulk = vi.spyOn(storage.ledger.entries, "bulkCreate").mockRejectedValue(new Error("sensitive-canary"));
    const filesBefore = fixture.uploads.size;
    try {
      expect((await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" })).status).toBe(202);
      const loaded = await finish(base, wizard.id);
      expect(loaded.data.progress.process).toMatchObject({ status: "failed", partialPostingRisk: true });
      expect((await fetch(`${base}/api/wizards/${wizard.id}`, { method: "DELETE" })).status).toBe(409);
      expect(loaded.data.progress.process.error).toContain("Do not resubmit");
      expect(loaded.data.processResults).toBeUndefined();
      expect(fixture.uploads.size).toBe(filesBefore);
      expect(bulk).toHaveBeenCalledTimes(1);
      expect(await storage.baoWithholdingAllocations.getByWizard(wizard.id)).toHaveLength(5);
      expect(JSON.stringify(fixture.logs)).not.toContain("sensitive-canary");
      expect((await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" })).status).toBe(409);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 60_000);

  it("stops before another row after execution lease loss, without claiming rollback or rerunning", async () => {
    const { wizard, base, server } = await setup(8, 4);
    const real = storage.workerHours.upsertWorkerHours.bind(storage.workerHours);
    let writes = 0;
    vi.spyOn(storage.workerHours, "upsertWorkerHours").mockImplementation(async (...args) => {
      const saved = await real(...args);
      writes++;
      if (writes === 1) {
        await db.execute(sql`select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory'
          and classid = 1350 and objid = hashtext(${'wizard-validation:' + wizard.id})::oid and objsubid = 2`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return saved;
    });
    try {
      expect((await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" })).status).toBe(202);
      let data: any;
      for (let i = 0; i < 400; i++) {
        data = await (await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/data`)).json();
        if (data.persistenceProblem) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(data.persistenceProblem).toContain("not confirmed");
      expect((await fetch(`${base}/api/wizards/${wizard.id}`, { method: "DELETE" })).status).toBe(409);
      expect(writes).toBeGreaterThan(0);
      expect(writes).toBeLessThanOrEqual(2); // An already-started split row may finish.
      expect(data.processResults).toBeNull();
      expect((await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" })).status).toBe(409);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30_000);

  it("retains row issues and partial-posting risk while keeping existing row processing policy", async () => {
    const { wizard, base, server } = await setup(5, 5);
    const real = storage.workerHours.upsertWorkerHours.bind(storage.workerHours);
    vi.spyOn(storage.workerHours, "upsertWorkerHours").mockRejectedValueOnce(new Error("synthetic-hours-failure"))
      .mockImplementation(real);
    try {
      expect((await fetch(`${base}/api/wizards/${wizard.id}/dispatch/process/run`, { method: "POST" })).status).toBe(202);
      const loaded = await finish(base, wizard.id);
      expect(loaded.data.progress.process).toMatchObject({ status: "completed", partialPostingRisk: true, rowIssues: 1 });
      expect(loaded.data.processResults.rowResults[0].hasIssues).toBe(true);
      expect(loaded.data.processResults.successCount).toBe(5);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30_000);

  it("preserves legacy collector soft-failure policy and does not flush interrupted strict work", async () => {
    const bulk = vi.spyOn(storage.ledger.entries, "bulkCreate").mockRejectedValue(new Error("synthetic-flush-failure"));
    const pending = { chargePlugin: "test", chargePluginKey: "key", entityType: "employer", entityId: employerId,
      accountId, amount: "1.00" };
    expect(await withChargeBatchCollector(async collector => { collector.push(pending); return "legacy-result"; })).toBe("legacy-result");
    expect(bulk).toHaveBeenCalledTimes(1);
    bulk.mockClear();
    await expect(withChargeBatchCollector(async collector => {
      collector.push(pending); throw new Error("interrupted");
    }, { strict: true, assertOwned: () => {} })).rejects.toThrow("interrupted");
    expect(bulk).not.toHaveBeenCalled();
  });
});
