/**
 * WMB terminate-event lifecycle — regression tests for the REAL queue
 * completion path (task: restore WMB terminate events).
 *
 * These tests drive `processClaimedJob` (the production per-job completion
 * path shared by the cron drain and the immediate fast path) end-to-end
 * against the real database: enqueue → claim → record result → durable
 * denorm stale mark → per-worker completion event → trust-wmb-terminate
 * denorm handler → `trust_wmb_events` persistence. The only seam is the
 * benefits scan itself (`deps.runScan`), replaced with canned scan results so
 * the tests need no policy/eligibility-rule fixtures.
 *
 * Covers:
 *   1. A successful scan with a failed `continue` result and `action: "none"`
 *      (no coverage row existed to delete) creates a terminate event.
 *   2. The same with `action: "delete"` (a coverage row was removed).
 *   3. A month that still has coverage for the benefit does NOT get a
 *      terminate event.
 *   4. Failure visibility + self-heal: when the denorm handler fails, the
 *      completed scan leaves the worker's denorm row `stale` (visible to
 *      operators, never silently `ok`/absent), and the stale-recompute sweep
 *      (what the hourly denorm_stale cron runs) then creates the event.
 *   5. Atomicity (crash-equivalence): when the durable stale mark cannot be
 *      written, the successful result does NOT commit either — the job is
 *      recorded failed and a retry completes the handoff.
 *   6. Disabled config = paused, not lost: the scan still queues the row
 *      stale, the handler does not compute, and re-enabling + the recompute
 *      sweep creates the event.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";
import { updateComponentCache } from "../../server/services/component-cache";
import { processClaimedJob } from "../../server/services/wmb-scan-queue";
import type { BenefitsScanResult } from "../../server/services/benefits-scan";
import { getDenormPlugin } from "../../server/plugins/system/denorm/registry";
import { recomputeStaleDenorm } from "../../server/plugins/system/denorm/recompute";
// Registers the trust-wmb-terminate plugin and subscribes its event handlers
// on the real event bus — exactly what app boot does.
import "../../server/plugins/system/denorm/plugins/trustWmbTerminate";

const run = `wmb-term-test-${Date.now()}`;
const TRIGGER = run; // unique trigger source so claims never touch real jobs
const YEAR = 2031; // far-future months so nothing real collides

let workerId = "";
let employerId = "";
let benefitId = "";
let denormConfigId = "";
let createdDenormConfig = false;

/** Canned scan result: one continue action for our benefit. */
function scanResult(
  month: number,
  opts: { eligible: boolean; action: "none" | "delete" | "keep" },
): BenefitsScanResult {
  const action = {
    benefitId,
    benefitName: `${run} benefit`,
    scanType: "continue" as const,
    eligible: opts.eligible,
    action: opts.action,
    executed: opts.action !== "none",
    actionReason: "test",
    pluginResults: opts.eligible
      ? []
      : [{ pluginKey: "test-rule", eligible: false, reason: "canned failure" }],
  };
  return {
    workerId,
    month,
    year: YEAR,
    mode: "live",
    policyId: "test-policy",
    policyName: "Test Policy",
    policySource: "test",
    employerId,
    employerName: `${run} employer`,
    previousMonthBenefitIds: [benefitId],
    actions: [action],
    people: [],
    summary: {
      totalEvaluated: 1,
      eligible: opts.eligible ? 1 : 0,
      ineligible: opts.eligible ? 0 : 1,
      created: 0,
      deleted: opts.action === "delete" ? 1 : 0,
      kept: 0,
      errors: 0,
    },
  } as unknown as BenefitsScanResult;
}

/** Enqueue + claim + run the REAL completion path with a canned scan. */
async function runQueueJob(
  month: number,
  opts: { eligible: boolean; action: "none" | "delete" | "keep" },
) {
  await storage.wmbScanQueue.enqueueWorker(workerId, month, YEAR, TRIGGER);
  const job = await storage.wmbScanQueue.claimNextJob([TRIGGER]);
  expect(job, "queue job should be claimable").toBeTruthy();
  const result = await processClaimedJob(storage, job!, undefined, {
    runScan: async () => scanResult(month, opts),
  });
  expect(result.success).toBe(true);
  return result;
}

