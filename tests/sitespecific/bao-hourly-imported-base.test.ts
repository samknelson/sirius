/**
 * BAO Hourly — migrated S1 history as the billing baseline (Task 414).
 *
 * S1-imported hours charges land as ledger rows with chargePlugin
 * 's1-import' and, once linked by the migration crosswalk, referenceType
 * 'hour' pointing at the S2 monthly worker_hours row. The plugin must treat
 * those rows as the historical base for the same hours row + billed employer
 * account (eaId):
 *   - saving UNCHANGED migrated hours creates no new charge
 *   - CHANGING the hours creates only the net delta adjustment vs the
 *     imported base (plus any prior adjustments)
 *   - a month already duplicated (imported base + post-migration native
 *     full base) reconciles to the expected net with ONE correcting
 *     adjustment, and reruns move no further money
 *   - imported history billed to a DIFFERENT account never suppresses a
 *     legitimate full base
 *   - verifyEntry counts linked imported history in the posted total
 *
 * All storage stubbed in-memory (pattern: bao-dp-billing.test.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";

// Import order matters: initialize the storage module graph BEFORE the plugin.
import { storage } from "../../server/storage/database";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-hourly";
import { __setDcFundEmployerCache } from "../../server/services/sitespecific/bao/dc-grant";
import {
  TriggerType,
  type HoursSavedContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";

interface StoredEntry {
  id: string;
  chargePlugin: string;
  chargePluginKey: string;
  chargePluginConfigId: string | null;
  eaId: string;
  amount: string;
  referenceType: string;
  referenceId: string;
  data: Record<string, any> | null;
}

let entries: StoredEntry[] = [];
let nextEntryId = 1;

const WORKER = "worker-1";
const EMPLOYER = "employer-sls";
const HOURS_ID = "hours-2026-04";
const ACCOUNT = "acct-hf";
const CONFIG_ID = "cfg-bao-hourly";
const eaIdFor = (entityId: string, accountId: string) => `ea-employer-${entityId}-${accountId}`;
const EA_ID = eaIdFor(EMPLOYER, ACCOUNT);

(storage as any).ledger = {
  ea: {
    async getOrCreate(entityType: string, entityId: string, accountId: string) {
      return { id: `ea-${entityType}-${entityId}-${accountId}` };
    },
  },
  entries: {
    async getByChargePluginKey(chargePlugin: string, key: string) {
      return (
        entries.find(
          (e) => e.chargePlugin === chargePlugin && e.chargePluginKey === key,
        ) ?? null
      );
    },
    async getByReferenceAndConfig(referenceId: string, configId: string) {
      return entries.filter(
        (e) => e.referenceId === referenceId && e.chargePluginConfigId === configId,
      );
    },
    async getByReference(referenceType: string, referenceId: string) {
      return entries.filter(
        (e) => e.referenceType === referenceType && e.referenceId === referenceId,
      );
    },
    async delete(id: string) {
      entries = entries.filter((e) => e.id !== id);
    },
  },
};
(storage as any).baoEmployerRates = {
  async getEffectiveRate(_employerId: string, _accountId: string, _asOfYmd: string) {
    return { id: "rate-1", rate: "4.00", effectiveYmd: "2020-01-01" };
  },
};
(storage as any).workers = {
  async getWorker() {
    return null; // memo decoration only — soft-fail path
  },
};

function persist(transactions: LedgerTransaction[]) {
  for (const t of transactions) {
    entries.push({
      id: `e${nextEntryId++}`,
      chargePlugin: t.chargePlugin,
      chargePluginKey: t.chargePluginKey,
      chargePluginConfigId: t.chargePluginConfigId,
      eaId: eaIdFor(t.entityId, t.accountId),
      amount: t.amount,
      referenceType: t.referenceType || "charge_plugin",
      referenceId: t.referenceId!,
      data: t.metadata ?? null,
    });
  }
}

function addImported(amount: string, opts?: { eaId?: string; referenceType?: string }) {
  const e: StoredEntry = {
    id: `imp${nextEntryId++}`,
    chargePlugin: "s1-import",
    chargePluginKey: `ar-${9000 + nextEntryId}`,
    chargePluginConfigId: null,
    eaId: opts?.eaId ?? EA_ID,
    amount,
    referenceType: opts?.referenceType ?? "hour",
    referenceId: HOURS_ID,
    data: { s1ReferenceNid: 555, source: "s1-import" },
  };
  entries.push(e);
  return e;
}

const plugin = getChargePlugin("bao-hourly")!;
const config: any = {
  id: CONFIG_ID,
  pluginId: "bao-hourly",
  enabled: true,
  scope: "global",
  employerId: null,
  account: ACCOUNT,
  settings: {},
};

function ctx(hours: number): HoursSavedContext {
  return {
    trigger: TriggerType.HOURS_SAVED,
    hoursId: HOURS_ID,
    workerId: WORKER,
    employerId: EMPLOYER,
    year: 2026,
    month: 4,
    day: 1,
    hours,
    employmentStatusId: "status-active",
    home: false,
  };
}

async function run(hours: number) {
  const result = await plugin.execute(ctx(hours), config);
  if (!result.success) throw new Error(`plugin failed: ${result.error}`);
  persist(result.transactions);
  return result;
}

function netTotalForEa(): number {
  return Number(
    entries
      .filter((e) => e.eaId === EA_ID && e.referenceId === HOURS_ID)
      .reduce((s, e) => s + parseFloat(e.amount), 0)
      .toFixed(2),
  );
}

beforeEach(() => {
  entries = [];
  nextEntryId = 1;
  __setDcFundEmployerCache(null); // no DC pseudo-employer in these scenarios
});

describe("imported S1 history as billing base", () => {
  it("creates a full base when neither native nor imported base exists", async () => {
    const r = await run(100);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].referenceType).toBe("hour");
    expect(r.transactions[0].amount).toBe("400.00");
  });

  it("unchanged historical save: linked imported base, no new charge", async () => {
    addImported("400.00"); // 100 hrs @ $4 imported from S1
    const r = await run(100);
    expect(r.transactions).toHaveLength(0);
    expect(netTotalForEa()).toBe(400.0);
  });

  it("changed historical save: only the net delta adjustment vs the imported base", async () => {
    const imported = addImported("400.00");
    const r = await run(120); // expected 480 → +80 delta
    expect(r.transactions).toHaveLength(1);
    const t = r.transactions[0];
    expect(t.referenceType).toBe("hour_adjustment");
    expect(t.amount).toBe("80.00");
    expect(t.metadata?.baseSource).toBe("s1-import");
    expect(t.metadata?.originalEntryId).toBe(imported.id);
    expect(t.metadata?.importedBaseIds).toEqual([imported.id]);
    expect(netTotalForEa()).toBe(480.0);
    // rerun: idempotent
    const r2 = await run(120);
    expect(r2.transactions).toHaveLength(0);
  });

  it("multi-entry imported history sums into the base (multi-pay-period month)", async () => {
    addImported("250.00");
    addImported("150.00");
    const r = await run(100); // expected 400 == 250 + 150
    expect(r.transactions).toHaveLength(0);
  });

  it("already-duplicated month: one correcting adjustment, reruns move no money", async () => {
    addImported("400.00");
    // simulate the pre-fix duplicate: a native full base was created on save
    persist([
      {
        chargePlugin: "bao-hourly",
        chargePluginKey: `${CONFIG_ID}:${EA_ID}:${HOURS_ID}`,
        chargePluginConfigId: CONFIG_ID,
        accountId: ACCOUNT,
        entityType: "employer",
        entityId: EMPLOYER,
        amount: "400.00",
        description: "dup base",
        transactionDate: new Date(2026, 3, 1),
        statementYmd: "2026-04-01",
        referenceType: "hour",
        referenceId: HOURS_ID,
        metadata: {},
      } as any,
    ]);
    expect(netTotalForEa()).toBe(800.0);

    const r = await run(100); // expected 400 → single -400 correction
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe("-400.00");
    expect(r.transactions[0].referenceType).toBe("hour_adjustment");
    expect(netTotalForEa()).toBe(400.0);
    // imported base preserved — history is corrected, never deleted
    expect(entries.some((e) => e.chargePlugin === "s1-import")).toBe(true);
    expect(
      entries.filter((e) => e.chargePlugin === "bao-hourly" && e.referenceType === "hour"),
    ).toHaveLength(1); // still exactly one native full charge

    const r2 = await run(100);
    expect(r2.transactions).toHaveLength(0); // rerun: no further money movement
  });

  it("imported history on a different billed account never suppresses the base", async () => {
    addImported("400.00", { eaId: eaIdFor(EMPLOYER, "acct-other") });
    const r = await run(100);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].referenceType).toBe("hour");
    expect(r.transactions[0].amount).toBe("400.00");
  });

  it("unlinked (s1-unknown) imported rows do not count as a base", async () => {
    addImported("400.00", { referenceType: "s1-unknown" });
    const r = await run(100);
    expect(r.transactions).toHaveLength(1); // full base — nothing linked yet
    expect(r.transactions[0].referenceType).toBe("hour");
  });

  it("zeroed hours: imported base preserved, one offset adjustment to net $0, rerun no-op", async () => {
    const imported = addImported("400.00");
    const r = await run(0); // no charge applies
    expect(r.transactions).toHaveLength(1);
    const t = r.transactions[0];
    expect(t.referenceType).toBe("hour_adjustment");
    expect(t.amount).toBe("-400.00");
    expect(t.metadata?.adjustmentType).toBe("no_longer_qualifying");
    expect(t.metadata?.baseSource).toBe("s1-import");
    expect(netTotalForEa()).toBe(0.0);
    expect(entries.some((e) => e.id === imported.id)).toBe(true); // never deleted
    const r2 = await run(0);
    expect(r2.transactions).toHaveLength(0); // idempotent
  });

  it("newly non-billed status: imported base offset to $0, not deleted", async () => {
    addImported("400.00");
    const nonBilledConfig = {
      ...config,
      settings: { nonBilledEmploymentStatusIds: ["status-active"] },
    };
    const result = await plugin.execute(ctx(100), nonBilledConfig);
    expect(result.success).toBe(true);
    persist(result.transactions);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe("-400.00");
    expect(netTotalForEa()).toBe(0.0);
    expect(entries.some((e) => e.chargePlugin === "s1-import")).toBe(true);
  });

  it("no effective rate: imported base offset to $0", async () => {
    addImported("400.00");
    (storage as any).baoEmployerRates.getEffectiveRate = async () => null;
    try {
      const r = await run(100);
      expect(r.transactions).toHaveLength(1);
      expect(r.transactions[0].amount).toBe("-400.00");
      expect(netTotalForEa()).toBe(0.0);
    } finally {
      (storage as any).baoEmployerRates.getEffectiveRate = async () => ({
        id: "rate-1",
        rate: "4.00",
        effectiveYmd: "2020-01-01",
      });
    }
  });

  it("no imported history + no charge: still a plain no-op (no phantom offset)", async () => {
    const r = await run(0);
    expect(r.transactions).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });

  it("imported+native duplicate that becomes non-billable: native rows deleted, imported offset, rerun no-op", async () => {
    addImported("400.00");
    persist([
      {
        chargePlugin: "bao-hourly",
        chargePluginKey: `${CONFIG_ID}:${EA_ID}:${HOURS_ID}`,
        chargePluginConfigId: CONFIG_ID,
        accountId: ACCOUNT,
        entityType: "employer",
        entityId: EMPLOYER,
        amount: "400.00",
        description: "dup base",
        transactionDate: new Date(2026, 3, 1),
        statementYmd: "2026-04-01",
        referenceType: "hour",
        referenceId: HOURS_ID,
        metadata: {},
      } as any,
    ]);
    const r = await run(0);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].amount).toBe("-400.00"); // offsets the imported fact only
    // native base gone, imported preserved, net $0
    expect(entries.filter((e) => e.chargePlugin === "bao-hourly" && e.referenceType === "hour")).toHaveLength(0);
    expect(entries.some((e) => e.chargePlugin === "s1-import")).toBe(true);
    expect(netTotalForEa()).toBe(0.0);
    const r2 = await run(0);
    expect(r2.transactions).toHaveLength(0);
  });

  it("hours restored after an offset: delta adjustment rebuilds the charge from the offset net", async () => {
    addImported("400.00");
    await run(0); // posts -400 offset
    const r = await run(100); // expected 400, net currently 0 → +400 delta
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].referenceType).toBe("hour_adjustment");
    expect(r.transactions[0].amount).toBe("400.00");
    expect(netTotalForEa()).toBe(400.0);
  });

  it("repair persistence maps the correction to the work month, not the run date", async () => {
    const { toRepairLedgerInsert } = await import(
      "../../scripts/s1-migration/lib/repair-hour-links-persist"
    );
    // Real duplicate-month reconcile output (imported 400 + native 400 → -400)
    addImported("400.00");
    persist([
      {
        chargePlugin: "bao-hourly",
        chargePluginKey: `${CONFIG_ID}:${EA_ID}:${HOURS_ID}`,
        chargePluginConfigId: CONFIG_ID,
        accountId: ACCOUNT,
        entityType: "employer",
        entityId: EMPLOYER,
        amount: "400.00",
        description: "dup base",
        transactionDate: new Date(2026, 3, 1),
        statementYmd: "2026-04-01",
        referenceType: "hour",
        referenceId: HOURS_ID,
        metadata: {},
      } as any,
    ]);
    const result = await plugin.execute(ctx(100), config);
    expect(result.success).toBe(true);
    expect(result.transactions).toHaveLength(1);
    const insert = toRepairLedgerInsert(result.transactions[0], EA_ID);
    // ledger date AND statement month = the affected work month (April 2026)
    expect(insert.date).toEqual(new Date(2026, 3, 1));
    expect(insert.statementYmd).toBe("2026-04-01");
    expect(insert.amount).toBe("-400.00");
    expect(insert.eaId).toBe(EA_ID);
    expect((insert.data as any).repairSource).toBe("repair-hour-links");
    // a transaction missing its statement month is refused, never defaulted
    expect(() =>
      toRepairLedgerInsert({ ...result.transactions[0], statementYmd: undefined } as any, EA_ID),
    ).toThrow(/statementYmd/);
  });

  it("verifyEntry counts linked imported history in the posted total", async () => {
    addImported("400.00");
    await run(120); // posts the +80 adjustment
    const adj = entries.find((e) => e.referenceType === "hour_adjustment")!;
    // verify against the ADJUSTMENT's data (has worker/employer/hours meta);
    // build a native-base-shaped entry for the verify call
    const verification = await (plugin as any).verifyEntry(
      {
        id: adj.id,
        chargePlugin: "bao-hourly",
        chargePluginKey: `${CONFIG_ID}:${EA_ID}:${HOURS_ID}`,
        eaId: EA_ID,
        amount: adj.amount,
        memo: "",
        referenceType: "hour",
        referenceId: HOURS_ID,
        date: new Date(2026, 3, 1),
        data: { workerId: WORKER, employerId: EMPLOYER, year: 2026, month: 4, day: 1, hours: 120 },
      },
      config,
    );
    expect(verification.isValid).toBe(true); // 400 imported + 80 adj == 480 expected
  });
});
