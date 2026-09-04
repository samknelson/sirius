/**
 * BAO Domestic Partner payment eligibility gate — regression suite (storage
 * stubbed in-memory).
 *
 * Proves the gate:
 *   - passes through for the subscriber and non-DP dependents
 *   - requires a covering election and a configured DP billing account
 *   - grants only when the month's member charge is fully paid
 *   - grants a CONFIRMED no-charge month (non-provisional $0.00 rate under
 *     the shared pricing rule) with no charge and no payment
 *   - still fails closed when the unbilled month's rate is missing,
 *     provisional (even a $0.00 placeholder), ambiguous, or positive
 */
import { beforeEach, describe, expect, it } from "vitest";

import { storage } from "../../server/storage/database";
import { BaoDpPlugin } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-dp";
import type { EligibilityContext } from "../../server/plugins/trust/eligibility/types";

const SUB = "sub-1";
const DP = "dp-1";
const CHILD = "child-1";
const REL_DP = "rel-dp";
const REL_CHILD_1 = "rel-child-1";
const REL_CHILD_2 = "rel-child-2";
const MEDICAL = "benefit-med";
const DENTAL = "benefit-dental";
const ELECTION = "elec-1";
const DP_CONFIG_ID = "cfg-dp";
const DP_ACCOUNT_ID = "acct-dp";

const worker = (id: string) => ({ id }) as any;

function ctx(overrides: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    scanType: "continue",
    asOfMonth: 7,
    asOfYear: 2026,
    benefitId: MEDICAL,
    subscriberWorker: worker(SUB),
    subscriberContact: null,
    dependentWorker: worker(DP),
    dependentContact: { given: "Pat", family: "Partner" } as any,
    relationship: {
      subscriberWorkerId: SUB,
      dependentWorkerId: DP,
      relationType: "type-dp",
    },
    ...overrides,
  } as EligibilityContext;
}

const relRows: Record<string, any> = {
  [REL_DP]: { id: REL_DP, worker1: SUB, worker2: DP, relationTypeName: "Domestic Partner" },
  [REL_CHILD_1]: { id: REL_CHILD_1, worker1: SUB, worker2: CHILD, relationTypeName: "Child" },
  [REL_CHILD_2]: { id: REL_CHILD_2, worker1: SUB, worker2: "child-2", relationTypeName: "Child" },
};
let activeRel: any;
let elections: any[];
let dpConfigured: boolean;
let dpEntries: any[];
let dpBalance: string;
let rates: Record<
  string,
  Record<string, Array<{ effectiveYmd: string; rate: string; provisional?: boolean }>>
>;

(storage as any).workerRelations = {
  findActiveBetween: async () => activeRel,
  listByIdsWithType: async (ids: string[]) => ids.map((i) => relRows[i]).filter(Boolean),
};
(storage as any).workerTrustElections = {
  listByWorker: async () => elections,
};
(storage as any).pluginConfigs = {
  search: async (_kind: string, params: any) => {
    if (!dpConfigured || params?.pluginId !== "sitespecific-bao-dp") return [];
    return [
      {
        config: {
          id: DP_CONFIG_ID,
          pluginId: "sitespecific-bao-dp",
          name: "DP",
          enabled: true,
          data: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        subsidiary: { scope: "global", employerId: null, account: DP_ACCOUNT_ID },
      },
    ];
  },
};
(storage as any).ledger = {
  entries: {
    getBalancesByEntityAndAccount: async () => [{ total: dpBalance }],
    getByReferenceAndConfig: async (refId: string, cfgId: string) =>
      refId === ELECTION && cfgId === DP_CONFIG_ID ? dpEntries : [],
  },
};
// Subscriber WMB presence for the as-of month (benefit ids). Default: every
// election benefit present, like a normally covered month.
let presentBenefits: string[];
(storage as any).trust = {
  wmb: {
    getWorkerBenefitPresence: async (workerId: string) =>
      workerId === SUB
        ? presentBenefits.map((benefitId) => ({ benefitId, year: 2026, month: 7 }))
        : [],
  },
};
(storage as any).baoDpRates = {
  async getEffectiveRate(benefitId: string, transition: string, asOfYmd: string) {
    const list = rates[benefitId]?.[transition] ?? [];
    return list
      .filter((r) => r.effectiveYmd <= asOfYmd)
      .sort((a, b) => (a.effectiveYmd < b.effectiveYmd ? 1 : -1))[0];
  },
};

const chargeEntry = (amount: string, month = "2026-07") => ({
  amount,
  data: { billingMonth: month, dpRelationshipId: REL_DP, dpWorkerId: DP },
});

const baseElection = {
  id: ELECTION,
  workerId: SUB,
  relationshipIds: [REL_DP, REL_CHILD_1],
  benefitIds: [MEDICAL, DENTAL],
  startYmd: "2026-01-01",
  endYmd: null,
};

const plugin = new BaoDpPlugin();
const evaluate = (c: EligibilityContext = ctx()) =>
  plugin.evaluate(c, { appliesTo: ["start", "continue"] } as any);

beforeEach(() => {
  activeRel = relRows[REL_DP];
  elections = [{ ...baseElection }];
  dpConfigured = true;
  dpEntries = [];
  dpBalance = "0";
  rates = {};
  presentBenefits = [MEDICAL, DENTAL];
});

describe("DP payment gate — scope and paid-charge paths", () => {
  it("passes through for the subscriber's own evaluation", async () => {
    const r = await evaluate(ctx({ relationship: undefined, dependentWorker: worker(SUB) }));
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/subscriber/i);
  });

  it("passes through for a non-DP dependent", async () => {
    activeRel = relRows[REL_CHILD_1];
    const r = await evaluate(
      ctx({
        dependentWorker: worker(CHILD),
        relationship: { subscriberWorkerId: SUB, dependentWorkerId: CHILD, relationType: "t" },
      }),
    );
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/only to domestic-partner/i);
  });

  it("fails without a covering election", async () => {
    elections = [];
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no active election/i);
  });

  it("fails when no DP billing account is configured", async () => {
    dpConfigured = false;
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/billing account/i);
  });

  it("fails on a partial payment and passes when fully paid (2026 Health Net 2-party → family)", async () => {
    dpEntries = [chargeEntry("206.44")];
    dpBalance = "100.00";
    expect((await evaluate()).eligible).toBe(false);
    dpBalance = "0";
    const r = await evaluate();
    expect(r.eligible).toBe(true);
    expect(r.reason).toContain("$206.44 of $206.44");
  });

  it("fails when the only paid charge is for a different month", async () => {
    dpEntries = [chargeEntry("206.44", "2026-06")];
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/no dp charge has been posted/i);
  });
});

