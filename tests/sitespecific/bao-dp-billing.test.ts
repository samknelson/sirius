/**
 * BAO Domestic Partner monthly premium billing — pricing-by-medical-benefit
 * regression suite (all storage stubbed in-memory).
 *
 * The DP rate sheet is the source of WHICH present election benefit is
 * billable: elections bundle one rated medical benefit (Kaiser, Health Net,
 * MLK, …) with ancillary benefits (dental, vision, life, prescription, EAP,
 * AD&D) that intentionally have no DP rates. This suite proves:
 *   - ancillary WMB benefits without DP rates never block a valid medical
 *     DP charge, and the month prices at the medical rate only
 *   - missing and provisional medical rates still fail closed (skipped and
 *     surfaced, never guessed)
 *   - more than one applicable rated benefit is ambiguous — refused, never
 *     summed or double-billed
 *   - re-runs stay idempotent; reversal and reinstatement adjustments keep
 *     reconciling against the (DP, month) net
 *   - verifyEntry re-prices under the same one-medical-benefit rule
 */
import { beforeEach, describe, expect, it } from "vitest";

// Import order matters: initialize the storage module graph BEFORE the plugin.
import { storage } from "../../server/storage/database";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-dp";
import {
  TriggerType,
  type CronContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";

// ---------- In-memory stubs ----------

interface StoredEntry {
  id: string;
  chargePlugin: string;
  chargePluginKey: string;
  chargePluginConfigId: string;
  amount: string;
  referenceType: string;
  referenceId: string;
  statementYmd?: string;
  data: Record<string, any> | null;
}

let entries: StoredEntry[] = [];
let nextEntryId = 1;

function persist(transactions: LedgerTransaction[]) {
  for (const t of transactions) {
    entries.push({
      id: `e${nextEntryId++}`,
      chargePlugin: t.chargePlugin,
      chargePluginKey: t.chargePluginKey,
      chargePluginConfigId: t.chargePluginConfigId,
      amount: t.amount,
      referenceType: t.referenceType || "charge_plugin",
      referenceId: t.referenceId!,
      statementYmd: t.statementYmd,
      data: t.metadata ?? null,
    });
  }
}

const today = new Date();
const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// Coverage window: two months ago .. current month (3 covered months).
const startYm = addMonths(currentYm, -2);
const midYm = addMonths(currentYm, -1);

const SUBSCRIBER = "worker-sub";
const DP_WORKER = "worker-dp";
const DP_REL = "rel-dp-1";
const ELECTION = "election-1";

const MEDICAL = "ben-kaiser";
const ANCILLARY = [
  "ben-dental",
  "ben-vision",
  "ben-life",
  "ben-rx",
  "ben-eap",
  "ben-add",
];
const ALL_BENEFITS = [MEDICAL, ...ANCILLARY];

let relations: any[] = [];
let elections: any[] = [];
let presence: Array<{ benefitId: string; year: number; month: number }> = [];
// rate sheet: benefitId -> transition -> list of {effectiveYmd, rate, provisional}
let rates: Record<
  string,
  Record<string, Array<{ effectiveYmd: string; rate: string; provisional?: boolean }>>
> = {};

(storage as any).workerRelations = {
  async searchWorkerRelations(params: any) {
    if (params.relationTypeNameILike) {
      return relations.filter((r) =>
        (r.relationTypeName ?? "").toLowerCase().includes("domestic partner"),
      );
    }
    return relations;
  },
  async listByIdsWithType(ids: string[]) {
    return relations.filter((r) => ids.includes(r.id));
  },
};
(storage as any).workerTrustElections = {
  async listByWorker(workerId: string) {
    return elections.filter((e) => e.workerId === workerId);
  },
  async getById(id: string) {
    return elections.find((e) => e.id === id);
  },
};
(storage as any).baoDpRates = {
  async getEffectiveRate(benefitId: string, transition: string, asOfYmd: string) {
    const list = rates[benefitId]?.[transition] ?? [];
    const candidates = list
      .filter((r) => r.effectiveYmd <= asOfYmd)
      .sort((a, b) => (a.effectiveYmd < b.effectiveYmd ? 1 : -1));
    return candidates[0];
  },
};
(storage as any).trust = {
  wmb: {
    async getWorkerBenefitPresence(_workerId: string) {
      return presence;
    },
  },
};
(storage as any).ledger = {
  ea: {
    async getOrCreate(entityType: string, entityId: string, accountId: string) {
      return { id: `ea-${entityType}-${entityId}-${accountId}` };
    },
  },
  entries: {
    async getByReferenceAndConfig(referenceId: string, configId: string) {
      return entries.filter(
        (e) => e.referenceId === referenceId && e.chargePluginConfigId === configId,
      );
    },
    async listReferenceIdsByConfigAndType(configId: string, referenceType: string) {
      return Array.from(
        new Set(
          entries
            .filter(
              (e) =>
                e.chargePluginConfigId === configId &&
                e.referenceType === referenceType,
            )
            .map((e) => e.referenceId),
        ),
      );
    },
  },
};

const plugin = getChargePlugin("sitespecific-bao-dp")!;
const config: any = {
  id: "cfg-dp-1",
  enabled: true,
  scope: "global",
  employerId: null,
  account: "acct-hf-dp",
  settings: {},
};
const cronContext: CronContext = {
  trigger: TriggerType.CRON,
  jobId: "job-1",
  mode: "live",
} as any;

async function run() {
  const result = await plugin.execute(cronContext, config);
  if (!result.success) throw new Error(`plugin failed: ${result.error}`);
  persist(result.transactions);
  return result;
}

function netByMonth(): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const bm = e.data?.billingMonth;
    if (!bm) continue;
    m.set(bm, Number(((m.get(bm) ?? 0) + parseFloat(e.amount)).toFixed(2)));
  }
  return m;
}

