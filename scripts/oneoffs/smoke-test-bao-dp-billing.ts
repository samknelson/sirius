/**
 * Smoke test for the BAO Domestic Partner monthly premium charge plugin
 * (sitespecific-bao-dp), with all storage stubbed in-memory.
 *
 * Verifies:
 *   - one charge per (DP, covered month), priced from the DP rate sheet at
 *     the tier transition derived from non-DP covered lives; the rate sheet
 *     decides WHICH benefit is billable (ancillary benefits without DP
 *     rates are ignored; multiple rated benefits = ambiguous, refused)
 *   - statementYmd anchored to the coverage month (first of month)
 *   - months without subscriber benefit presence are skipped, not billed
 *   - months with missing or PROVISIONAL rates are skipped, not guessed
 *   - re-run idempotency (no new transactions on second run)
 *   - relationship end date shortened -> offsetting adjustments zeroing the
 *     orphaned months' net totals (and no double-reversal on re-run)
 *   - DP removed from the election entirely -> all months reversed (sweep)
 *   - month covered again -> reinstating adjustment
 *   - test mode posts nothing
 *   - verifyEntry re-prices base entries and self-verifies adjustments
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-bao-dp-billing.ts
 */

// Import order matters: initialize the storage module graph BEFORE the plugin.
import { storage } from "../../server/storage/database";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-dp";
import {
  TriggerType,
  type CronContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

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

let relations: any[] = [];
let elections: any[] = [];
// benefit presence rows for the subscriber: {benefitId, year, month}
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

function netByMonth(): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const bm = e.data?.billingMonth;
    if (!bm) continue;
    m.set(bm, Number(((m.get(bm) ?? 0) + parseFloat(e.amount)).toFixed(2)));
  }
  return m;
}

async function run(mode: "live" | "test" = "live") {
  const result = await plugin.execute({ ...cronContext, mode } as any, config);
  if (!result.success) throw new Error(`plugin failed: ${result.error}`);
  if (mode === "live") persist(result.transactions);
  return result;
}

function setPresence(months: string[], benefitIds: string[]) {
  presence = [];
  for (const ym of months) {
    const [y, m] = ym.split("-").map(Number);
    for (const b of benefitIds) presence.push({ benefitId: b, year: y, month: m });
  }
}