async function terminateEventsFor(month: number) {
  const events = await storage.trustWmbEvents.listByWorkerAndType(workerId, "terminate");
  return events.filter((e) => e.year === YEAR && e.month === month && e.benefitId === benefitId);
}

async function denormRow() {
  return storage.denorm.get(workerId, denormConfigId);
}

beforeAll(async () => {
  await updateComponentCache("trust.benefits", true);

  const worker = await storage.workers.createWorker(`${run} worker`);
  workerId = worker.id;
  const employer = await storage.employers.createEmployer({ name: `${run} employer` } as any);
  employerId = employer.id;
  const benefit = await storage.trustBenefits.createTrustBenefit({ name: `${run} benefit` } as any);
  benefitId = benefit.id;

  // The singleton denorm config normally exists via boot-time seeding; create
  // it only when the test database has none (and clean up ours afterwards).
  const configs = await storage.pluginConfigs.getByKindAndPlugin("denorm", "trust-wmb-terminate");
  if (configs[0]) {
    denormConfigId = configs[0].id;
    expect(configs[0].enabled, "trust-wmb-terminate denorm config should be enabled").toBe(true);
  } else {
    const created = await storage.pluginConfigs.create({
      pluginKind: "denorm",
      pluginId: "trust-wmb-terminate",
      enabled: true,
      name: "Trust WMB Terminate Events",
      ordering: 0,
      data: {},
    } as any);
    denormConfigId = created.id;
    createdDenormConfig = true;
  }
}, 60_000);

afterAll(async () => {
  // Worker delete cascades queue rows, wmb coverage, events, and denorm rows.
  if (workerId) await storage.workers.deleteWorker(workerId);
  if (benefitId) await storage.trustBenefits.deleteTrustBenefit(benefitId);
  if (employerId) await storage.employers.deleteEmployer(employerId);
  if (createdDenormConfig && denormConfigId) {
    await storage.pluginConfigs.delete(denormConfigId);
  }
}, 60_000);

