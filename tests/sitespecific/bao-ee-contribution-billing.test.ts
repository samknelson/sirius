/**
 * BAO EE contribution billing regression cases.  This is deliberately an
 * in-memory storage harness: the important behavior is reconciliation of
 * coverage/policy/rate facts, not database plumbing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { storage } from "../../server/storage/database";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-ee-contribution";
import { TriggerType, type CronContext } from "../../server/plugins/ledger/charge/types";
import {
  createPolicyResolutionCache,
  resolveGrantingWorkerPolicyAsOf,
} from "../../server/services/policy-resolution";

const SUBSCRIBER = "subscriber-1";
const DEPENDENT = "dependent-1";
const BENEFIT = "benefit-kaiser";
const EMPLOYER = "employer-1";
const POLICY_A = "policy-unite";
const POLICY_B = "policy-event-center";
const MONTH = { year: 2026, month: 4 };

type Entry = {
  id: string;
  chargePlugin: string;
  chargePluginKey: string;
  chargePluginConfigId: string;
  eaId: string;
  amount: string;
  referenceType: string;
  referenceId: string;
  statementYmd: string;
  memo: string;
  date: Date;
  data: Record<string, unknown>;
};

let entries: Entry[];
let coverage: Array<any>;
let rates: Array<any>;
let policyId: string | null;
let relationPresent: boolean;
let nextId: number;
let coverageLookups: string[];

const config: any = {
  id: "ee-config",
  enabled: true,
  scope: "global",
  employerId: null,
  account: "worker-contribution-account",
  settings: {},
};
const cron: CronContext = {
  trigger: TriggerType.CRON,
  jobId: "ledger-charge-cron",
  mode: "live",
};

function net(policy: string): number {
  return entries
    .filter((entry) => entry.data.policyId === policy)
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

function netForEa(eaId: string): number {
  return entries
    .filter((entry) => entry.eaId === eaId)
    .reduce((total, entry) => total + Number(entry.amount), 0);
}

async function runCron() {
  const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;
  const result = await plugin.execute(cron, config);
  expect(result.success).toBe(true);
  return result;
}

beforeEach(() => {
  entries = [];
  rates = [
    {
      id: "rate-a",
      policyId: POLICY_A,
      benefitId: BENEFIT,
      rate: "50.00",
      effectiveYmd: "2026-01-01",
    },
  ];
  coverage = [
    {
      subscriberWorkerId: SUBSCRIBER,
      benefitId: BENEFIT,
      ...MONTH,
      // Dependent-only coverage, with duplicate dependent rows.  It remains
      // one flat subscriber contribution.
      wmbIds: ["dependent-wmb-1", "dependent-wmb-2"],
      employerIds: [EMPLOYER],
    },
  ];
  policyId = POLICY_A;
  relationPresent = true;
  nextId = 1;
  coverageLookups = [];
  config.account = "worker-contribution-account";

  (storage as any).advisoryLock = {
    async withTransactionLock(_name: string, fn: () => Promise<unknown>) {
      return fn();
    },
  };
  (storage as any).ledger = {
    ea: {
      async getOrCreate(_entityType: string, entityId: string, accountId: string) {
        return { id: `ea:${entityId}:${accountId}` };
      },
      async getByEntityAndAccount(
        _entityType: string,
        entityId: string,
        accountId: string,
      ) {
        return { id: `ea:${entityId}:${accountId}` };
      },
    },
    entries: {
      async listByChargePluginAndConfig(pluginId: string, configId: string) {
        return entries.filter(
          (entry) =>
            entry.chargePlugin === pluginId &&
            entry.chargePluginConfigId === configId,
        );
      },
      async create(input: any) {
        const entry: Entry = {
          id: `entry-${nextId++}`,
          date: new Date(),
          ...input,
        };
        entries.push(entry);
        return entry;
      },
    },
  };
  (storage as any).trust = {
    wmb: {
      async listEeContributionCoverage() {
        return coverage;
      },
      async getEeContributionCoverage(
        subscriberWorkerId: string,
        benefitId: string,
        month: number,
        year: number,
      ) {
        coverageLookups.push(`${subscriberWorkerId}:${benefitId}:${year}:${month}`);
        return (
          coverage.find(
            (row) =>
              row.subscriberWorkerId === subscriberWorkerId &&
              row.benefitId === benefitId &&
              row.month === month &&
              row.year === year,
          ) ?? null
        );
      },
    },
  };
  (storage as any).workerRelations = {
    async get() {
      return relationPresent ? { worker1: SUBSCRIBER } : undefined;
    },
  };
  (storage as any).workerTrustElections = {
    async listByWorker() {
      return [
        {
          employerId: EMPLOYER,
          startYmd: "2020-01-01",
          endYmd: null,
        },
      ];
    },
  };
  (storage as any).workers = {
    async getWorker() {
      return { denormHomeEmployerId: EMPLOYER };
    },
  };
  (storage as any).employerPolicyHistory = {
    async getEmployerPolicyHistory() {
      return policyId ? [{ date: "2020-01-01", policy: { id: policyId } }] : [];
    },
  };
  (storage as any).employers = {
    async getEmployer() {
      return { id: EMPLOYER, name: "Test employer", denormPolicyId: null };
    },
  };
  (storage as any).policies = {
    async getPolicyById(id: string) {
      return { id };
    },
  };
  (storage as any).variables = {
    async getByName() {
      return null;
    },
  };
  (storage as any).baoEeContributionRates = {
    async getEffectiveRate(policy: string, benefit: string, asOfYmd: string) {
      return rates
        .filter(
          (rate) =>
            rate.policyId === policy &&
            rate.benefitId === benefit &&
            rate.effectiveYmd <= asOfYmd,
        )
        .sort((a, b) => b.effectiveYmd.localeCompare(a.effectiveYmd))[0];
    },
  };
});

describe("BAO EE contribution charge reconciliation", () => {
  it("uses the last day of the coverage month for granting-election employer selection", async () => {
    const resolved = await resolveGrantingWorkerPolicyAsOf(
      {
        workerTrustElections: {
          async listByWorker() {
            return [
              {
                employerId: "corrected-employer",
                startYmd: "2026-04-15",
                endYmd: null,
              },
            ];
          },
        },
        workers: {
          async getWorker() {
            return { denormHomeEmployerId: "old-home-employer" };
          },
        },
        employers: {
          async getEmployer(id: string) {
            return { id, name: id, denormPolicyId: null };
          },
        },
        employerPolicyHistory: {
          async getEmployerPolicyHistory(id: string) {
            return [
              {
                date: "2020-01-01",
                policy: { id: id === "corrected-employer" ? POLICY_B : POLICY_A },
              },
            ];
          },
        },
        policies: { async getPolicyById(id: string) { return { id } as any; } },
        variables: { async getByName() { return null; } },
      },
      SUBSCRIBER,
      "2026-04-01",
    );
    expect(resolved).toMatchObject({
      employerId: "corrected-employer",
      policy: { id: POLICY_B },
      resolutionStatus: "resolved",
    });
  });

  it("fails closed when one of several historical granting employers has no policy", async () => {
    const resolved = await resolveGrantingWorkerPolicyAsOf(
      {
        workerTrustElections: {
          async listByWorker() {
            return [
              { employerId: "employer-with-policy", startYmd: "2020-01-01" },
              { employerId: "employer-without-policy", startYmd: "2020-01-01" },
            ];
          },
        },
        workers: { async getWorker() { return { denormHomeEmployerId: null }; } },
        employers: {
          async getEmployer(id: string) {
            return { id, name: id, denormPolicyId: null };
          },
        },
        employerPolicyHistory: {
          async getEmployerPolicyHistory(id: string) {
            return id === "employer-with-policy"
              ? [{ date: "2020-01-01", policy: { id: POLICY_A } }]
              : [];
          },
        },
        policies: { async getPolicyById(id: string) { return { id } as any; } },
        variables: { async getByName() { return null; } },
      },
      SUBSCRIBER,
      "2026-04-01",
      createPolicyResolutionCache(),
    );
    expect(resolved).toMatchObject({
      policy: null,
      resolutionStatus: "missing",
    });
  });

  it("bills dependent-only coverage once and is idempotent", async () => {
    await runCron();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amount: "50.00",
      referenceType: "bao_ee_contribution",
      eaId: `ea:${SUBSCRIBER}:${config.account}`,
    });
    expect(entries[0].data).toMatchObject({
      subscriberWorkerId: SUBSCRIBER,
      policyId: POLICY_A,
      benefitId: BENEFIT,
      coverageWmbIds: ["dependent-wmb-1", "dependent-wmb-2"],
    });

    await runCron();
    expect(entries).toHaveLength(1);
    expect(net(POLICY_A)).toBe(50);
  });

  it("reconciles an effective-dated correction against charges only, then reverses deleted coverage", async () => {
    await runCron();
    rates.push({
      id: "rate-a-april",
      policyId: POLICY_A,
      benefitId: BENEFIT,
      rate: "60.00",
      effectiveYmd: "2026-04-01",
    });
    await runCron();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      amount: "10.00",
      referenceType: "bao_ee_contribution_adjustment",
    });
    expect(net(POLICY_A)).toBe(60);

    coverage = [];
    await runCron();
    expect(entries).toHaveLength(3);
    expect(entries[2].amount).toBe("-60.00");
    expect(net(POLICY_A)).toBe(0);

    // A repeat has no second reversal.
    await runCron();
    expect(entries).toHaveLength(3);
  });

  it("does not silently reverse an existing charge when the rate is missing", async () => {
    await runCron();
    rates = [];
    const result = await runCron();
    expect(result.message).toContain("1 configuration diagnostic");
    expect(entries).toHaveLength(1);
    expect(net(POLICY_A)).toBe(50);
  });

  it("verifies the priced net of base plus adjustments, not an individual base amount", async () => {
    await runCron();
    rates.push({
      id: "rate-a-april",
      policyId: POLICY_A,
      benefitId: BENEFIT,
      rate: "60.00",
      effectiveYmd: "2026-04-01",
    });
    await runCron();
    const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;

    // The original base remains $50, but the $10 append-only correction means
    // both entries verify against the $60 currently selected monthly rate.
    const baseVerification = await plugin.verifyEntry(entries[0] as any, config);
    const adjustmentVerification = await plugin.verifyEntry(entries[1] as any, config);
    expect(baseVerification).toMatchObject({
      isValid: true,
      expectedAmount: "60.00",
    });
    expect(adjustmentVerification).toMatchObject({
      isValid: true,
      expectedAmount: "60.00",
    });
  });

  it("zeros the prior account before posting the replacement account charge", async () => {
    await runCron();
    const oldEa = `ea:${SUBSCRIBER}:${config.account}`;
    config.account = "replacement-worker-contribution-account";
    const newEa = `ea:${SUBSCRIBER}:${config.account}`;

    await runCron();
    expect(netForEa(oldEa)).toBe(0);
    expect(netForEa(newEa)).toBe(50);
    // The append-only old-account reversal precedes the new base, so existing
    // allocations remain associated with their original EA.
    expect(entries.slice(1).map((entry) => entry.eaId)).toEqual([oldEa, newEa]);
    expect(entries[1].amount).toBe("-50.00");
    expect(entries[2].amount).toBe("50.00");

    const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;
    expect((await plugin.verifyEntry(entries[0] as any, config)).isValid).toBe(true);
    expect((await plugin.verifyEntry(entries[2] as any, config)).isValid).toBe(true);
  });

  it("zeros old policy attribution before creating the replacement", async () => {
    await runCron();
    policyId = POLICY_B;
    rates.push({
      id: "rate-b",
      policyId: POLICY_B,
      benefitId: BENEFIT,
      rate: "75.00",
      effectiveYmd: "2020-01-01",
    });

    await runCron();
    expect(net(POLICY_A)).toBe(0);
    expect(net(POLICY_B)).toBe(75);
    expect(entries.slice(1).map((entry) => entry.data.policyId)).toEqual([
      POLICY_A,
      POLICY_B,
    ]);
    expect(entries[1].amount).toBe("-50.00");
    expect(entries[2].amount).toBe("75.00");
  });

  it("uses historical coverage attribution to reverse an immediate deleted WMB after its relation is gone", async () => {
    await runCron();
    coverage = [];
    relationPresent = false;
    const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;
    const result = await plugin.execute(
      {
        trigger: TriggerType.WMB_SAVED,
        wmbId: "dependent-wmb-1",
        workerId: DEPENDENT,
        employerId: EMPLOYER,
        benefitId: BENEFIT,
        ...MONTH,
        sourceRelationId: "relation-removed",
        isDeleted: true,
      },
      config,
    );
    expect(result.success).toBe(true);
    expect(net(POLICY_A)).toBe(0);
    expect(entries.at(-1)?.amount).toBe("-50.00");
  });

  it("limits an immediate WMB event to its own historical benefit/month identities", async () => {
    await runCron();
    // Seed unrelated history under the same config; it must remain a CRON-only
    // recovery subject when a different WMB event arrives.
    coverage.push({
      subscriberWorkerId: "another-subscriber",
      benefitId: "another-benefit",
      year: 2025,
      month: 1,
      wmbIds: ["other-wmb"],
      employerIds: [EMPLOYER],
    });
    rates.push({
      id: "other-rate",
      policyId: POLICY_A,
      benefitId: "another-benefit",
      rate: "30.00",
      effectiveYmd: "2020-01-01",
    });
    await runCron();
    const unrelatedEntries = entries.filter(
      (entry) => entry.data?.benefitId === "another-benefit",
    );
    const unrelatedNet = unrelatedEntries.reduce(
      (total, entry) => total + Number(entry.amount),
      0,
    );
    coverageLookups = [];
    const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;
    await plugin.execute(
      {
        trigger: TriggerType.WMB_SAVED,
        wmbId: "dependent-wmb-1",
        workerId: DEPENDENT,
        employerId: EMPLOYER,
        benefitId: BENEFIT,
        ...MONTH,
        sourceRelationId: "relation-1",
      },
      config,
    );
    expect(coverageLookups).toEqual([
      `${SUBSCRIBER}:${BENEFIT}:${MONTH.year}:${MONTH.month}`,
    ]);
    const unrelatedAfter = entries.filter(
      (entry) => entry.data?.benefitId === "another-benefit",
    );
    expect(unrelatedAfter).toHaveLength(unrelatedEntries.length);
    expect(unrelatedAfter.reduce((total, entry) => total + Number(entry.amount), 0)).toBe(
      unrelatedNet,
    );
  });

  it("serializes concurrent reconciliations through the config advisory lock", async () => {
    let tail = Promise.resolve();
    let active = 0;
    let maxActive = 0;
    (storage as any).advisoryLock = {
      async withTransactionLock(_name: string, fn: () => Promise<unknown>) {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          return await fn();
        } finally {
          active--;
          release();
        }
      },
    };
    const plugin = getChargePlugin("sitespecific-bao-ee-contribution")!;
    await Promise.all([
      plugin.execute(cron, config),
      plugin.execute(cron, config),
    ]);
    expect(maxActive).toBe(1);
    expect(entries).toHaveLength(1);
  });
});