async function main() {
  // ---- Fixture: subscriber + one DP, election with the DP only ----
  // Non-DP covered lives = 1 (subscriber only) -> transition single_to_2party.
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
      benefitIds: ["ben-med", "ben-dental"],
      relationshipIds: [DP_REL],
      startYmd: `${startYm}-01`,
      endYmd: null,
    },
  ];
  // Only the medical benefit is rated; dental is an ancillary WMB benefit
  // with NO DP rates and must be ignored, never a reason to skip the month.
  rates = {
    "ben-med": {
      single_to_2party: [{ effectiveYmd: "2020-01-01", rate: "400.00" }],
    },
  };
  setPresence([startYm, midYm, currentYm], ["ben-med", "ben-dental"]);
  const expectedMonthly = "400.00";

  // Test mode first: nothing posted.
  const testResult = await run("test");
  check("test mode posts no transactions", testResult.transactions.length === 0);
  check("test mode message mentions [TEST]", (testResult.message ?? "").includes("[TEST]"));
  check("no entries after test run", entries.length === 0);

  // Live run 1: three covered months billed (next month has no presence -> skipped).
  const r1 = await run();
  check("first run bills 3 covered months", r1.transactions.length === 3);
  check(
    `each charge is the medical benefit DP rate ${expectedMonthly} (ancillary dental ignored)`,
    r1.transactions.every((t) => t.amount === expectedMonthly),
  );
  check(
    "statementYmd is first of the coverage month",
    entries.every((e) => e.statementYmd === `${e.data?.billingMonth}-01`),
  );
  check(
    "months billed are the covered window",
    [startYm, midYm, currentYm].every((ym) =>
      entries.some((e) => e.data?.billingMonth === ym),
    ),
  );
  check(
    "next month (no subscriber presence) surfaced as skipped",
    (r1.message ?? "").includes("missing subscriber coverage"),
  );
  check(
    "tier transition recorded in metadata",
    entries.every((e) => e.data?.dpTierTransition === "single_to_2party"),
  );
  check(
    "dp relationship + worker recorded in metadata",
    entries.every(
      (e) => e.data?.dpRelationshipId === DP_REL && e.data?.dpWorkerId === DP_WORKER,
    ),
  );

  // Live run 2: idempotent.
  const r2 = await run();
  check("re-run creates no new transactions", r2.transactions.length === 0);

  // Provisional rate: switch next month's presence on, but make the rate
  // provisional for one benefit -> month skipped, not guessed.
  const nextYm = addMonths(currentYm, 1);
  setPresence([startYm, midYm, currentYm, nextYm], ["ben-med", "ben-dental"]);
  rates["ben-med"].single_to_2party.push({
    effectiveYmd: `${nextYm}-01`,
    rate: "0.00",
    provisional: true,
  });
  const r3 = await run();
  check(
    "provisional rate month is skipped, not billed",
    r3.transactions.length === 0 && (r3.message ?? "").includes("missing/provisional"),
  );
  rates["ben-med"].single_to_2party = rates["ben-med"].single_to_2party.filter(
    (r) => !r.provisional,
  );

  // Ambiguous: a second present benefit gains an applicable rate -> the
  // month must be refused (never summed or double-billed).
  rates["ben-dental"] = {
    single_to_2party: [{ effectiveYmd: "2020-01-01", rate: "35.00" }],
  };
  const rAmb = await run();
  check(
    "two rated present benefits -> month skipped as ambiguous",
    rAmb.transactions.length === 0 && (rAmb.message ?? "").includes("ambiguous"),
  );
  delete rates["ben-dental"];

  // One month in advance: with a real rate, next month bills.
  const r3b = await run();
  check("next month bills once presence + real rate exist", r3b.transactions.length === 1);
  check(
    "advance month billed at the same rate",
    r3b.transactions[0].amount === expectedMonthly &&
      r3b.transactions[0].metadata?.billingMonth === nextYm,
  );

  // ---- Shorten the relationship end date to the first covered month ----
  relations[0].endYmd = `${startYm}-15`;
  const r4 = await run();
  check("shortened relationship reverses 3 orphaned months", r4.transactions.length === 3);
  check(
    "reversals are dp_election_adjustment entries",
    r4.transactions.every((t) => t.referenceType === "dp_election_adjustment"),
  );
  check(
    "reversal amounts offset each month's net",
    r4.transactions.every((t) => t.amount === `-${expectedMonthly}`),
  );
  let net = netByMonth();
  check(
    "net after reversal: start month billed, later months zero",
    net.get(startYm) === Number(expectedMonthly) &&
      net.get(midYm) === 0 &&
      net.get(currentYm) === 0 &&
      net.get(nextYm) === 0,
  );

  // Re-run: no double-reversal.
  const r5 = await run();
  check("re-run after reversal creates nothing (no double-reversal)", r5.transactions.length === 0);

  // ---- Relationship reinstated: months covered again -> reinstate ----
  relations[0].endYmd = null;
  const r6 = await run();
  check("re-covered months get reinstating adjustments", r6.transactions.length === 3);
  check(
    "reinstatements restore full premium",
    r6.transactions.every(
      (t) => t.amount === expectedMonthly && t.referenceType === "dp_election_adjustment",
    ),
  );
  net = netByMonth();
  check(
    "net after reinstatement equals premium for all 4 months",
    [startYm, midYm, currentYm, nextYm].every((ym) => net.get(ym) === Number(expectedMonthly)),
  );

  // ---- Remove the DP from the election entirely (sweep path) ----
  elections[0].relationshipIds = [];
  const r7 = await run();
  check("DP removed from election reverses all 4 months", r7.transactions.length === 4);
  net = netByMonth();
  check(
    "net zero for every month after removal",
    [startYm, midYm, currentYm, nextYm].every((ym) => net.get(ym) === 0),
  );
  const r8 = await run();
  check("re-run after removal creates nothing", r8.transactions.length === 0);

  // ---- Tier transition with a non-DP dependent (spouse-like) ----
  relations.push({
    id: "rel-child",
    worker1: SUBSCRIBER,
    worker2: "worker-child",
    relationType: "type-child",
    relationTypeName: "Child",
    startYmd: `${startYm}-01`,
    endYmd: null,
  });
  elections[0].relationshipIds = [DP_REL, "rel-child"];
  rates["ben-med"]["2party_to_family"] = [{ effectiveYmd: "2020-01-01", rate: "600.00" }];
  const r9 = await run();
  check(
    "2 non-DP lives -> 2party_to_family transition, reinstated at new tier price",
    r9.transactions.length === 4 &&
      r9.transactions.every(
        (t) => t.amount === "600.00" && t.metadata?.dpTierTransition === "2party_to_family",
      ),
  );

  // ---- verifyEntry: base entry re-prices; adjustment self-verifies ----
  const baseEntry = entries.find((e) => e.referenceType === "dp_election")!;
  const v1 = await plugin.verifyEntry(
    { ...baseEntry, memo: null, date: new Date(), statementYmd: baseEntry.statementYmd } as any,
    config,
  );
  check("verifyEntry validates a correct base entry", v1.isValid);
  const v2 = await plugin.verifyEntry(
    { ...baseEntry, amount: "1.00", memo: null, date: new Date() } as any,
    config,
  );
  check("verifyEntry flags amount drift on base entry", !v2.isValid);
  const adjEntry = entries.find((e) => e.referenceType === "dp_election_adjustment")!;
  const v3 = await plugin.verifyEntry(
    { ...adjEntry, memo: null, date: new Date() } as any,
    config,
  );
  check("verifyEntry validates a correct adjustment entry", v3.isValid);
  const v4 = await plugin.verifyEntry(
    { ...adjEntry, amount: "999.99", memo: null, date: new Date() } as any,
    config,
  );
  check("verifyEntry flags a wrong adjustment amount", !v4.isValid);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
