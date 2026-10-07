import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { trustWmb, trustWmbScanQueue } from "@shared/schema";
import { getClient } from "../../server/storage/transaction-context";
import { storage } from "../../server/storage/database";
import { runHistoricalBackfill } from "../../scripts/oneoffs/backfill-wmb-events";
import { isInferredTermination } from "../../server/storage/trust/wmb-events";
import { inferHistoricalEvents, monthKey } from "../../server/services/wmb-historical-inference";
import { runWmbEventPhase } from "../../scripts/s1-migration/lib/wmb-event-phase";

const label = `historical-wmb-${Date.now()}`;
let workerId = "", benefitId = "", employerA = "", employerB = "";

async function cover(year: number, month: number, employerId = employerA) {
  await getClient().insert(trustWmb).values({ workerId, benefitId, employerId, year, month });
}
async function coverage() {
  return getClient().select().from(trustWmb).where(eq(trustWmb.workerId, workerId));
}
async function queue() {
  return getClient().select().from(trustWmbScanQueue).where(eq(trustWmbScanQueue.workerId, workerId));
}
async function events(type: string) {
  return storage.trustWmbEvents.listByWorkerAndType(workerId, type);
}
function run(cutoff: string, ...args: string[]) {
  return runHistoricalBackfill([`--cutoff=${cutoff}`, `--worker=${workerId}`, ...args]);
}

beforeAll(async () => {
  workerId = (await storage.workers.createWorker(`${label} worker`)).id;
  employerA = (await storage.employers.createEmployer({ name: `${label} A` } as any)).id;
  employerB = (await storage.employers.createEmployer({ name: `${label} B` } as any)).id;
  benefitId = (await storage.trustBenefits.createTrustBenefit({ name: `${label} benefit` } as any)).id;
}, 60_000);
afterAll(async () => {
  if (workerId) await storage.workers.deleteWorker(workerId);
  if (benefitId) await storage.trustBenefits.deleteTrustBenefit(benefitId);
  if (employerA) await storage.employers.deleteEmployer(employerA);
  if (employerB) await storage.employers.deleteEmployer(employerB);
}, 60_000);

