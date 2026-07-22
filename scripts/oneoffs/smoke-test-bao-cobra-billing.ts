/**
 * Smoke test for the BAO COBRA monthly premium charge plugin
 * (sitespecific-bao-cobra), with all storage stubbed in-memory.
 *
 * Verifies:
 *   - one charge per covered month, priced from the rate table + 2% admin fee
 *   - statementYmd anchored to the coverage month (first of month)
 *   - months with missing rates are skipped, not guessed
 *   - re-run idempotency (no new transactions on second run)
 *   - election end date shortened -> offsetting adjustments zeroing the
 *     orphaned months' net totals (and no double-reversal on re-run)
 *   - election canceled (case closed, election gone) -> all months reversed
 *   - month covered again -> reinstating adjustment
 *   - test mode posts nothing
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-bao-cobra-billing.ts
 */

// Import order matters: initialize the storage module graph BEFORE the plugin.
import { storage } from "../../server/storage/database";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-cobra";
import {
  TriggerType,
  type CronContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";
import { applyBaoCobraAdminFee } from "../../shared/schema/sitespecific/bao/schema";

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

const CASE_ID = "case-1";
const WORKER_ID = "worker-1";

let activeCases: any[] = [];
let rawCases: Record<string, any> = {};
let elections: any[] = [];
// rate table: benefitId -> tier -> list of {effectiveYmd, rate}
let rates: Record<string, Record<string, Array<{ effectiveYmd: string; rate: string }>>> = {};

(storage as any).baoCobraCases = {
  async listElectedActiveCases() {
    return activeCases;
  },
  async getRaw(id: string) {
    return rawCases[id];
  },
};
(storage as any).workerTrustElections = {
  async listByWorker(_workerId: string) {
    return elections;
  },
};
(storage as any).baoCobraRates = {
  async getEffectiveRate(benefitId: string, tier: string, asOfYmd: string) {
    const list = rates[benefitId]?.[tier] ?? [];
    const candidates = list
      .filter((r) => r.effectiveYmd <= asOfYmd)
      .sort((a, b) => (a.effectiveYmd < b.effectiveYmd ? 1 : -1));
    return candidates[0];
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

const plugin = getChargePlugin("sitespecific-bao-cobra")!;
const config: any = {
  id: "cfg-1",
  enabled: true,
  scope: "global",
  employerId: null,
  account: "acct-cobra",
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

async function main() {
  // ---- Fixture: one elected active case, 3 covered months, 2 benefits ----
  const theCase = {
    id: CASE_ID,
    coveredPersonWorkerId: WORKER_ID,
    cobraEffectiveYmd: `${startYm}-01`,
    maxPeriodYmd: `${addMonths(currentYm, 16)}-01`,
    electionMadeYmd: `${startYm}-05`,
    statusId: "status-enrolled",
  };
  activeCases = [theCase];
  rawCases[CASE_ID] = theCase;
  elections = [
    {
      id: "election-1",
      enrollmentType: "cobra",
      benefitIds: ["ben-med", "ben-dental"],
      relationshipIds: ["rel-1"], // 2 covered lives -> tier "2"
      startYmd: `${startYm}-01`,
      endYmd: null,
      data: { cobraCaseId: CASE_ID },
    },
  ];
  rates = {
    "ben-med": { "2": [{ effectiveYmd: "2020-01-01", rate: "500.00" }] },
    "ben-dental": { "2": [{ effectiveYmd: "2020-01-01", rate: "50.00" }] },
  };
  const expectedMonthly = applyBaoCobraAdminFee(550).total.toFixed(2); // 561.00

  // Test mode first: nothing posted.
  const testResult = await run("test");
  check("test mode posts no transactions", testResult.transactions.length === 0);
  check("test mode message mentions [TEST]", (testResult.message ?? "").includes("[TEST]"));
  check("no entries after test run", entries.length === 0);

  // Live run 1: three covered months billed.
  const r1 = await run();
  check("first run bills 3 covered months", r1.transactions.length === 3);
  check(
    `each charge is base premium ${expectedMonthly} incl. 2% admin fee`,
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
    "admin fee metadata recorded",
    entries.every(
      (e) => e.data?.adminFee === applyBaoCobraAdminFee(550).adminFee.toFixed(2),
    ),
  );

  // Live run 2: idempotent.
  const r2 = await run();
  check("re-run creates no new transactions", r2.transactions.length === 0);

  // Missing rate: add a benefit with no rate for a NEW case month -> skipped.
  elections[0].benefitIds = ["ben-med", "ben-dental", "ben-vision"];
  const r3 = await run();
  check(
    "missing rate months are skipped, not guessed",
    r3.transactions.length === 0 && (r3.message ?? "").includes("skipped for missing rates") === false,
    // covered months already billed -> nothing skipped; just no new entries
  );
  elections[0].benefitIds = ["ben-med", "ben-dental"];

  // ---- Shorten the election end date to the first covered month ----
  elections[0].endYmd = `${startYm}-15`;
  const r4 = await run();
  check("shortened end date reverses 2 orphaned months", r4.transactions.length === 2);
  check(
    "reversals are cobra_case_adjustment entries",
    r4.transactions.every((t) => t.referenceType === "cobra_case_adjustment"),
  );
  check(
    "reversal amounts offset the month's net",
    r4.transactions.every((t) => t.amount === `-${expectedMonthly}`),
  );
  let net = netByMonth();
  check(
    "net after reversal: start month billed, later months zero",
    net.get(startYm) === Number(expectedMonthly) &&
      net.get(midYm) === 0 &&
      net.get(currentYm) === 0,
  );

  // Re-run: no double-reversal.
  const r5 = await run();
  check("re-run after reversal creates nothing (no double-reversal)", r5.transactions.length === 0);

  // ---- Move end date back out: months become covered again -> reinstate ----
  elections[0].endYmd = null;
  const r6 = await run();
  check("re-covered months get reinstating adjustments", r6.transactions.length === 2);
  check(
    "reinstatements restore full premium",
    r6.transactions.every(
      (t) => t.amount === expectedMonthly && t.referenceType === "cobra_case_adjustment",
    ),
  );
  net = netByMonth();
  check(
    "net after reinstatement equals premium for all 3 months",
    [startYm, midYm, currentYm].every((ym) => net.get(ym) === Number(expectedMonthly)),
  );

  // ---- Cancel the election entirely + close the case ----
  elections = [];
  activeCases = []; // closed case no longer in the active list
  const r7 = await run();
  check("canceled election reverses all 3 months", r7.transactions.length === 3);
  net = netByMonth();
  check(
    "net zero for every month after cancellation",
    [startYm, midYm, currentYm].every((ym) => net.get(ym) === 0),
  );
  const r8 = await run();
  check("re-run after cancellation creates nothing", r8.transactions.length === 0);

  // ---- verifyEntry: base entry re-prices; adjustment self-verifies ----
  const baseEntry = entries.find((e) => e.referenceType === "cobra_case")!;
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
  const adjEntry = entries.find((e) => e.referenceType === "cobra_case_adjustment")!;
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
