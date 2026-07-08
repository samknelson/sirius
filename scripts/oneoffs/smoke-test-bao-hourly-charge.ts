/**
 * Smoke test for the BAO Hourly charge plugin (bao-hourly).
 *
 * Verifies, with all storage stubbed in-memory (no real DB access):
 *   - billed vs non-billed employment-status gating
 *   - rate effective-date selection (latest effective_ymd <= work date)
 *   - no charge when no rate exists or rate is zero
 *   - statement_ymd anchored to the work month
 *   - re-run idempotency (second run with same inputs produces no transactions)
 *   - amount change produces a single correcting adjustment entry
 *   - de-qualification deletes existing entries
 *
 * Run: npx tsx scripts/oneoffs/smoke-test-bao-hourly-charge.ts
 */

// Import order matters: initialize the storage module graph the same way the
// app boots, BEFORE importing the plugin (avoids a circular-init crash).
import { storage } from "../../server/storage/database";
import {
  baoHourlyChargePlugin,
  isStatusBilled,
} from "../../server/plugins/ledger/charge/plugins/sitespecific-bao-hourly";
import {
  TriggerType,
  type HoursSavedContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

// ---------- In-memory stubs ----------

interface RateRow {
  id: string;
  employerId: string;
  accountId: string;
  rate: string;
  effectiveYmd: string;
}

let rateRows: RateRow[] = [];

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
  memo?: string;
}

let entries: StoredEntry[] = [];
let nextEntryId = 1;

(storage as any).baoEmployerRates = {
  async getEffectiveRate(employerId: string, accountId: string, asOfYmd: string) {
    const candidates = rateRows
      .filter(
        (r) =>
          r.employerId === employerId &&
          r.accountId === accountId &&
          r.effectiveYmd <= asOfYmd,
      )
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
    async getByChargePluginKey(chargePlugin: string, key: string) {
      return entries.find(
        (e) => e.chargePlugin === chargePlugin && e.chargePluginKey === key,
      );
    },
    async getByReferenceAndConfig(referenceId: string, configId: string) {
      return entries.filter(
        (e) => e.referenceId === referenceId && e.chargePluginConfigId === configId,
      );
    },
    async delete(id: string) {
      entries = entries.filter((e) => e.id !== id);
      return true;
    },
  },
};

/** Mimics the executor: persist the plugin's returned transactions. */
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
      memo: t.description,
    });
  }
}

// ---------- Fixtures ----------

const ACCOUNT = "acct-1";
const EMPLOYER = "emp-1";
const BILLED_STATUS = "status-billed";
const NOCHARGE_STATUS = "status-nocharge";

const config: any = {
  id: "cfg-1",
  account: ACCOUNT,
  enabled: true,
  scope: "global",
  settings: {
    nonBilledEmploymentStatusIds: [NOCHARGE_STATUS],
  },
};

function hoursCtx(overrides: Partial<HoursSavedContext> = {}): HoursSavedContext {
  return {
    trigger: TriggerType.HOURS_SAVED,
    hoursId: "hours-1",
    workerId: "worker-1",
    employerId: EMPLOYER,
    year: 2026,
    month: 6,
    day: 15,
    hours: 100,
    employmentStatusId: BILLED_STATUS,
    home: true,
    ...overrides,
  };
}

