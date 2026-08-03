/**
 * Standalone smoke test for the subscriber-only BAO premium charge plugin.
 *
 * Stubs the storage singleton (no DB) and drives the plugin's execute()
 * through the required scenarios:
 *   1. Dependent WMB save never creates its own charge (charge keyed to subscriber).
 *   2. Subscriber tier moves 1 → 2 → 3+ and back as dependent WMBs come and go.
 *   3. Orphan-dependent state: charge created for a subscriber with no own WMB,
 *      flagged in metadata + description; deleting the last dependent removes it.
 *   4. Subscriber WMB delete with dependents → orphan charge; without → delete.
 *   5. Idempotent re-runs don't duplicate or churn entries.
 *
 * Run: npx tsx scripts/oneoffs/smoke-bao-premium-subscriber-only.ts
 */
import { storage } from "../../server/storage/database";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-premium";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import { TriggerType } from "../../server/plugins/ledger/charge/types";

const SUB = "worker-sub";
const DEP1 = "worker-dep1";
const DEP2 = "worker-dep2";
const REL1 = "rel-1";
const REL2 = "rel-2";
const BENEFIT = "benefit-1";
const CONFIG = { id: "cfg-1", account: "acct-1" };
const YEAR = 2026;
const MONTH = 7;

// ---- mutable "database" state ----
type CovRow = { id: string; workerId: string; sourceRelationId: string | null };
let wmbRows: CovRow[] = [];
let existingEntry: any = null;
let legacyDepEntry: any = null; // legacy charge keyed to the DEPENDENT worker
let legacySwept = false;
const log: string[] = [];

const s = storage as any;
s.trustBenefits = {
  getTrustBenefit: async () => ({ id: BENEFIT, name: "Kaiser", providerId: "prov-1" }),
};
s.baoPremiumRates = {
  tableExists: async () => true,
  getEffectiveRate: async (_b: string, tier: string) => ({
    rate: tier === "3+" ? "300.00" : tier === "2" ? "200.00" : "100.00",
    effectiveYmd: "2026-01-01",
  }),
};
s.baoPremiumFiles = {
  isMonthSwept: async () => legacySwept,
};
s.ledger = {
  ea: { getOrCreate: async () => ({ id: "ea-1" }) },
  entries: {
    getByChargePluginKey: async (_plugin: string, key: string) => {
      if (legacyDepEntry && key === legacyDepEntry.chargePluginKey) return legacyDepEntry;
      if (existingEntry && key === existingEntry.chargePluginKey) return existingEntry;
      return undefined;
    },
    deleteByChargePluginKey: async (_plugin: string, key: string) => {
      if (legacyDepEntry && key === legacyDepEntry.chargePluginKey) {
        log.push("delete-legacy");
        legacyDepEntry = null;
        return true;
      }
      log.push("delete");
      existingEntry = null;
      return true;
    },
    update: async (_id: string, patch: any) => {
      log.push("update");
      existingEntry = {
        ...existingEntry,
        amount: patch.amount,
        memo: patch.memo,
        referenceId: patch.referenceId,
        data: patch.data,
      };
    },
  },
};
s.workers = { getWorker: async () => ({ id: SUB, contactId: "c1" }) };
s.contacts = { getContact: async () => ({ displayName: "Sub Scriber" }) };
s.workerRelations = {
  get: async (id: string) =>
    id === REL1
      ? { id: REL1, worker1: SUB, worker2: DEP1 }
      : id === REL2
        ? { id: REL2, worker1: SUB, worker2: DEP2 }
        : undefined,
};
s.trust = {
  wmb: {
    getPremiumCoverage: async (subscriberWorkerId: string) => {
      if (subscriberWorkerId !== SUB) {
        return { ownWmbId: null, dependentWmbIds: [], employerId: null };
      }
      const own = wmbRows.find((r) => r.workerId === SUB && !r.sourceRelationId);
      const deps = wmbRows.filter((r) => r.sourceRelationId);
      return {
        ownWmbId: own?.id ?? null,
        dependentWmbIds: deps.map((d) => d.id),
        employerId: "emp-1",
      };
    },
  },
};