describe("DP payment gate — confirmed no-charge months", () => {
  const family = () => {
    // Member already has two children → family_to_family_dp.
    elections = [{ ...baseElection, relationshipIds: [REL_DP, REL_CHILD_1, REL_CHILD_2] }];
  };

  it("grants a confirmed $0.00 family → family month with no charge and no payment", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/confirmed no-charge month/i);
    expect(r.reason).toContain("Family → Family with DP");
  });

  it("grants a confirmed no-charge month even when no DP billing account is configured", async () => {
    family();
    dpConfigured = false;
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/confirmed no-charge month/i);
  });

  it("still requires a billing account when the month is NOT confirmed no charge", async () => {
    family();
    dpConfigured = false;
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: true }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/billing account/i);
  });

  it("grants a confirmed no-charge month even if a stale charge is still posted and unpaid", async () => {
    // Billed before the rate was confirmed $0; the biller zeroes it on its
    // next run, and coverage must not wait on that.
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    dpEntries = [chargeEntry("100.00")];
    dpBalance = "100";
    const r = await evaluate();
    expect(r.eligible).toBe(true);
  });

  it("prices only from benefits the subscriber actually has that month: rated medical absent → fail closed (matches billing)", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    // Medical not present for July; only dental is. Billing would find no
    // rated present benefit and skip — the gate must not waive either, for
    // the dental evaluation or the medical one.
    presentBenefits = [DENTAL];
    expect((await evaluate(ctx({ benefitId: DENTAL }))).eligible).toBe(false);
    expect((await evaluate(ctx({ benefitId: MEDICAL }))).eligible).toBe(false);
    // Converse: medical present, dental absent → medical prices to no charge.
    presentBenefits = [MEDICAL];
    expect((await evaluate(ctx({ benefitId: MEDICAL }))).eligible).toBe(true);
    // No presence at all → fail closed.
    presentBenefits = [];
    expect((await evaluate()).eligible).toBe(false);
  });

  it("ignores ancillary (unrated) benefits when recognising a no-charge month", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    const r = await evaluate(ctx({ benefitId: DENTAL }));
    expect(r.eligible).toBe(true);
  });

  it("does NOT waive a provisional $0.00 placeholder", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: true }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/missing required charge/i);
  });

  it("does NOT waive a month with no rate row at all", async () => {
    family();
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/missing required charge/i);
  });

  it("does NOT waive a no-charge rate that is not yet effective for the month", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-08-01", rate: "0.00", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
  });

  it("does NOT waive an unbilled month whose confirmed rate is positive", async () => {
    // Single +1 → family: a real member charge is owed and simply not billed yet.
    rates = {
      [MEDICAL]: {
        "2party_to_family": [{ effectiveYmd: "2026-01-01", rate: "206.44", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/missing required charge/i);
  });

  it("does NOT waive an ambiguous month (two rated benefits)", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
      [DENTAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
  });

  it("uses the election shape, not the rate sheet alone: a no-charge family rate never frees a single member", async () => {
    // Election = member + DP only → single_to_2party; the family row is irrelevant.
    elections = [{ ...baseElection, relationshipIds: [REL_DP] }];
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
        single_to_2party: [{ effectiveYmd: "2026-01-01", rate: "291.62", provisional: false }],
      },
    };
    const r = await evaluate();
    expect(r.eligible).toBe(false);
  });

  it("a fully reversed charge on a confirmed no-charge month still grants coverage", async () => {
    family();
    rates = {
      [MEDICAL]: {
        family_to_family_dp: [{ effectiveYmd: "2026-01-01", rate: "0.00", provisional: false }],
      },
    };
    dpEntries = [chargeEntry("100.00"), chargeEntry("-100.00")];
    const r = await evaluate();
    expect(r.eligible).toBe(true);
  });
});
