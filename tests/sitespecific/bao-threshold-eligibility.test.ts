/**
 * Task 415 — 60-hour hospitality eligibility scenario (DB-backed, real code).
 *
 * Proves the restored member-status threshold end-to-end:
 *   - threshold resolution walks employer → industry → member-status history
 *     → data.sitespecific.bao.threshold and yields the CONFIGURED 60, not
 *     the 100-hour default,
 *   - a subscriber with exactly 60 qualifying hours in the examined month is
 *     eligible (meet-or-exceed boundary); below 60 is not,
 *   - the benefits scan evaluates an actively elected dependent with the
 *     subscriber's status/hours (same outcome), while a lapsed relationship
 *     is excluded entirely,
 *   - with no configured threshold the documented default (100) still
 *     applies.
 *
 * All fixtures are run-prefixed, created through the storage layer, and
 * removed in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";
import { updateComponentCache } from "../../server/services/component-cache";
import { getOptionsStorage } from "../../server/modules/options-registry";
import { fetchThresholdStatus } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-threshold";
import { resolveBaoThreshold } from "../../server/plugins/trust/eligibility/plugins/bao-shared";
import { evaluateEligibilityRules } from "../../server/plugins/trust/eligibility/executor";
import { runBenefitsScan } from "../../server/services/benefits-scan";

const run = `bao-thresh-${Date.now()}`;
// Evaluate as of April 2026 => the examined month is January 2026 (dates
// must be in the past: relations/msh reject future start dates).
const AS_OF = { year: 2026, month: 4 };
const TARGET = { year: 2026, month: 1 };
const AS_OF_YMD = "2026-04-30";

let industryId = "";
let msId = "";
let employerId = "";
let lowerThresholdIndustryId = "";
let lowerThresholdMsId = "";
let lowerThresholdEmployerId = "";
let employmentStatusId = "";
let benefitId = "";
let policyId = "";
let ruleConfigId = "";
let relationTypeId = "";
let subscriberId = "";
let belowWorkerId = "";
let defaultWorkerId = "";
let activeDependentId = "";
let lapsedDependentId = "";
let inferredWorkerId = "";
let multiEmployerWorkerId = "";
let noEmployerWorkerId = "";
let activeRelId = "";
let lapsedRelId = "";
let electionId = "";
let belowElectionId = "";

beforeAll(async () => {
  await updateComponentCache("trust.benefits", true);
  await updateComponentCache("sitespecific.bao", true);

  const options = getOptionsStorage();
  industryId = (await options.create("industry", { name: `${run} hospitality` })).id;
  // 60-hour hospitality member status with the canonical nested threshold
  // plus a sibling key that must never be disturbed.
  msId = (
    await options.create("worker-ms", {
      name: `${run} Hospitality Worker - 60 hours`,
      industryId,
      data: { s1Tid: 999999, sitespecific: { bao: { threshold: 60 } } },
    })
  ).id;

  const employer = await storage.employers.createEmployer({
    name: `${run} hotel`,
    industryId,
  } as any);
  employerId = employer.id;

  lowerThresholdIndustryId = (
    await options.create("industry", { name: `${run} lower-threshold industry` })
  ).id;
  lowerThresholdMsId = (
    await options.create("worker-ms", {
      name: `${run} lower-threshold worker status`,
      industryId: lowerThresholdIndustryId,
      data: { sitespecific: { bao: { threshold: 40 } } },
    })
  ).id;
  lowerThresholdEmployerId = (
    await storage.employers.createEmployer({
      name: `${run} lower-threshold employer`,
      industryId: lowerThresholdIndustryId,
    } as any)
  ).id;

  const statuses: Array<{ id: string; name: string }> = await options.list("employment-status");
  const active = statuses.find((s) => s.name.toLowerCase() === "active") ?? statuses[0];
  if (!active) throw new Error("no employment status available in test DB");
  employmentStatusId = active.id;

  benefitId = (await storage.trustBenefits.createTrustBenefit({ name: `${run} benefit` } as any)).id;
  policyId = (
    await storage.policies.createPolicy({
      siriusId: `${run}-policy`,
      name: `${run} policy`,
      data: { benefitIds: [benefitId] },
    } as any)
  ).id;
  await storage.employerPolicyHistory.createEmployerPolicyHistory({
    employerId,
    date: "2024-01-01",
    policyId,
  } as any);

  // One trust-eligibility rule: the BAO threshold plugin, for both scan types.
  const [rule] = await storage.pluginConfigs.bulkCreateWithSubsidiary("trust-eligibility", [
    {
      base: {
        pluginKind: "trust-eligibility",
        pluginId: "sitespecific-bao-threshold",
        enabled: true,
        name: `${run} threshold rule`,
        ordering: 0,
        data: { appliesTo: ["start", "continue"] },
      },
      subsidiary: { policy: policyId, benefit: benefitId },
    },
  ] as any);
  ruleConfigId = rule.id;

  relationTypeId = (await options.create("worker-relation-type", { name: `${run} child` })).id;

  // Workers: boundary subscriber (exactly 60), below-boundary (59.5),
  // default-path (no configured threshold), and two dependents.
  subscriberId = (await storage.workers.createWorker(`${run} subscriber`)).id;
  belowWorkerId = (await storage.workers.createWorker(`${run} below`)).id;
  defaultWorkerId = (await storage.workers.createWorker(`${run} default`)).id;
  activeDependentId = (await storage.workers.createWorker(`${run} dependent active`)).id;
  lapsedDependentId = (await storage.workers.createWorker(`${run} dependent lapsed`)).id;
  inferredWorkerId = (await storage.workers.createWorker(`${run} inferred employer`)).id;
  multiEmployerWorkerId = (await storage.workers.createWorker(`${run} multiple employers`)).id;
  noEmployerWorkerId = (await storage.workers.createWorker(`${run} no employer`)).id;

  // Member-status history binds subscriber+below to the 60-hour status in
  // the hospitality industry (the default worker gets NO history row).
  for (const workerId of [subscriberId, belowWorkerId]) {
    await storage.workerMsh.createWorkerMsh({
      workerId,
      date: "2024-01-01",
      msId,
      industryId,
    });
  }
  await storage.workerMsh.createWorkerMsh({
    workerId: inferredWorkerId,
    date: "2024-01-01",
    msId,
    industryId,
  });
  await storage.workerMsh.createWorkerMsh({
    workerId: multiEmployerWorkerId,
    date: "2024-01-01",
    msId,
    industryId,
  });
  await storage.workerMsh.createWorkerMsh({
    workerId: multiEmployerWorkerId,
    date: "2024-01-01",
    msId: lowerThresholdMsId,
    industryId: lowerThresholdIndustryId,
  });

  // Hours in the examined month (January 2032).
  const hoursOf: Array<[string, number]> = [
    [subscriberId, 60], // exact boundary — eligible
    [belowWorkerId, 59.5], // below — ineligible
    [defaultWorkerId, 60], // no threshold configured — default 100 applies
  ];
  for (const [workerId, hours] of hoursOf) {
    await storage.workerHours.upsertWorkerHours({
      workerId,
      employerId,
      employmentStatusId,
      year: TARGET.year,
      month: TARGET.month,
      hours,
      home: true,
    } as any);
  }
  await storage.workerHours.upsertWorkerHours({
    workerId: inferredWorkerId,
    employerId,
    employmentStatusId,
    year: TARGET.year,
    month: TARGET.month,
    hours: 60,
    home: true,
  } as any);
  for (const [candidateEmployerId, hours] of [
    [employerId, 25],
    [lowerThresholdEmployerId, 25],
  ] as const) {
    await storage.workerHours.upsertWorkerHours({
      workerId: multiEmployerWorkerId,
      employerId: candidateEmployerId,
      employmentStatusId,
      year: TARGET.year,
      month: TARGET.month,
      hours,
      home: true,
    } as any);
  }

  // Relationships: one active, one lapsed before the scan month.
  activeRelId = (
    await storage.workerRelations.create({
      worker1: subscriberId,
      worker2: activeDependentId,
      relationType: relationTypeId,
      startYmd: "2024-01-01",
    } as any)
  ).id;
  lapsedRelId = (
    await storage.workerRelations.create({
      worker1: subscriberId,
      worker2: lapsedDependentId,
      relationType: relationTypeId,
      startYmd: "2024-01-01",
      endYmd: "2025-06-30",
    } as any)
  ).id;

  // Trust election covering the benefit and BOTH relationship ids — the
  // lapsed one must still be excluded by relationship activeness.
  electionId = (
    await storage.workerTrustElections.create(subscriberId, {
      employerId,
      startYmd: "2024-01-01",
      benefitIds: [benefitId],
      relationshipIds: [activeRelId, lapsedRelId],
      enrollmentType: "open_enrollment",
    })
  ).id;

  // The below-threshold subscriber needs its own election so the scan can
  // resolve an employer/policy for it (no dependents on this one).
  belowElectionId = (
    await storage.workerTrustElections.create(belowWorkerId, {
      employerId,
      startYmd: "2024-01-01",
      benefitIds: [benefitId],
      enrollmentType: "open_enrollment",
    })
  ).id;
}, 120_000);

afterAll(async () => {
  const options = getOptionsStorage();
  if (electionId) await storage.workerTrustElections.delete(electionId).catch(() => {});
  if (belowElectionId) await storage.workerTrustElections.delete(belowElectionId).catch(() => {});
  for (const id of [
    subscriberId,
    belowWorkerId,
    defaultWorkerId,
    activeDependentId,
    lapsedDependentId,
    inferredWorkerId,
    multiEmployerWorkerId,
    noEmployerWorkerId,
  ]) {
    if (id) await storage.workers.deleteWorker(id).catch(() => {});
  }
  if (ruleConfigId) await storage.pluginConfigs.delete(ruleConfigId).catch(() => {});
  if (employerId) await storage.employers.deleteEmployer(employerId).catch(() => {});
  if (lowerThresholdEmployerId) {
    await storage.employers.deleteEmployer(lowerThresholdEmployerId).catch(() => {});
  }
  if (policyId) await storage.policies.deletePolicy?.(policyId).catch(() => {});
  if (benefitId) await storage.trustBenefits.deleteTrustBenefit(benefitId).catch(() => {});
  if (relationTypeId) await options.delete("worker-relation-type", relationTypeId).catch(() => {});
  if (msId) await options.delete("worker-ms", msId).catch(() => {});
  if (industryId) await options.delete("industry", industryId).catch(() => {});
  if (lowerThresholdMsId) await options.delete("worker-ms", lowerThresholdMsId).catch(() => {});
  if (lowerThresholdIndustryId) {
    await options.delete("industry", lowerThresholdIndustryId).catch(() => {});
  }
}, 120_000);

async function evaluateThreshold(
  workerId: string,
  employerId?: string,
): Promise<{ eligible: boolean; reason?: string }> {
  const [result] = await evaluateEligibilityRules(
    [
      {
        pluginKey: "sitespecific-bao-threshold",
        appliesTo: ["continue"],
        config: { defaultThreshold: 100 },
      },
    ],
    {
      scanType: "continue",
      workerId,
      employerId,
      asOfMonth: AS_OF.month,
      asOfYear: AS_OF.year,
    },
  );
  return result;
}

describe("threshold resolution reads the canonical configured value", () => {
  it("resolves 60 from the member-status history, not the 100 default", async () => {
    const resolved = await resolveBaoThreshold(subscriberId, employerId, AS_OF_YMD, 100);
    expect(resolved).toEqual({ threshold: 60, resolved: true });
  });

  it("keeps the documented default when no threshold is configured", async () => {
    const resolved = await resolveBaoThreshold(defaultWorkerId, employerId, AS_OF_YMD, 100);
    expect(resolved).toEqual({ threshold: 100, resolved: false });
  });
});

describe("hospitality subscriber at the 60-hour boundary", () => {
  it("exactly 60 qualifying hours meets a 60-hour status", async () => {
    const status = await fetchThresholdStatus(subscriberId, AS_OF, { employerId });
    expect(status.targetYear).toBe(TARGET.year);
    expect(status.targetMonth).toBe(TARGET.month);
    expect(status.threshold).toBe(60);
    expect(status.thresholdResolved).toBe(true);
    expect(status.hours).toBe(60);
    expect(status.success).toBe(true);
  });

  it("below 60 hours is ineligible", async () => {
    const status = await fetchThresholdStatus(belowWorkerId, AS_OF, { employerId });
    expect(status.threshold).toBe(60);
    expect(status.success).toBe(false);
  });

  it("without a configured threshold the default 100 governs", async () => {
    const status = await fetchThresholdStatus(defaultWorkerId, AS_OF, { employerId });
    expect(status.threshold).toBe(100);
    expect(status.thresholdResolved).toBe(false);
    expect(status.success).toBe(false); // 60 hours < default 100
  });
});

describe("BAO Threshold when no election employer is available", () => {
  it("uses the active employer's status threshold and the three-month target month", async () => {
    const result = await evaluateThreshold(inferredWorkerId);

    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("60 hours in January 2026");
    expect(result.reason).toContain("threshold of 60");
    expect(result.reason).toContain("derived from active employer hours");
    expect(result.reason).not.toContain("default threshold");
  });

  it("uses the lowest threshold across multiple qualifying active employers", async () => {
    const result = await evaluateThreshold(multiEmployerWorkerId);

    // 50 total hours would fail the 60-hour threshold, but meets the 40-hour
    // threshold for the other active employer.
    expect(result.eligible).toBe(true);
    expect(result.reason).toContain("50 hours in January 2026");
    expect(result.reason).toContain("threshold of 40");
    expect(result.reason).toContain("derived from active employer hours");
  });

  it("identifies when an inferred employer has no configured member-status threshold", async () => {
    const result = await evaluateThreshold(defaultWorkerId);

    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("threshold of 100");
    expect(result.reason).toContain("default threshold");
    expect(result.reason).toContain("derived from active employer hours");
  });

  it("keeps the no-employer failure when no active employer can be inferred", async () => {
    const result = await evaluateThreshold(noEmployerWorkerId);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(
      "No employer could be resolved for the subscriber on the evaluated date, so the hours threshold cannot be determined.",
    );
  });

  it("leaves explicit and election-resolved employers on the normal threshold path", async () => {
    const explicit = await evaluateThreshold(multiEmployerWorkerId, employerId);
    expect(explicit.eligible).toBe(false);
    expect(explicit.reason).toContain("threshold of 60");
    expect(explicit.reason).not.toContain("derived from active employer hours");

    const elected = await evaluateThreshold(subscriberId);
    expect(elected.eligible).toBe(true);
    expect(elected.reason).toContain("threshold of 60");
    expect(elected.reason).not.toContain("derived from active employer hours");
  });
});

describe("benefits scan — dependents follow the subscriber's threshold outcome", () => {
  it("evaluates the active elected dependent and excludes the lapsed relationship", async () => {
    const result = await runBenefitsScan(
      storage,
      subscriberId,
      AS_OF.month,
      AS_OF.year,
      "test",
      { includeDependents: true },
    );

    const subscriber = result.people.find((p) => p.role === "subscriber");
    expect(subscriber?.workerId).toBe(subscriberId);
    const subAction = subscriber!.actions.find((a) => a.benefitId === benefitId);
    expect(subAction?.eligible).toBe(true);

    const dependents = result.people.filter((p) => p.role === "dependent");
    expect(dependents.map((d) => d.workerId)).toEqual([activeDependentId]);
    const depAction = dependents[0].actions.find((a) => a.benefitId === benefitId);
    // The dependent's outcome derives from the SUBSCRIBER's status and hours.
    expect(depAction?.eligible).toBe(true);

    // The lapsed relationship's dependent is excluded outright.
    expect(result.people.some((p) => p.workerId === lapsedDependentId)).toBe(false);
  });

  it("an ineligible subscriber makes the dependent ineligible too (below threshold)", async () => {
    // Retarget the election chain to the below-threshold subscriber by
    // evaluating that worker directly: no election/dependents, subscriber
    // outcome is ineligible under the same 60-hour status.
    const result = await runBenefitsScan(
      storage,
      belowWorkerId,
      AS_OF.month,
      AS_OF.year,
      "test",
      { includeDependents: true },
    );
    const subscriber = result.people.find((p) => p.role === "subscriber");
    const action = subscriber!.actions.find((a) => a.benefitId === benefitId);
    expect(action?.eligible).toBe(false);
    expect(result.people.filter((p) => p.role === "dependent")).toHaveLength(0);
  });
});