const plugin = getChargePlugin("sitespecific-bao-premium")!;

async function fire(row: CovRow, isDeleted = false) {
  const result = await plugin.execute(
    {
      trigger: TriggerType.WMB_SAVED,
      wmbId: row.id,
      workerId: row.workerId,
      employerId: "emp-1",
      benefitId: BENEFIT,
      year: YEAR,
      month: MONTH,
      sourceRelationId: row.sourceRelationId,
      isDeleted,
    } as any,
    CONFIG,
  );
  if (!result.success) throw new Error(`plugin failed: ${result.error}`);
  // Simulate the executor persisting returned transactions.
  for (const tx of result.transactions) {
    existingEntry = {
      id: "entry-1",
      eaId: "ea-1",
      amount: tx.amount,
      memo: tx.description,
      referenceId: tx.referenceId,
      chargePluginKey: tx.chargePluginKey,
      data: tx.metadata,
    };
    log.push("create");
  }
  return result;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: any) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}`, detail ?? "");
  }
}

(async () => {
  // 1. Subscriber saves own WMB → tier 1 charge keyed to subscriber.
  const ownRow: CovRow = { id: "wmb-own", workerId: SUB, sourceRelationId: null };
  wmbRows = [ownRow];
  await fire(ownRow);
  check("subscriber save creates tier-1 charge", existingEntry?.amount === "100.00");
  check(
    "charge keyed to subscriber",
    existingEntry?.chargePluginKey === `${CONFIG.id}:${SUB}:${BENEFIT}:${YEAR}:${MONTH}`,
  );

  // 2. Dependent WMB save → no own charge, subscriber tier steps to 2.
  const dep1Row: CovRow = { id: "wmb-dep1", workerId: DEP1, sourceRelationId: REL1 };
  wmbRows.push(dep1Row);
  await fire(dep1Row);
  check("dependent save updates subscriber charge to tier 2", existingEntry?.amount === "200.00");
  check(
    "no dependent-keyed charge",
    existingEntry?.chargePluginKey.includes(SUB) && !existingEntry?.chargePluginKey.includes(DEP1),
  );
  check("tier 2 metadata", existingEntry?.data?.coverageTier === "2" && existingEntry?.data?.dependentWmbCount === 1);

  // 3. Second dependent → tier 3+.
  const dep2Row: CovRow = { id: "wmb-dep2", workerId: DEP2, sourceRelationId: REL2 };
  wmbRows.push(dep2Row);
  await fire(dep2Row);
  check("second dependent moves tier to 3+", existingEntry?.amount === "300.00" && existingEntry?.data?.coverageTier === "3+");

  // 4. Idempotent re-run: no change.
  const before = log.length;
  const rerun = await fire(dep2Row);
  check(
    "idempotent re-run is a no-op",
    log.length === before && /already matches/i.test(rerun.message ?? ""),
    rerun.message,
  );

  // 5. Delete a dependent → tier steps back down to 2.
  wmbRows = wmbRows.filter((r) => r.id !== dep2Row.id);
  await fire(dep2Row, true);
  check("dependent delete steps tier down", existingEntry?.amount === "200.00");

  // 6. Delete subscriber's own WMB while a dependent remains → orphan charge, not deletion.
  wmbRows = wmbRows.filter((r) => r.id !== ownRow.id);
  await fire(ownRow, true);
  check("subscriber delete with dependents keeps charge (orphan)", existingEntry !== null);
  check("orphan flagged in metadata", existingEntry?.data?.orphanSubscriberWmb === true);
  check("orphan flagged in description", /NO SUBSCRIBER WMB/.test(existingEntry?.memo ?? ""), existingEntry?.memo);
  check("orphan tier still counts subscriber (tier 2)", existingEntry?.amount === "200.00");
  check("orphan entry anchored on dependent row", existingEntry?.referenceId === dep1Row.id);

  // 7. Delete the last dependent → charge removed entirely.
  wmbRows = [];
  await fire(dep1Row, true);
  check("last dependent delete removes charge", existingEntry === null);

  // 8. Fresh orphan creation: dependent saved with no subscriber row at all.
  wmbRows = [dep1Row];
  await fire(dep1Row);
  check(
    "orphan-dependent save creates flagged subscriber charge",
    existingEntry?.data?.orphanSubscriberWmb === true &&
      existingEntry?.chargePluginKey === `${CONFIG.id}:${SUB}:${BENEFIT}:${YEAR}:${MONTH}`,
  );

  // 9. Subscriber delete with no dependents (from tier-1-only state) → delete.
  wmbRows = [ownRow];
  existingEntry = null;
  await fire(ownRow); // create
  wmbRows = [];
  await fire(ownRow, true);
  check("subscriber delete without dependents removes charge", existingEntry === null);

  // 10. Legacy dependent-keyed entry (pre-rework) is self-healed on a
  // dependent event: deleted when unswept, left alone when already swept.
  wmbRows = [ownRow, dep1Row];
  existingEntry = null;
  legacyDepEntry = {
    id: "legacy-1",
    eaId: "ea-1",
    amount: "100.00",
    memo: "old",
    chargePluginKey: `${CONFIG.id}:${DEP1}:${BENEFIT}:${YEAR}:${MONTH}`,
    data: {},
  };
  legacySwept = false;
  await fire(dep1Row);
  check("unswept legacy dependent-keyed entry deleted", legacyDepEntry === null);
  check(
    "subscriber charge created alongside legacy cleanup",
    existingEntry?.chargePluginKey === `${CONFIG.id}:${SUB}:${BENEFIT}:${YEAR}:${MONTH}` &&
      existingEntry?.amount === "200.00",
  );

  legacyDepEntry = {
    id: "legacy-2",
    eaId: "ea-1",
    amount: "100.00",
    memo: "old",
    chargePluginKey: `${CONFIG.id}:${DEP1}:${BENEFIT}:${YEAR}:${MONTH}`,
    data: {},
  };
  legacySwept = true;
  const sweptResult = await fire(dep1Row);
  check("swept legacy entry preserved for manual review", legacyDepEntry !== null);
  check(
    "swept legacy month skips subscriber recompute",
    sweptResult.transactions.length === 0 && /manual review/i.test(sweptResult.message ?? ""),
    sweptResult.message,
  );

  // Regression: starting from ONLY a swept legacy dependent entry (no
  // subscriber entry at all), a dependent event must not create a new
  // subscriber charge — that would re-bill an already-settled month.
  existingEntry = null;
  legacyDepEntry = {
    id: "legacy-3",
    eaId: "ea-1",
    amount: "100.00",
    memo: "old",
    chargePluginKey: `${CONFIG.id}:${DEP1}:${BENEFIT}:${YEAR}:${MONTH}`,
    data: {},
  };
  legacySwept = true;
  await fire(dep1Row);
  check(
    "no subscriber charge created for a swept legacy month",
    existingEntry === null && legacyDepEntry !== null,
  );
  legacySwept = false;
  legacyDepEntry = null;
  // Recreate baseline subscriber entry for the metadata-drift case below.
  await fire(dep1Row);

  // 11. Metadata drift alone (same amount/memo/reference) triggers an update.
  existingEntry.data = { ...existingEntry.data, coverageTier: "9" };
  const before2 = log.length;
  await fire(dep1Row);
  check(
    "stale metadata refreshed even when amount/memo match",
    existingEntry?.data?.coverageTier === "2" && log[log.length - 1] === "update" && log.length === before2 + 1,
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})();