function setPresence(months: string[], benefitIds: string[]) {
  presence = [];
  for (const ym of months) {
    const [y, m] = ym.split("-").map(Number);
    for (const b of benefitIds) presence.push({ benefitId: b, year: y, month: m });
  }
}

beforeEach(() => {
  entries = [];
  nextEntryId = 1;
  // Subscriber + one DP; the election bundles ONE medical benefit with six
  // ancillary benefits. Non-DP covered lives = 1 -> single_to_2party.
  relations = [
    {
      id: DP_REL,
      worker1: SUBSCRIBER,
      worker2: DP_WORKER,
      relationType: "type-dp",
      relationTypeName: "Domestic Partner",
      startYmd: `${startYm}-01`,
      endYmd: null,
    },
  ];
  elections = [
    {
      id: ELECTION,
      workerId: SUBSCRIBER,
      benefitIds: [...ALL_BENEFITS],
      relationshipIds: [DP_REL],
      startYmd: `${startYm}-01`,
      endYmd: null,
    },
  ];
  // Only the medical benefit has DP rates — configuration-driven, no
  // benefit is identified by name or id in the plugin.
  rates = {
    [MEDICAL]: {
      single_to_2party: [{ effectiveYmd: "2020-01-01", rate: "400.00" }],
    },
  };
  setPresence([startYm, midYm, currentYm], ALL_BENEFITS);
});