async function run() {
  // --- status gating helper ---
  check(
    "isStatusBilled: exclusion list wins",
    !isStatusBilled(
      { billedEmploymentStatusIds: [NOCHARGE_STATUS], nonBilledEmploymentStatusIds: [NOCHARGE_STATUS] },
      NOCHARGE_STATUS,
    ),
  );
  check(
    "isStatusBilled: empty billed list bills all non-excluded",
    isStatusBilled({ nonBilledEmploymentStatusIds: [NOCHARGE_STATUS] }, BILLED_STATUS),
  );
  check(
    "isStatusBilled: non-empty billed list restricts",
    !isStatusBilled({ billedEmploymentStatusIds: ["other"] }, BILLED_STATUS),
  );

  // --- no rate: no charge ---
  rateRows = [];
  entries = [];
  let res = await baoHourlyChargePlugin.execute(hoursCtx(), config);
  check("no rate row => success, no transactions", res.success && res.transactions.length === 0);

  // --- effective-date selection ---
  rateRows = [
    { id: "r1", employerId: EMPLOYER, accountId: ACCOUNT, rate: "1.5000", effectiveYmd: "2026-01-01" },
    { id: "r2", employerId: EMPLOYER, accountId: ACCOUNT, rate: "2.0000", effectiveYmd: "2026-06-01" },
    { id: "r3", employerId: EMPLOYER, accountId: ACCOUNT, rate: "9.0000", effectiveYmd: "2026-07-01" },
  ];
  res = await baoHourlyChargePlugin.execute(hoursCtx(), config);
  check("charge created for billed status", res.success && res.transactions.length === 1);
  const tx = res.transactions[0];
  check("rate picked as of work date (2026-06-01 rate 2.0)", tx?.amount === "200.00");
  check("statement_ymd anchored to work month", tx?.statementYmd === "2026-06-01");
  check("future rate (2026-07-01) not used", (tx?.metadata as any)?.rateId === "r2");
  persist(res.transactions);

  // --- idempotent re-run ---
  res = await baoHourlyChargePlugin.execute(hoursCtx(), config);
  check("re-run with same inputs creates nothing", res.success && res.transactions.length === 0);
  check("still exactly one entry", entries.length === 1);

  // --- hours changed => single adjustment reconciling net total ---
  res = await baoHourlyChargePlugin.execute(hoursCtx({ hours: 120 }), config);
  check("hours change creates one adjustment", res.transactions.length === 1);
  check("adjustment amount is delta (+40.00)", res.transactions[0]?.amount === "40.00");
  check("adjustment referenceType", res.transactions[0]?.referenceType === "hour_adjustment");
  persist(res.transactions);

  // re-run after adjustment: net total now matches
  res = await baoHourlyChargePlugin.execute(hoursCtx({ hours: 120 }), config);
  check("re-run after adjustment creates nothing", res.transactions.length === 0);

  // --- non-billed status => existing entries deleted ---
  res = await baoHourlyChargePlugin.execute(
    hoursCtx({ hours: 120, employmentStatusId: NOCHARGE_STATUS }),
    config,
  );
  check("non-billed status deletes existing entries", res.success && entries.length === 0);
  check("delete emits notification", res.notifications?.[0]?.type === "deleted");

  // --- non-billed status with no entries: nothing happens ---
  res = await baoHourlyChargePlugin.execute(
    hoursCtx({ employmentStatusId: NOCHARGE_STATUS }),
    config,
  );
  check("non-billed status with no entries => no-op", res.success && res.transactions.length === 0);

  // --- zero rate => no charge ---
  rateRows = [
    { id: "rz", employerId: EMPLOYER, accountId: ACCOUNT, rate: "0.0000", effectiveYmd: "2026-01-01" },
  ];
  res = await baoHourlyChargePlugin.execute(hoursCtx(), config);
  check("zero rate => no charge", res.success && res.transactions.length === 0);

  // --- billed list restricts ---
  rateRows = [
    { id: "r1", employerId: EMPLOYER, accountId: ACCOUNT, rate: "2.0000", effectiveYmd: "2026-01-01" },
  ];
  const restrictedConfig = {
    ...config,
    id: "cfg-2",
    settings: { billedEmploymentStatusIds: ["some-other-status"] },
  };
  res = await baoHourlyChargePlugin.execute(hoursCtx({ hoursId: "hours-2" }), restrictedConfig);
  check("status outside billed list => no charge", res.success && res.transactions.length === 0);

  // --- zero hours => no charge ---
  res = await baoHourlyChargePlugin.execute(hoursCtx({ hoursId: "hours-3", hours: 0 }), config);
  check("zero hours => no charge", res.success && res.transactions.length === 0);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
