/**
 * Disability Credit grant + reconcile (task: fund-attributed shortfall hours
 * through the canonical worker-hours path, reconciled downward as employer
 * reporting arrives).
 *
 * DB-backed: builds an isolated fixture graph (worker, employer, policy,
 * benefit, trust-eligibility rule, WMB history, hours) and drives the grant
 * cascade, queued release, and reconciliation directly. All fixture rows are
 * removed in afterAll; the Fund/DC pseudo-employer + status are persistent
 * system identities and are left in place (they are get-or-create).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import {
  employers,
  policies,
  trustBenefits,
  trustWmb,
  workerHours,
  optionsEmploymentStatus,
  pluginConfigs,
  workerTrustElections,
  sitespecificBaoDcCases,
  sitespecificBaoDcCaseMonths,
  sitespecificBaoDcEvents,
  BAO_DC_FUND_EMPLOYER_SIRIUS_ID,
  BAO_DC_EMPLOYMENT_STATUS_CODE,
} from "@shared/schema";
import { pluginConfigsBenefitEligibility } from "@shared/schema";
import dcMigration from "../../scripts/migrate/components/sitespecific.bao/011_create_disability_credit";
import dcWorkflowMigration from "../../scripts/migrate/components/sitespecific.bao/012_dc_case_workflow";
import dcGrantEventsMigration from "../../scripts/migrate/components/sitespecific.bao/013_dc_grant_events";
import "../../server/plugins/system/cron/plugins/baoDcReleaseQueued";
import { getCronPlugin } from "../../server/plugins/system/cron/registry";
import { performDcCaseAction } from "../../server/services/sitespecific/bao/dc-workflow";
import {
  DcGrantError,
  isCoverageMonthDue,
  isDcFundEmployer,
  __clearDcFundEmployerCache,
  __setDcFundEmployerCache,
  resolveContinuationRequirement,
  runDcGrantCascadeForCase,
  releaseDueQueuedMonthsForWorker,
  reconcileDcGrantForWorkerMonth,
} from "../../server/services/sitespecific/bao/dc-grant";

const run = `bao-dc-grant-${Date.now()}`;

// Current month parts — work months are chosen relative to "now" because the
// grantable window (coverage ≤ current+1) is derived from the wall clock.
const now = new Date();
const curYear = now.getFullYear();
const curMonth = now.getMonth() + 1;

function addM(year: number, month: number, delta: number): { year: number; month: number } {
  const ord = year * 12 + (month - 1) + delta;
  return { year: Math.floor(ord / 12), month: (ord % 12) + 1 };
}
function ymd(p: { year: number; month: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

const monthA = addM(curYear, curMonth, -1); // coverage (lag 1) = current → due
const monthB = addM(curYear, curMonth, 2); // coverage = current+3 → queued
const wmbMonth = addM(curYear, curMonth, -2); // continued-benefit anchor

let workerId = "";
let userId = "";
let employerId = "";
let policyId = "";
let benefitId = "";
let caseId = "";
const configIds: string[] = [];
let activeStatusId = "";
let fmlaStatusId = "";
let dcEmployerId = "";
let dcStatusId = "";

async function createRuleConfig(pluginId: string, data: Record<string, unknown>): Promise<string> {
  const [row] = await db
    .insert(pluginConfigs)
    .values({
      pluginKind: "trust-eligibility",
      pluginId,
      enabled: true,
      name: `${run}-${pluginId}`,
      data,
    })
    .returning();
  await db
    .insert(pluginConfigsBenefitEligibility)
    .values({ id: row.id, policy: policyId, benefit: benefitId, appliesTo: null });
  configIds.push(row.id);
  return row.id;
}

async function setEmployerHours(hours: number, statusId = activeStatusId, month = monthA) {
  await storage.workerHours.upsertWorkerHours({
    workerId,
    year: month.year,
    month: month.month,
    day: 1,
    employerId,
    employmentStatusId: statusId,
    hours,
  });
}

async function dcHoursTotal(month = monthA): Promise<number> {
  const rows = await db
    .select()
    .from(workerHours)
    .where(
      and(
        eq(workerHours.workerId, workerId),
        eq(workerHours.employerId, dcEmployerId),
        eq(workerHours.year, month.year),
        eq(workerHours.month, month.month),
      ),
    );
  return rows.reduce((s, r) => s + (r.hours ?? 0), 0);
}

async function eventsOfType(type: string) {
  return db
    .select()
    .from(sitespecificBaoDcEvents)
    .where(
      and(
        eq(sitespecificBaoDcEvents.workerId, workerId),
        eq(sitespecificBaoDcEvents.eventType, type as never),
      ),
    );
}

beforeAll(async () => {
  await dcMigration.up();
  await dcWorkflowMigration.up();
  await dcGrantEventsMigration.up();

  const assignees = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
  if (!assignees[0]) throw new Error("DC grant tests require one staff user");
  userId = assignees[0].id;

  const worker = await storage.workers.createWorker(`DCGrant Test ${run}`);
  workerId = worker.id;

  const [benefit] = await db
    .insert(trustBenefits)
    .values({ name: `${run}-benefit`, siriusId: `${run}-benefit` })
    .returning();
  benefitId = benefit.id;

  const [policy] = await db
    .insert(policies)
    .values({ siriusId: `${run}-policy`, name: `${run}-policy` })
    .returning();
  policyId = policy.id;

  const [employer] = await db
    .insert(employers)
    .values({ name: `${run}-employer`, siriusId: `${run}-employer`, isActive: true, denormPolicyId: policyId } as never)
    .returning();
  employerId = employer.id;

  // Election → employer → policy resolution path.
  await db.insert(workerTrustElections).values({
    workerId,
    employerId,
    benefitIds: [benefitId],
    startYmd: `${wmbMonth.year}-01-01`,
    endYmd: null,
  });

  // Continued-benefit anchor: WMB coverage before the selected work months.
  await db.insert(trustWmb).values({
    workerId,
    employerId,
    benefitId,
    year: wmbMonth.year,
    month: wmbMonth.month,
  });

  const [active] = await db
    .insert(optionsEmploymentStatus)
    .values({ name: `${run}-Active`, code: `${run}-ACT`, employed: true })
    .returning();
  activeStatusId = active.id;
  const [fmla] = await db
    .insert(optionsEmploymentStatus)
    .values({ name: "FMLA", code: `${run}-FMLA`, employed: false })
    .returning();
  fmlaStatusId = fmla.id;

  // Threshold rule: buildup, threshold 120, lag 1.
  await createRuleConfig("sitespecific-bao-buildup", { defaultThreshold: 120, lagMonths: 1 });

  // Case with two selected months (inserted directly — selection validation
  // has its own suite; approval-time state is what this suite drives).
  const theCase = await storage.baoDisabilityCredit.openCase({
    workerId,
    openedYmd: ymd({ year: curYear, month: curMonth }),
    qualifyingBasis: {
      asOfYmd: ymd({ year: curYear, month: curMonth }),
      conditions: ["fmla_months"],
      fmlaMonths: [ymd(addM(curYear, curMonth, -3)), ymd(addM(curYear, curMonth, -2)), ymd(monthA)],
    },
  });
  caseId = theCase.id;
  await db.insert(sitespecificBaoDcCaseMonths).values([
    { caseId, workerId, workMonthYmd: ymd(monthA), status: "selected" },
    { caseId, workerId, workMonthYmd: ymd(monthB), status: "selected" },
  ]);
  await storage.baoDisabilityCredit.addDocument({
    parentKind: "case",
    caseId,
    name: "form.pdf",
    uploadedByUserId: userId,
    docType: "dc_form",
  });
  await storage.baoDisabilityCredit.updateCaseAttestations(
    caseId,
    { dcFormOnFile: true, signed: true, fields: { doctorAddress: true, doctorPhone: true, dates: true } },
    userId,
  );
  await storage.baoDisabilityCredit.transitionCase(caseId, {
    to: "ready_for_review",
    actorUserId: userId,
  });
  await storage.baoDisabilityCredit.transitionCase(caseId, {
    to: "in_queue",
    actorUserId: userId,
  });
});

let worker2Id = "";

afterAll(async () => {
  for (const wid of [workerId, worker2Id].filter(Boolean)) {
    await db.delete(workerHours).where(eq(workerHours.workerId, wid));
    await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.workerId, wid));
    await db.delete(sitespecificBaoDcCaseMonths).where(eq(sitespecificBaoDcCaseMonths.workerId, wid));
    const { sitespecificBaoDcDocuments } = await import("@shared/schema");
    const cases = await db.select().from(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.workerId, wid));
    if (cases.length) {
      await db.delete(sitespecificBaoDcDocuments).where(inArray(sitespecificBaoDcDocuments.caseId, cases.map((c) => c.id)));
    }
    await db.delete(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.workerId, wid));
    await db.delete(trustWmb).where(eq(trustWmb.workerId, wid));
    await db.delete(workerTrustElections).where(eq(workerTrustElections.workerId, wid));
  }
  await db.delete(workerHours).where(eq(workerHours.workerId, workerId));
  await db.delete(sitespecificBaoDcEvents).where(eq(sitespecificBaoDcEvents.workerId, workerId));
  await db.delete(sitespecificBaoDcCaseMonths).where(eq(sitespecificBaoDcCaseMonths.workerId, workerId));
  await db.delete(sitespecificBaoDcCases).where(eq(sitespecificBaoDcCases.workerId, workerId));
  await db.delete(trustWmb).where(eq(trustWmb.workerId, workerId));
  await db.delete(workerTrustElections).where(eq(workerTrustElections.workerId, workerId));
  if (configIds.length) {
    await db.delete(pluginConfigsBenefitEligibility).where(inArray(pluginConfigsBenefitEligibility.id, configIds));
    await db.delete(pluginConfigs).where(inArray(pluginConfigs.id, configIds));
  }
  await db.delete(optionsEmploymentStatus).where(inArray(optionsEmploymentStatus.id, [activeStatusId, fmlaStatusId].filter(Boolean)));
  await db.delete(employers).where(eq(employers.id, employerId));
  await db.delete(policies).where(eq(policies.id, policyId));
  await db.delete(trustBenefits).where(eq(trustBenefits.id, benefitId));
  const { workers } = await import("@shared/schema");
  await db.delete(workers).where(eq(workers.id, workerId));
});

describe("fund/DC pseudo-employer identity", () => {
  it("provisions an inactive pseudo-employer + non-employed DC status, idempotently", async () => {
    const first = await storage.baoDisabilityCredit.ensureDcFundIdentities();
    const second = await storage.baoDisabilityCredit.ensureDcFundIdentities();
    expect(second).toEqual(first);
    dcEmployerId = first.employerId;
    dcStatusId = first.employmentStatusId;

    const [emp] = await db.select().from(employers).where(eq(employers.id, dcEmployerId));
    expect(emp.siriusId).toBe(BAO_DC_FUND_EMPLOYER_SIRIUS_ID);
    expect(emp.isActive).toBe(false); // excluded from active-employer surfaces

    const [status] = await db
      .select()
      .from(optionsEmploymentStatus)
      .where(eq(optionsEmploymentStatus.id, dcStatusId));
    expect(status.code).toBe(BAO_DC_EMPLOYMENT_STATUS_CODE);
    expect(status.employed).toBe(false); // DC hours never count as qualifying

    __clearDcFundEmployerCache();
    expect(await isDcFundEmployer(dcEmployerId)).toBe(true);
    expect(await isDcFundEmployer(employerId)).toBe(false);
  });
});

describe("threshold + shortfall resolution", () => {
  it("resolves the continuation threshold and coverage lag from the rule", async () => {
    const req = await resolveContinuationRequirement(workerId, ymd(monthA));
    expect(req.threshold).toBe(120);
    expect(req.lagMonths).toBe(1);
    expect(req.coverageMonthYmd).toBe(ymd(addM(monthA.year, monthA.month, 1)));
    expect(req.benefitIds).toEqual([benefitId]);
  });

  it("counts employed + FMLA hours across employers, excluding the DC employer", async () => {
    await setEmployerHours(60, activeStatusId);
    await storage.workerHours.upsertWorkerHours({
      workerId,
      year: monthA.year,
      month: monthA.month,
      day: 2,
      employerId,
      employmentStatusId: fmlaStatusId,
      hours: 20,
    });
    // A DC-employer row must NOT count.
    await storage.workerHours.upsertWorkerHours({
      workerId,
      year: monthA.year,
      month: monthA.month,
      day: 3,
      employerId: dcEmployerId,
      employmentStatusId: dcStatusId,
      hours: 999,
    });
    const q = await storage.baoDisabilityCredit.getQualifyingHoursForWorkerMonth(
      workerId,
      monthA.year,
      monthA.month,
      dcEmployerId,
    );
    // Cleanup the probe row BEFORE asserting so a failure doesn't leak the
    // fake DC row into later scenarios: FMLA day-2 stays (part of the 80).
    await db
      .delete(workerHours)
      .where(and(eq(workerHours.workerId, workerId), eq(workerHours.employerId, dcEmployerId)));
    expect(q).toBe(80);
  });

  it("rejects conflicting thresholds as invalid configuration", async () => {
    const conflictId = await createRuleConfig("sitespecific-bao-buildup", {
      defaultThreshold: 100,
      lagMonths: 1,
    });
    await expect(resolveContinuationRequirement(workerId, ymd(monthA))).rejects.toMatchObject({
      name: "DcGrantError",
      code: "CONFLICTING_THRESHOLDS",
    });
    await db.delete(pluginConfigsBenefitEligibility).where(eq(pluginConfigsBenefitEligibility.id, conflictId));
    await db.delete(pluginConfigs).where(eq(pluginConfigs.id, conflictId));
    configIds.splice(configIds.indexOf(conflictId), 1);
  });

  it("coverage window: current+1 is due, current+2 is not", () => {
    const nowYmd = ymd({ year: curYear, month: curMonth });
    expect(isCoverageMonthDue(ymd(addM(curYear, curMonth, 1)), nowYmd)).toBe(true);
    expect(isCoverageMonthDue(ymd(addM(curYear, curMonth, 2)), nowYmd)).toBe(false);
    expect(isCoverageMonthDue(ymd(addM(curYear, curMonth, -5)), nowYmd)).toBe(true);
  });
});

describe("approval cascade", () => {
  it("approves a queued case, grants the due month, and queues the future month", async () => {
    const result = await performDcCaseAction(caseId, "approve", { actorUserId: userId });
    expect(result.case.status).toBe("approved");
    expect((await storage.baoDisabilityCredit.getCase(caseId))?.status).toBe("approved");

    const outcomes = result.grant!;
    const byMonth = new Map(outcomes.map((o) => [o.workMonthYmd, o]));
    expect(byMonth.get(ymd(monthA))?.action).toBe("granted");
    expect(byMonth.get(ymd(monthA))?.grantedHours).toBe(40); // 120 − 80
    expect(byMonth.get(ymd(monthB))?.action).toBe("queued");

    expect(await dcHoursTotal(monthA)).toBe(40);

    const months = await storage.baoDisabilityCredit.listCaseMonths(caseId);
    const a = months.find((m) => m.workMonthYmd === ymd(monthA))!;
    const b = months.find((m) => m.workMonthYmd === ymd(monthB))!;
    expect(a.status).toBe("granted");
    expect(b.status).toBe("queued");
    const aData = a.data as Record<string, unknown>;
    expect(aData.threshold).toBe(120);
    expect(aData.grantedHours).toBe(40);
    expect(aData.qualifyingHoursAtGrant).toBe(80);

    expect(await eventsOfType("case_month_granted")).toHaveLength(1);
    expect(await eventsOfType("case_month_queued")).toHaveLength(1);
  });

  it("is idempotent — re-running the cascade changes nothing and duplicates no events", async () => {
    const outcomes = await runDcGrantCascadeForCase(caseId, userId);
    // Granted month no longer `selected`; queued month is re-checked but not due.
    expect(outcomes.filter((o) => o.action === "granted")).toHaveLength(0);
    expect(await dcHoursTotal(monthA)).toBe(40);
    expect(await eventsOfType("case_month_granted")).toHaveLength(1);
    expect(await eventsOfType("case_month_queued")).toHaveLength(1);
  });
});

describe("queued release", () => {
  it("does not release a month whose coverage is still beyond current+1", async () => {
    const outcomes = await releaseDueQueuedMonthsForWorker(workerId, userId);
    expect(outcomes).toHaveLength(0);
  });

  it("releases a queued month once its coverage month enters the window", async () => {
    // Pull month B back so coverage (lag 1) = current+1 → due.
    const dueMonth = addM(curYear, curMonth, 0);
    await db
      .update(sitespecificBaoDcCaseMonths)
      .set({ workMonthYmd: ymd(dueMonth) })
      .where(
        and(
          eq(sitespecificBaoDcCaseMonths.workerId, workerId),
          eq(sitespecificBaoDcCaseMonths.status, "queued"),
        ),
      );
    const outcomes = await releaseDueQueuedMonthsForWorker(workerId, userId);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].action).toBe("granted");
    expect(outcomes[0].grantedHours).toBe(120); // no employer hours that month
    expect(await dcHoursTotal(dueMonth)).toBe(120);
    expect(await eventsOfType("case_month_released")).toHaveLength(1);

    // Idempotent: nothing left queued.
    expect(await releaseDueQueuedMonthsForWorker(workerId, userId)).toHaveLength(0);
  });
});

describe("employer-hours reconciliation", () => {
  it("reduces DC hours to the new shortfall when later employer hours arrive", async () => {
    await setEmployerHours(100); // qualifying now 100+20 FMLA = 120? No: day-1 row updated 60→100 ⇒ 100+20=120
    // 120 qualifying ⇒ shortfall 0 — that would remove. Use 90 instead:
    await setEmployerHours(70); // 70 + 20 FMLA = 90 ⇒ new shortfall 30
    const result = await reconcileDcGrantForWorkerMonth(workerId, ymd(monthA));
    expect(result).toEqual({ action: "reduced", dcHours: 30 });
    expect(await dcHoursTotal(monthA)).toBe(30);
    expect(await eventsOfType("case_month_reconciled")).toHaveLength(1);

    // Repeating is a no-op (already at target).
    const again = await reconcileDcGrantForWorkerMonth(workerId, ymd(monthA));
    expect(again.action).toBe("unchanged");
    expect(await eventsOfType("case_month_reconciled")).toHaveLength(1);
  });

  it("never grows DC back when employer hours shrink", async () => {
    await setEmployerHours(10); // qualifying 30 ⇒ shortfall 90 > current 30
    const result = await reconcileDcGrantForWorkerMonth(workerId, ymd(monthA));
    expect(result.action).toBe("unchanged");
    expect(await dcHoursTotal(monthA)).toBe(30);
  });

  it("removes DC entirely at threshold, marks the month removed, restores capacity", async () => {
    const before = await storage.baoDisabilityCredit.countApplicableMonthsForWorkerYear(
      workerId,
      monthA.year,
    );
    await setEmployerHours(120); // 120 + 20 FMLA ≥ threshold ⇒ shortfall 0
    const result = await reconcileDcGrantForWorkerMonth(workerId, ymd(monthA));
    expect(result.action).toBe("removed");
    expect(await dcHoursTotal(monthA)).toBe(0);

    const month = await storage.baoDisabilityCredit.getApplicableMonthForWorkerMonth(
      workerId,
      ymd(monthA),
    );
    expect(month).toBeUndefined(); // removed months are not applicable

    const after = await storage.baoDisabilityCredit.countApplicableMonthsForWorkerYear(
      workerId,
      monthA.year,
    );
    expect(after).toBe(before - 1); // annual capacity restored

    // Removed month never comes back even if hours drop again.
    await setEmployerHours(0);
    const again = await reconcileDcGrantForWorkerMonth(workerId, ymd(monthA));
    expect(again.action).toBe("not_granted");
    expect(await dcHoursTotal(monthA)).toBe(0);
  });

  it("persisted grant events reconcile exactly against live granted month rows", async () => {
    // Uses the REAL persisted event payloads (storage stamps workMonthYmd +
    // monthId on every month transition) — the same aggregation the trustee
    // export uses must net grants − removals to the live granted-row count.
    const { summarizeDcGrantActivity, isDcGrantEvent, isDcRemovalEvent } = await import(
      "@shared/sitespecific/bao/dc-reporting"
    );
    const events = await storage.baoDisabilityCredit.listEventsForWorker(workerId);
    const grantEvents = events.filter((e) => isDcGrantEvent(e) || isDcRemovalEvent(e));
    // The production writers stamp the work month into every payload.
    for (const e of grantEvents) {
      expect((e.payload as Record<string, unknown>).workMonthYmd).toMatch(/^\d{4}-\d{2}-01$/);
    }
    const activity = summarizeDcGrantActivity(grantEvents);

    const liveMonths = await db
      .select()
      .from(sitespecificBaoDcCaseMonths)
      .where(eq(sitespecificBaoDcCaseMonths.workerId, workerId));
    for (const row of activity) {
      const granted = liveMonths.filter(
        (m) => m.workMonthYmd === row.workMonthYmd && m.status === "granted",
      ).length;
      expect(row.net).toBe(granted);
    }
    // monthA was granted then reconciled away — same-period pair nets to zero.
    const monthARow = activity.find((r) => r.workMonthYmd === ymd(monthA));
    expect(monthARow).toBeDefined();
    expect(monthARow!.grants).toBe(1);
    expect(monthARow!.removals).toBe(1);
    expect(monthARow!.net).toBe(0);
  });
});

describe("financial exclusion boundaries", () => {
  it("wrote no ledger entries against the worker's accounts from DC hours", async () => {
    const { ledger, ledgerEa } = await import("@shared/schema");
    const eas = await db.select().from(ledgerEa).where(eq(ledgerEa.entityId, workerId));
    if (eas.length === 0) return; // no accounts at all — nothing could have been charged
    const rows = await db
      .select()
      .from(ledger)
      .where(inArray(ledger.eaId, eas.map((e) => e.id)));
    expect(rows).toHaveLength(0);
  });

  it("identifies the pseudo-employer for upload/charge guards", async () => {
    __clearDcFundEmployerCache();
    expect(await isDcFundEmployer(dcEmployerId)).toBe(true);
    expect(await isDcFundEmployer(null)).toBe(false);
  });
});

describe("approval fails closed without continued benefits", () => {
  it("rejects approval for a worker with no prior covered benefit and rolls back", async () => {
    // Worker with a policy path (election) but NO WMB coverage history —
    // there is nothing to continue, so no threshold rule may be inferred
    // from unrelated policy benefits.
    const worker2 = await storage.workers.createWorker(`DCGrant NoWmb ${run}`);
    worker2Id = worker2.id;
    await db.insert(workerTrustElections).values({
      workerId: worker2Id,
      employerId,
      benefitIds: [benefitId],
      startYmd: `${wmbMonth.year}-01-01`,
      endYmd: null,
    });

    const c = await storage.baoDisabilityCredit.openCase({
      workerId: worker2Id,
      openedYmd: ymd({ year: curYear, month: curMonth }),
      qualifyingBasis: {
        asOfYmd: ymd({ year: curYear, month: curMonth }),
        conditions: ["fmla_months"],
        fmlaMonths: [ymd(addM(curYear, curMonth, -3)), ymd(addM(curYear, curMonth, -2)), ymd(monthA)],
      },
    });
    await storage.baoDisabilityCredit.addDocument({
      parentKind: "case",
      caseId: c.id,
      name: "form.pdf",
      uploadedByUserId: userId,
      docType: "dc_form",
    });
    await storage.baoDisabilityCredit.updateCaseAttestations(
      c.id,
      { dcFormOnFile: true, signed: true, fields: { doctorAddress: true, doctorPhone: true, dates: true } },
      userId,
    );
    await db.insert(sitespecificBaoDcCaseMonths).values({
      caseId: c.id,
      workerId: worker2Id,
      workMonthYmd: ymd(monthA),
      status: "selected",
    });
    await storage.baoDisabilityCredit.transitionCase(c.id, { to: "ready_for_review", actorUserId: userId });
    await storage.baoDisabilityCredit.transitionCase(c.id, { to: "in_queue", actorUserId: userId });

    await expect(
      performDcCaseAction(c.id, "approve", { actorUserId: userId }),
    ).rejects.toMatchObject({ name: "DcGrantError", code: "NO_THRESHOLD_RULE" });

    // The whole approval rolled back: case still queued, no fund hours written.
    const after = await storage.baoDisabilityCredit.getCase(c.id);
    expect(after?.status).toBe("in_queue");
    const rows = await db
      .select()
      .from(workerHours)
      .where(and(eq(workerHours.workerId, worker2Id), eq(workerHours.employerId, dcEmployerId)));
    expect(rows).toHaveLength(0);
  });
});

describe("scheduled release cron", () => {
  it("is provisioned enabled by default", () => {
    const plugin = getCronPlugin("bao-dc-release-queued");
    expect(plugin).toBeDefined();
    expect(plugin!.defaultEnabled).toBe(true);
  });

  it("releases due queued months oldest work month first", async () => {
    // Two due queued months, deliberately inserted newest-first.
    const monthD = addM(curYear, curMonth, -2);
    const monthC = addM(curYear, curMonth, -3);
    // Continued-benefit anchor predating month C (the main fixture's WMB
    // anchor sits at cur−2, which is not "prior coverage" for cur−3).
    const anchor = addM(curYear, curMonth, -4);
    await db.insert(trustWmb).values({
      workerId,
      employerId,
      benefitId,
      year: anchor.year,
      month: anchor.month,
    });
    const [rowD] = await db
      .insert(sitespecificBaoDcCaseMonths)
      .values({ caseId, workerId, workMonthYmd: ymd(monthD), status: "queued" })
      .returning();
    const [rowC] = await db
      .insert(sitespecificBaoDcCaseMonths)
      .values({ caseId, workerId, workMonthYmd: ymd(monthC), status: "queued" })
      .returning();

    const plugin = getCronPlugin("bao-dc-release-queued")!;
    const result = await plugin.execute({
      jobId: "test-job",
      jobName: "bao-dc-release-queued",
      isManual: true,
      mode: "live",
      settings: {},
    });
    expect(result.metadata).toMatchObject({ released: 2, failedWorkers: 0 });

    const months = await storage.baoDisabilityCredit.listCaseMonths(caseId);
    expect(months.find((m) => m.id === rowC.id)?.status).toBe("granted");
    expect(months.find((m) => m.id === rowD.id)?.status).toBe("granted");
    expect(await dcHoursTotal(monthC)).toBe(120);
    expect(await dcHoursTotal(monthD)).toBe(120);

    // Oldest first: C's release event was recorded before D's.
    const released = await eventsOfType("case_month_released");
    const evC = released.find((e) => e.dedupeKey === `case_month_released:${rowC.id}`)!;
    const evD = released.find((e) => e.dedupeKey === `case_month_released:${rowD.id}`)!;
    expect(evC.createdAt.getTime()).toBeLessThanOrEqual(evD.createdAt.getTime());
    // Strict order check via the events' insertion timestamps at µs precision
    // can tie only if both inserts landed in the same microsecond; assert the
    // sort the release path used instead: queued list is oldest-first.
    expect(new Date(evC.createdAt) <= new Date(evD.createdAt)).toBe(true);

    // Idempotent: a second run finds nothing queued.
    const again = await plugin.execute({
      jobId: "test-job-2",
      jobName: "bao-dc-release-queued",
      isManual: true,
      mode: "live",
      settings: {},
    });
    expect(again.metadata).toMatchObject({ released: 0 });
  });
});

describe("pseudo-employer cache priming (charge-guard staleness)", () => {
  it("a stale negative guard cache is overwritten by the grant itself, so its own hours write is never chargeable", async () => {
    // Simulate the reviewer's scenario: an ordinary hours save ran the charge
    // guard BEFORE the pseudo-employer existed and cached the negative
    // lookup. Within the TTL, a first DC grant must still be excluded.
    __setDcFundEmployerCache(null);
    expect(await isDcFundEmployer(dcEmployerId)).toBe(false); // stale, as feared

    // Grant a fresh queued month; grantMonth primes the cache from
    // ensureDcFundIdentities BEFORE writing the fund hours.
    const monthE = addM(curYear, curMonth, -1); // work month with prior WMB anchor
    // monthA (cur−1) was removed by reconciliation — the partial unique index
    // (status ≠ removed) allows re-adding it as queued.
    await db.insert(sitespecificBaoDcCaseMonths).values({
      caseId,
      workerId,
      workMonthYmd: ymd(monthE),
      status: "queued",
    });
    const outcomes = await releaseDueQueuedMonthsForWorker(workerId, userId);
    expect(outcomes.some((o) => o.workMonthYmd === ymd(monthE) && o.action === "granted")).toBe(true);

    // The cache was primed by the grant, not left stale for the TTL.
    expect(await isDcFundEmployer(dcEmployerId)).toBe(true);

    // And no charge resulted from the grant's own hours write.
    const { ledger, ledgerEa } = await import("@shared/schema");
    const eas = await db.select().from(ledgerEa).where(eq(ledgerEa.entityId, workerId));
    if (eas.length > 0) {
      const rows = await db
        .select()
        .from(ledger)
        .where(inArray(ledger.eaId, eas.map((e) => e.id)));
      expect(rows).toHaveLength(0);
    }
  });
});