describe("DP premium pricing by medical benefit", () => {
  it("bills a bundled election at the medical rate; ancillary WMB benefits never block the month", async () => {
    const r1 = await run();
    expect(r1.transactions).toHaveLength(3);
    for (const t of r1.transactions) {
      expect(t.amount).toBe("400.00");
      expect(t.referenceType).toBe("dp_election");
      // Only the medical rate actually used is recorded in the metadata.
      expect(Object.keys(t.metadata?.benefitRates ?? {})).toEqual([MEDICAL]);
      expect(t.statementYmd).toBe(`${t.metadata?.billingMonth}-01`);
    }
    expect([startYm, midYm, currentYm].sort()).toEqual(
      r1.transactions.map((t) => t.metadata?.billingMonth).sort(),
    );
  });

  it("skips and surfaces months with no rated benefit at all", async () => {
    rates = {};
    const r = await run();
    expect(r.transactions).toHaveLength(0);
    expect(r.message).toContain("missing/provisional rates");
  });

  it("skips and surfaces months whose only medical rate is provisional", async () => {
    rates[MEDICAL].single_to_2party = [
      { effectiveYmd: "2020-01-01", rate: "400.00", provisional: true },
    ];
    const r = await run();
    expect(r.transactions).toHaveLength(0);
    expect(r.message).toContain("missing/provisional rates");
  });

  it("refuses ambiguous months where two present benefits have applicable rates (no summing, no double-billing)", async () => {
    rates["ben-dental"] = {
      single_to_2party: [{ effectiveYmd: "2020-01-01", rate: "35.00" }],
    };
    const r = await run();
    expect(r.transactions).toHaveLength(0);
    expect(r.message).toContain("ambiguous");
  });

  it("stays idempotent across repeated runs", async () => {
    await run();
    const r2 = await run();
    expect(r2.transactions).toHaveLength(0);
    const net = netByMonth();
    for (const ym of [startYm, midYm, currentYm]) expect(net.get(ym)).toBe(400);
  });

  it("reverses months no longer covered and never double-reverses", async () => {
    await run();
    relations[0].endYmd = `${startYm}-15`;
    const r = await run();
    expect(r.transactions).toHaveLength(2);
    for (const t of r.transactions) {
      expect(t.referenceType).toBe("dp_election_adjustment");
      expect(t.amount).toBe("-400.00");
    }
    const net = netByMonth();
    expect(net.get(startYm)).toBe(400);
    expect(net.get(midYm)).toBe(0);
    expect(net.get(currentYm)).toBe(0);
    const r2 = await run();
    expect(r2.transactions).toHaveLength(0);
  });

  it("reinstates re-covered months at the medical-only price", async () => {
    await run();
    relations[0].endYmd = `${startYm}-15`;
    await run();
    relations[0].endYmd = null;
    const r = await run();
    expect(r.transactions).toHaveLength(2);
    for (const t of r.transactions) {
      expect(t.referenceType).toBe("dp_election_adjustment");
      expect(t.amount).toBe("400.00");
      expect(Object.keys(t.metadata?.benefitRates ?? {})).toEqual([MEDICAL]);
    }
    const net = netByMonth();
    for (const ym of [startYm, midYm, currentYm]) expect(net.get(ym)).toBe(400);
  });

  it("does not disturb already-billed months when rates later turn ambiguous", async () => {
    await run();
    rates["ben-vision"] = {
      single_to_2party: [{ effectiveYmd: "2020-01-01", rate: "20.00" }],
    };
    const r = await run();
    // Covered, already billed, now unpriceable: left alone (verifyEntry
    // surfaces drift), never reversed or re-billed.
    expect(r.transactions).toHaveLength(0);
    const net = netByMonth();
    for (const ym of [startYm, midYm, currentYm]) expect(net.get(ym)).toBe(400);
  });

  it("verifyEntry re-prices under the same one-medical-benefit rule", async () => {
    await run();
    const base = entries.find((e) => e.referenceType === "dp_election")!;
    const ok = await plugin.verifyEntry(
      { ...base, memo: null, date: new Date() } as any,
      config,
    );
    expect(ok.isValid).toBe(true);
    expect(ok.expectedAmount).toBe("400.00");

    const drift = await plugin.verifyEntry(
      { ...base, amount: "435.00", memo: null, date: new Date() } as any,
      config,
    );
    expect(drift.isValid).toBe(false);

    // A legacy-shaped entry recording multiple rated benefits violates the
    // one-medical-benefit rule and is flagged.
    const multi = await plugin.verifyEntry(
      {
        ...base,
        memo: null,
        date: new Date(),
        data: {
          ...base.data,
          benefitRates: { [MEDICAL]: "400.00", "ben-dental": "35.00" },
        },
      } as any,
      config,
    );
    expect(multi.isValid).toBe(false);
    expect(
      multi.discrepancies.some((d) => d.includes("exactly one rated medical benefit")),
    ).toBe(true);
  });
});