describe("historical WMB event-only backfill", () => {
  it("deduplicates employers, infers gaps and year boundaries, and leaves cutoff runs open", async () => {
    const coverageRows = [
      { benefitId: "b", year: 2030, month: 12 },
      { benefitId: "b", year: 2030, month: 12 },
      { benefitId: "b", year: 2031, month: 1 },
      { benefitId: "b", year: 2031, month: 3 },
    ];
    expect(inferHistoricalEvents(coverageRows, monthKey(2031, 3))).toEqual([
      { eventType: "start", benefitId: "b", year: 2030, month: 12 },
      { eventType: "restart", benefitId: "b", year: 2030, month: 12 },
      { eventType: "terminate", benefitId: "b", year: 2031, month: 2 },
      { eventType: "restart", benefitId: "b", year: 2031, month: 3 },
    ]);
    await cover(2030, 12);
    await cover(2030, 12, employerB);
    await cover(2031, 1, employerB);
    await cover(2031, 3);
    const before = await coverage();
    const scansBefore = await queue();
    const preview = await run("2031-03");
    expect(preview.totals).toEqual({ created: 4, unchanged: 0, removed: 0, skipped: 0, failed: 0 });
    expect(preview.byTypeBenefitMonth).toHaveLength(4);
    expect(await events("terminate")).toHaveLength(0);
    expect(await coverage()).toEqual(before);
    expect(await queue()).toEqual(scansBefore);

    const live = await run("2031-03", "--live");
    expect(live.totals.created).toBe(4);
    expect((await events("terminate")).map(e => [e.year, e.month])).toEqual([[2031, 2]]);
    expect(isInferredTermination((await events("terminate"))[0].data)).toBe(true);
    expect((await events("terminate"))[0].data).toEqual({
      provenance: "coverage_inferred", failedPlugins: [],
    });
    expect((await events("restart")).map(e => [e.year, e.month])).toEqual([[2030, 12], [2031, 3]]);
    expect(await coverage()).toEqual(before);
    expect(await queue()).toEqual(scansBefore);
    expect((await run("2031-03", "--live")).totals).toEqual({
      created: 0, unchanged: 4, removed: 0, skipped: 0, failed: 0,
    });
  });

  it("preserves inferred endings during scan recompute; scan failures win collisions", async () => {
    await storage.trustWmbEvents.replaceForWorkerAndType(workerId, "terminate", []);
    expect((await events("terminate")).map(e => e.month)).toEqual([2]);
    await storage.trustWmbEvents.replaceForWorkerAndType(workerId, "terminate", [{
      benefitId, year: 2031, month: 2, data: { failedPlugins: [{ pluginKey: "confirmed", reason: "actual failure" }] },
    }]);
    expect((await events("terminate"))[0].data).toEqual({
      failedPlugins: [{ pluginKey: "confirmed", reason: "actual failure" }],
    });
    const result = await run("2031-03", "--live");
    expect(result.totals.skipped).toBe(1);
    expect((await events("terminate"))[0].data).toEqual({
      failedPlugins: [{ pluginKey: "confirmed", reason: "actual failure" }],
    });
  });

  it("removes only inferred endings after corrections, retaining scan reasons", async () => {
    await cover(2031, 2); // joins the December–March run
    const preview = await run("2031-03");
    expect(preview.totals.removed).toBe(1); // obsolete restart; confirmed termination is retained
    await run("2031-03", "--live");
    expect((await events("restart")).some(e => e.year === 2031 && e.month === 3)).toBe(false);
    expect((await events("terminate"))[0].data).toEqual({
      failedPlugins: [{ pluginKey: "confirmed", reason: "actual failure" }],
    });
    await cover(2031, 4);
    await run("2031-05", "--live"); // now ends in May
    expect((await events("terminate")).some(e => e.month === 5 && isInferredTermination(e.data))).toBe(true);
    await cover(2031, 5);
    expect((await run("2031-05")).totals.removed).toBe(1);
    await run("2031-05", "--live");
    expect((await events("terminate")).some(e => e.month === 5)).toBe(false);
    expect((await events("terminate")).some(e => e.month === 2)).toBe(true);
    expect((await queue())).toEqual([]);
  });

  it("handles a one-month run and removes orphaned inferred events when all coverage disappears", async () => {
    const second = await storage.workers.createWorker(`${label} second`);
    try {
      await getClient().insert(trustWmb).values({
        workerId: second.id, employerId: employerA, benefitId, year: 2032, month: 1,
      });
      const scoped = [`--cutoff=2032-02`, `--worker=${second.id}`, "--live"];
      expect((await runHistoricalBackfill(scoped)).totals.created).toBe(3);
      await getClient().delete(trustWmb).where(eq(trustWmb.workerId, second.id));
      const result = await runHistoricalBackfill(scoped);
      expect(result.totals.removed).toBe(3);
      expect((await storage.trustWmbEvents.listByWorkerAndType(second.id, "terminate"))).toEqual([]);
      expect((await storage.trustWmbEvents.listByWorkerAndType(second.id, "start"))).toEqual([]);
    } finally {
      await storage.workers.deleteWorker(second.id);
    }
  });

  it("requires a valid cutoff and reports a resumable incomplete page", async () => {
    await expect(runHistoricalBackfill(["--live"])).rejects.toThrow("Required --cutoff");
    const extra = await storage.workers.createWorker(`${label} pagination`);
    try {
      await getClient().insert(trustWmb).values({
        workerId: extra.id, employerId: employerA, benefitId, year: 2032, month: 1,
      });
      const page = await runHistoricalBackfill(["--cutoff=2032-02", "--limit=1"]);
      expect(page.incomplete).toBe(true);
      expect(page.nextAfterWorker).toBeTruthy();
      const next = await runHistoricalBackfill([
        "--cutoff=2032-02", "--limit=1", `--after-worker=${page.nextAfterWorker}`,
      ]);
      expect(next.workers).toBeGreaterThan(0);
    } finally {
      await storage.workers.deleteWorker(extra.id);
    }
  });

  it("scopes writes to one benefit without changing other benefit events", async () => {
    const other = await storage.trustBenefits.createTrustBenefit({ name: `${label} other` } as any);
    try {
      await getClient().insert(trustWmb).values({
        workerId, employerId: employerB, benefitId: other.id, year: 2032, month: 1,
      });
      const result = await run("2032-02", `--benefit=${other.id}`, "--live");
      expect(result.totals.created).toBe(3);
      const otherEvents = (await events("terminate")).filter(e => e.benefitId === other.id);
      expect(otherEvents).toHaveLength(1);
      const firstEvents = (await events("terminate")).filter(e => e.benefitId === benefitId);
      expect(firstEvents.some(e => e.month === 2 && e.year === 2031)).toBe(true);
    } finally {
      await storage.trustBenefits.deleteTrustBenefit(other.id);
    }
  });

  it("runs the integrated post-import phase across stored worker pages and converges on corrections", async () => {
    const second = await storage.workers.createWorker(`${label} integrated`);
    const crons = async () => (await storage.pluginConfigs.getByKind("cron"))
      .map(row => ({ id: row.id, enabled: row.enabled })).sort((a, b) => a.id.localeCompare(b.id));
    try {
      await getClient().insert(trustWmb).values([
        { workerId: second.id, employerId: employerA, benefitId, year: 2034, month: 1 },
        { workerId: second.id, employerId: employerA, benefitId, year: 2034, month: 3 },
      ]);
      const storedCoverage = await getClient().select().from(trustWmb).where(eq(trustWmb.workerId, second.id));
      const cronsBefore = await crons();
      const queueBefore = await queue();
      const args = { enabled: true, dryRun: false, importSucceeded: true, stagingComplete: true, horizon: "2034-03",
        detail: { openEndThrough: "2034-03",
          historicalEventEvidence: { inclusiveCutoff: "2034-03", complete: true,
            stagedSpans: 2, processedSpans: 2, rejectedSpans: 0, verifyFailures: 0 } } };
      // Real storage paging/reconciliation, bounded to fixture benefit. This
      // is local DB proof, NOT remote S1 fleet or tested ECS image proof.
      const page = (argv: string[]) => runHistoricalBackfill([...argv, `--benefit=${benefitId}`]);
      const first = await runWmbEventPhase(args, page, 1);
      expect(first).toMatchObject({ status: "pass", complete: true, cutoff: "2034-03" });
      expect(first.pages).toBeGreaterThanOrEqual(2);
      expect(first.workers).toBeGreaterThanOrEqual(2);
      const ended = await storage.trustWmbEvents.listByWorkerAndType(second.id, "terminate");
      expect(ended.map(row => [row.year, row.month, row.data])).toEqual([
        [2034, 2, { provenance: "coverage_inferred", failedPlugins: [] }],
      ]);
      const repeat = await runWmbEventPhase(args, page, 1);
      expect(repeat).toMatchObject({ status: "pass", totals: { created: 0, removed: 0, failed: 0 } });
      expect(await storage.trustWmbEvents.listByWorkerAndType(second.id, "terminate")).toEqual(ended);
      expect(await getClient().select().from(trustWmb).where(eq(trustWmb.workerId, second.id))).toEqual(storedCoverage);
      const preview = await runWmbEventPhase({ ...args, dryRun: true }, page, 1);
      expect(preview.status).toBe("skipped");
      expect(await storage.trustWmbEvents.listByWorkerAndType(second.id, "terminate")).toEqual(ended);
      await getClient().insert(trustWmb).values({
        workerId: second.id, employerId: employerA, benefitId, year: 2034, month: 2,
      });
      const corrected = await runWmbEventPhase(args, page, 1);
      expect(corrected.totals.removed).toBeGreaterThanOrEqual(2); // restart + inferred ending
      expect(await storage.trustWmbEvents.listByWorkerAndType(second.id, "terminate")).toEqual([]);
      expect((await events("terminate")).some(row =>
        row.year === 2031 && row.month === 2 && !isInferredTermination(row.data))).toBe(true);
      expect(await queue()).toEqual(queueBefore);
      expect(await crons()).toEqual(cronsBefore);
      console.log(JSON.stringify({ evidence: "local-post-import-phase-fixture",
        cutoff: first.cutoff, pages: first.pages, workers: first.workers,
        initial: { durationSec: first.durationSec, totals: first.totals },
        rerun: { durationSec: repeat.durationSec, totals: repeat.totals },
        corrected: corrected.totals, cronsUnchanged: true }));
    } finally {
      await storage.workers.deleteWorker(second.id);
    }
  });
});