describe("WMB terminate events — production queue completion path", () => {
  it("creates a terminate event for a failed continue with action 'none' (no coverage row to delete)", async () => {
    await runQueueJob(7, { eligible: false, action: "none" });

    const events = await terminateEventsFor(7);
    expect(events).toHaveLength(1);
    expect((events[0].data as any)?.failedPlugins?.[0]?.pluginKey).toBe("test-rule");

    // The fast path (event handler) processed it: the durable stale mark was
    // flipped straight back to ok.
    const row = await denormRow();
    expect(row?.status).toBe("ok");
  });

  it("creates a terminate event for a failed continue with action 'delete'", async () => {
    await runQueueJob(8, { eligible: false, action: "delete" });
    const events = await terminateEventsFor(8);
    expect(events).toHaveLength(1);
  });

  it("does not retain a terminate event for a month that still has coverage", async () => {
    // Coverage exists for month 9 — even with a failed continue recorded, the
    // covered month must not carry a terminate event.
    await storage.trust.wmb.createWorkerBenefit({
      workerId,
      employerId,
      benefitId,
      month: 9,
      year: YEAR,
    } as any);
    await runQueueJob(9, { eligible: false, action: "keep" });

    expect(await terminateEventsFor(9)).toHaveLength(0);
    // Months 7 and 8 (no coverage) keep theirs.
    expect(await terminateEventsFor(7)).toHaveLength(1);
    expect(await terminateEventsFor(8)).toHaveLength(1);
  });

  it("leaves a visible stale denorm row when event processing fails, and the recompute sweep heals it", async () => {
    const plugin = getDenormPlugin("trust-wmb-terminate")!;
    const realCompute = plugin.compute;
    plugin.compute = async () => {
      throw new Error("simulated denorm failure");
    };
    try {
      await runQueueJob(10, { eligible: false, action: "none" });

      // The scan completed, the handler failed — the failure must NOT be
      // silent: the durable marker is visible as a stale row and no event
      // exists yet.
      const row = await denormRow();
      expect(row?.status).toBe("stale");
      expect(await terminateEventsFor(10)).toHaveLength(0);
    } finally {
      plugin.compute = realCompute;
    }

    // What the hourly denorm_stale cron runs: drain this plugin's stale rows.
    const summary = await recomputeStaleDenorm({ pluginId: "trust-wmb-terminate" });
    expect(summary.perPlugin[0]?.skipped).toBeUndefined();

    expect(await terminateEventsFor(10)).toHaveLength(1);
    expect((await denormRow())?.status).toBe("ok");
  });

  it("rolls back the successful result when the durable stale mark cannot be written (crash-equivalence)", async () => {
    // Force the stale-mark insert to fail with an FK violation by resolving a
    // config id that does not exist. Because the mark is written in the SAME
    // transaction as the successful result, the whole completion must roll
    // back: the job may not commit as `success` without the handoff.
    const orig = storage.pluginConfigs.getByKindAndPlugin;
    storage.pluginConfigs.getByKindAndPlugin = (async (kind: string, pluginId: string) => {
      const rows = await orig.call(storage.pluginConfigs, kind, pluginId);
      if (kind === "denorm" && pluginId === "trust-wmb-terminate") {
        return rows.map((r: any) => ({ ...r, id: "00000000-0000-0000-0000-000000000000" }));
      }
      return rows;
    }) as typeof orig;
    let jobId = "";
    try {
      const queued = await storage.wmbScanQueue.enqueueWorker(workerId, 11, YEAR, TRIGGER);
      jobId = queued.id;
      const job = await storage.wmbScanQueue.claimNextJob([TRIGGER]);
      expect(job?.id).toBe(jobId);
      const result = await processClaimedJob(storage, job!, undefined, {
        runScan: async () => scanResult(11, { eligible: false, action: "none" }),
      });
      // The completion path must NOT report success…
      expect(result.success).toBe(false);
      // …and the job must not be committed as success (it is recorded failed
      // for retry), so a completed scan can never exist without its durable
      // denorm handoff.
      const rows = await storage.trustWmbEvents.getWorkerScanResults(workerId);
      expect(rows.find((r) => r.year === YEAR && r.month === 11)).toBeUndefined();
      expect(await terminateEventsFor(11)).toHaveLength(0);
    } finally {
      storage.pluginConfigs.getByKindAndPlugin = orig;
    }

    // Retry with the handoff healthy: re-enqueue and process normally.
    await storage.wmbScanQueue.enqueueWorker(workerId, 11, YEAR, `${TRIGGER}-retry`);
    const retry = await storage.wmbScanQueue.claimNextJob([`${TRIGGER}-retry`]);
    const retried = await processClaimedJob(storage, retry!, undefined, {
      runScan: async () => scanResult(11, { eligible: false, action: "none" }),
    });
    expect(retried.success).toBe(true);
    expect(await terminateEventsFor(11)).toHaveLength(1);
  });

  it("pauses (not loses) processing while the denorm config is disabled, and heals on re-enable", async () => {
    await storage.pluginConfigs.update(denormConfigId, { enabled: false } as any);
    try {
      await runQueueJob(12, { eligible: false, action: "none" });

      // Handler must not compute while disabled; the durable mark keeps the
      // row visibly queued.
      expect(await terminateEventsFor(12)).toHaveLength(0);
      expect((await denormRow())?.status).toBe("stale");

      // The recompute sweep also skips the disabled config.
      const skipped = await recomputeStaleDenorm({ pluginId: "trust-wmb-terminate" });
      expect(skipped.perPlugin[0]?.skipped).toBe("config-disabled");
      expect(await terminateEventsFor(12)).toHaveLength(0);
    } finally {
      await storage.pluginConfigs.update(denormConfigId, { enabled: true } as any);
    }

    // Re-enabled: the queued stale row drains and the event appears.
    const summary = await recomputeStaleDenorm({ pluginId: "trust-wmb-terminate" });
    expect(summary.perPlugin[0]?.skipped).toBeUndefined();
    expect(await terminateEventsFor(12)).toHaveLength(1);
    expect((await denormRow())?.status).toBe("ok");
  });
});
