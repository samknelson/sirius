/**
 * Smoke test for the BAO withholding two-phase flow (task: allocate on payment).
 *
 * Verifies, with all storage stubbed in-memory (no real DB access):
 *   - upload-source payment validation: exact-match required, over/under
 *     rejected, ineligible/consumed uploads rejected, employer-EA only,
 *     proposedAllocation combination rejected, missing plugin config rejected
 *   - cleared payment with upload sources: uploads consumed + one entry per
 *     worker allocation (negative amount, stable idempotent key)
 *   - re-run idempotency (no duplicate transactions)
 *   - void/edit away from cleared: entries reversed, uploads released
 *   - double consumption blocked (UPLOAD_ALREADY_CONSUMED surfaces as failure)
 *   - paymentSimpleAllocation suppressed for upload-source payments
 *
 * Run: npx tsx scripts/oneoffs/smoke-bao-withholding-allocation.ts
 */

// Import order matters: initialize the storage module graph the same way the
// app boots, BEFORE importing the plugins (avoids a circular-init crash).
import { storage } from "../../server/storage/database";
import {
  UPLOAD_ALREADY_CONSUMED,
  type BaoWithholdingAllocation,
} from "../../server/storage/sitespecific/bao/withholding-allocations";
import "../../server/plugins/ledger/charge/plugins/sitespecific-bao-er-report-to-ee-allocation";
import { getChargePlugin } from "../../server/plugins/ledger/charge/registry";
import { TriggerType, type PaymentSavedContext, type LedgerTransaction } from "../../server/plugins/ledger/charge/types";
import { validateBaoUploadSource } from "../../server/modules/ledger/payments";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` :: ${JSON.stringify(extra)}`}`);
  if (!ok) failures++;
}

// ---------- In-memory stubs ----------

let allocations: BaoWithholdingAllocation[] = [];

interface StoredEntry {
  id: string;
  chargePlugin: string;
  chargePluginKey: string | null;
  chargePluginConfigId: string;
  amount: string;
  eaId: string;
  referenceType: string;
  referenceId: string;
  statementYmd?: string;
  memo?: string | null;
  data: Record<string, any> | null;
}
let entries: StoredEntry[] = [];
let entrySeq = 0;

const ACCOUNT = "acct-1";
const EMPLOYER = "emp-1";
const EMPLOYER_EA = { id: "ea-emp", accountId: ACCOUNT, entityType: "employer", entityId: EMPLOYER };

function seedUpload(wizardId: string, month: number, rows: Array<[string, string]>) {
  for (const [workerId, amount] of rows) {
    allocations.push({
      id: `alloc-${wizardId}-${workerId}`,
      wizardId,
      employerId: EMPLOYER,
      year: 2026,
      month,
      workerId,
      workerEaId: `ea-${workerId}`,
      amount,
      consumedByPaymentId: null,
      data: null,
    } as BaoWithholdingAllocation);
  }
}

function uploadSummaries(includePaymentId?: string) {
  const byWizard = new Map<string, BaoWithholdingAllocation[]>();
  for (const a of allocations) {
    byWizard.set(a.wizardId, [...(byWizard.get(a.wizardId) || []), a]);
  }
  return [...byWizard.entries()]
    .filter(([, rows]) => {
      const consumed = rows.find((r) => r.consumedByPaymentId)?.consumedByPaymentId ?? null;
      return !consumed || consumed === includePaymentId;
    })
    .map(([wizardId, rows]) => ({
      wizardId,
      year: rows[0].year,
      month: rows[0].month,
      totalAmount: rows.reduce((s, r) => s + parseFloat(r.amount), 0).toFixed(2),
      allocationCount: rows.length,
      consumedByPaymentId: rows.find((r) => r.consumedByPaymentId)?.consumedByPaymentId ?? null,
    }));
}

// Stub the allocation storage on the singleton.
(storage as any).baoWithholdingAllocations = {
  tableExists: async () => true,
  getByWizard: async (wizardId: string) => allocations.filter((a) => a.wizardId === wizardId),
  getByWizards: async (wizardIds: string[]) => allocations.filter((a) => wizardIds.includes(a.wizardId)),
  getByConsumingPayment: async (paymentId: string) => allocations.filter((a) => a.consumedByPaymentId === paymentId),
  getConsumingPaymentId: async (wizardId: string) =>
    allocations.find((a) => a.wizardId === wizardId && a.consumedByPaymentId)?.consumedByPaymentId ?? null,
  listEligibleUploads: async (opts: { includePaymentId?: string }) => uploadSummaries(opts.includePaymentId),
  consume: async (wizardIds: string[], paymentId: string) => {
    for (const a of allocations) {
      if (wizardIds.includes(a.wizardId) && a.consumedByPaymentId && a.consumedByPaymentId !== paymentId) {
        throw new Error(UPLOAD_ALREADY_CONSUMED);
      }
    }
    for (const a of allocations) {
      if (wizardIds.includes(a.wizardId)) a.consumedByPaymentId = paymentId;
      else if (a.consumedByPaymentId === paymentId) a.consumedByPaymentId = null;
    }
    return allocations.filter((a) => wizardIds.includes(a.wizardId));
  },
  release: async (paymentId: string) => {
    for (const a of allocations) {
      if (a.consumedByPaymentId === paymentId) a.consumedByPaymentId = null;
    }
  },
};

(storage as any).ledger = {
  ...(storage as any).ledger,
  entries: {
    getByReferenceAndConfig: async (referenceId: string, configId: string) =>
      entries.filter((e) => e.referenceId === referenceId && e.chargePluginConfigId === configId),
    getByReference: async (referenceType: string, referenceId: string) =>
      entries.filter((e) => e.referenceType === referenceType && e.referenceId === referenceId),
    delete: async (id: string) => {
      entries = entries.filter((e) => e.id !== id);
    },
    create: async (input: any) => {
      const entry: StoredEntry = { id: `entry-${++entrySeq}`, ...input };
      entries.push(entry);
      return entry;
    },
  },
  ea: {
    get: async (id: string) => (id === EMPLOYER_EA.id ? EMPLOYER_EA : null),
    getOrCreate: async (entityType: string, entityId: string, accountId: string) => ({
      id: `ea-${entityId}`,
      entityType,
      entityId,
      accountId,
    }),
  },
  payments: (storage as any).ledger?.payments,
};

// Envelope shape matches the real generic search: { config, subsidiary }.
const makeConfigEnv = (id: string, scope: string, account: string, employerId: string | null = null) => ({
  config: {
    id,
    pluginId: "bao-er-report-to-ee-allocation",
    name: "BAO ER report to EE Allocation",
    enabled: true,
    data: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  subsidiary: { scope, employerId, account },
});
let pluginConfigEnvs: any[] = [makeConfigEnv("cfg-1", "global", ACCOUNT)];
(storage as any).pluginConfigs = {
  search: async (_kind: string, filters: { pluginId?: string; scope?: string }) => {
    if (filters.pluginId !== "bao-er-report-to-ee-allocation") return [];
    if (filters.scope) return pluginConfigEnvs.filter((e) => e.subsidiary.scope === filters.scope);
    return pluginConfigEnvs;
  },
};

// ---------- Fixtures ----------

seedUpload("wiz-jan", 1, [["w1", "10.00"], ["w2", "20.00"]]); // total 30.00
seedUpload("wiz-feb", 2, [["w1", "15.50"]]); // total 15.50

const plugin = getChargePlugin("bao-er-report-to-ee-allocation")!;
const config = { id: "cfg-1", account: ACCOUNT };

function paymentContext(overrides: Partial<PaymentSavedContext>): PaymentSavedContext {
  return {
    trigger: TriggerType.PAYMENT_SAVED,
    accountId: ACCOUNT,
    entityType: "employer",
    entityId: EMPLOYER,
    paymentId: "pay-1",
    eaId: EMPLOYER_EA.id,
    amount: "30.00",
    status: "cleared",
    dateReceived: new Date("2026-02-01T00:00:00Z"),
    dateCleared: new Date("2026-02-01T00:00:00Z"),
    memo: null,
    paymentTypeId: "pt-1",
    details: { baoUploadSource: { wizardIds: ["wiz-jan"] } },
    ...overrides,
  } as PaymentSavedContext;
}

async function main() {
  check("plugin is registered", !!plugin);

  // ---- Validation ----
  let v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA);
  check("exact match accepted", v.valid, v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "29.00", EMPLOYER_EA);
  check("underpayment rejected", !v.valid && /exactly equal/.test(v.error || ""), v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "31.00", EMPLOYER_EA);
  check("overpayment rejected", !v.valid, v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan", "wiz-feb"] } }, "45.50", EMPLOYER_EA);
  check("multi-upload exact match accepted", v.valid, v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-missing"] } }, "30.00", EMPLOYER_EA);
  check("unknown upload rejected", !v.valid, v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] }, proposedAllocation: [] }, "30.00", EMPLOYER_EA);
  check("combination with proposedAllocation rejected", !v.valid, v);

  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00",
    { ...EMPLOYER_EA, entityType: "worker", entityId: "w1" });
  check("non-employer EA rejected", !v.valid, v);

  pluginConfigEnvs = [];
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA);
  check("missing plugin config rejected", !v.valid && /charge plugin config/.test(v.error || ""), v);

  // Employer-scoped configs never execute on payment dispatches — an
  // account with ONLY an employer-scoped config must reject the payment
  // rather than accept it and silently never credit workers.
  pluginConfigEnvs = [makeConfigEnv("cfg-emp", "employer", ACCOUNT, EMPLOYER)];
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA);
  check("employer-scoped-only config rejected", !v.valid && /global-scope/.test(v.error || ""), v);
  pluginConfigEnvs = [makeConfigEnv("cfg-1", "global", ACCOUNT)];

  v = await validateBaoUploadSource({ merchant: "x" }, "30.00", EMPLOYER_EA);
  check("no marker → valid with no source", v.valid && !v.source);

  // ---- Plugin: cleared payment creates worker entries + consumes uploads ----
  const applyTransactions = async (result: { transactions: LedgerTransaction[] }) => {
    for (const t of result.transactions) {
      await (storage as any).ledger.entries.create({
        chargePlugin: t.chargePlugin,
        chargePluginKey: t.chargePluginKey,
        chargePluginConfigId: t.chargePluginConfigId,
        amount: t.amount,
        eaId: `ea-${t.entityId}`,
        referenceType: t.referenceType,
        referenceId: t.referenceId,
        statementYmd: t.statementYmd,
        memo: t.memo,
        data: t.metadata ?? null,
      });
    }
  };

  let result = await plugin.execute(paymentContext({}), config);
  check("cleared execute succeeds", result.success, result);
  check("one transaction per worker", result.transactions.length === 2, result.transactions);
  check(
    "amounts are negative credits",
    result.transactions.every((t) => parseFloat(t.amount) < 0),
    result.transactions,
  );
  check(
    "stable idempotent keys",
    result.transactions.every((t) => t.chargePluginKey === `cfg-1:pay-1:wiz-jan:${t.entityId}`),
    result.transactions.map((t) => t.chargePluginKey),
  );
  check(
    "statementYmd anchored to work month",
    result.transactions.every((t) => t.statementYmd === "2026-01-01"),
    result.transactions.map((t) => t.statementYmd),
  );
  check(
    "upload consumed by payment",
    allocations.filter((a) => a.wizardId === "wiz-jan").every((a) => a.consumedByPaymentId === "pay-1"),
  );
  await applyTransactions(result);

  // ---- Duplicate global configs: only the canonical config credits ----
  // cfg-1 sorts before cfg-2, so cfg-1 stays canonical; executing with the
  // duplicate must create nothing and leave existing entries untouched.
  pluginConfigEnvs = [makeConfigEnv("cfg-1", "global", ACCOUNT), makeConfigEnv("cfg-2", "global", ACCOUNT)];
  const dupConfig = { id: "cfg-2", account: ACCOUNT, settings: {} };
  const dupResult = await plugin.execute(paymentContext({}), dupConfig);
  check("duplicate config execute is a no-op", dupResult.success && dupResult.transactions.length === 0, dupResult);
  check("duplicate config leaves canonical entries intact", entries.length === 2, entries);
  check(
    "duplicate config does not disturb consumption",
    allocations.filter((a) => a.wizardId === "wiz-jan").every((a) => a.consumedByPaymentId === "pay-1"),
  );
  // Validation still accepts with duplicates present (deterministic pick).
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-feb"] } }, "15.50", EMPLOYER_EA);
  check("duplicate configs still validate deterministically", v.valid, v);
  pluginConfigEnvs = [makeConfigEnv("cfg-1", "global", ACCOUNT)];

  // ---- Async event-bus listener path (production double-dispatch) ----
  // triggerPaymentChargePlugins both executes plugins synchronously AND
  // emits PAYMENT_SAVED; the listener re-runs executeChargePlugins from the
  // emitted payload. The payload's `details` must survive that path or the
  // second run sees "no marker" and reverses the just-created entries.
  const { executeChargePlugins } = await import("../../server/plugins/ledger/charge/executor");
  const listenerPayload = {
    trigger: TriggerType.PAYMENT_SAVED,
    ...paymentContext({}),
  };
  const execResult = await executeChargePlugins(listenerPayload as any, {
    onlyPluginIds: ["bao-er-report-to-ee-allocation"],
  });
  const ours = execResult.executed.find((e) => e.pluginId === "bao-er-report-to-ee-allocation");
  check("listener path executes plugin via config resolution", !!ours && ours.success, execResult.executed);
  check("listener path creates no duplicate transactions", ours?.transactionCount === 0, ours);
  check("entries retained after listener path", entries.length === 2, entries);
  check(
    "consumption retained after listener path",
    allocations.filter((a) => a.wizardId === "wiz-jan").every((a) => a.consumedByPaymentId === "pay-1"),
  );

  // ---- Idempotent re-run ----
  result = await plugin.execute(paymentContext({}), config);
  check("re-run produces no new transactions", result.success && result.transactions.length === 0, result);
  check("entries unchanged after re-run", entries.length === 2);

  // ---- Consumed upload not selectable by another payment ----
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA, "pay-2");
  check("consumed upload rejected for another payment", !v.valid, v);
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA, "pay-1");
  check("consumed upload still valid for its own payment (edit)", v.valid, v);

  // ---- Double consumption blocked at the plugin ----
  result = await plugin.execute(paymentContext({ paymentId: "pay-2" }), config);
  check(
    "double consumption blocked",
    !result.success && /already been consumed/.test(result.error || ""),
    result,
  );
  check("no entries created for losing payment", entries.every((e) => e.referenceId === "pay-1"));

  // ---- Void reverses entries and releases uploads ----
  result = await plugin.execute(paymentContext({ status: "canceled" }), config);
  check("void execute succeeds", result.success, result);
  check("void reverses worker entries", entries.length === 0, entries);
  check(
    "void releases uploads",
    allocations.every((a) => a.consumedByPaymentId === null),
    allocations,
  );

  // ---- After release, another payment can consume ----
  result = await plugin.execute(paymentContext({ paymentId: "pay-2" }), config);
  check("released upload consumable by another payment", result.success && result.transactions.length === 2, result);

  // ---- DELETE payment: worker entries reversed + uploads released ----
  // Uses the same helper the DELETE /api/ledger/payments/:id route calls
  // before removing the payment row.
  await applyTransactions(result); // persist pay-2's entries first
  check("entries exist before delete", entries.filter((e) => e.referenceId === "pay-2").length === 2);
  const { cleanupUploadSourcePaymentArtifacts } = await import("../../server/modules/ledger/payments");
  await cleanupUploadSourcePaymentArtifacts("pay-2", { baoUploadSource: { wizardIds: ["wiz-jan"] } });
  check("delete removes all worker entries", entries.length === 0, entries);
  check(
    "delete releases uploads",
    allocations.every((a) => a.consumedByPaymentId === null),
    allocations,
  );
  v = await validateBaoUploadSource(
    { baoUploadSource: { wizardIds: ["wiz-jan"] } }, "30.00", EMPLOYER_EA);
  check("upload eligible again after delete", v.valid, v);

  // ---- Batch delete-payment path (?deletePayment=true) uses same cleanup ----
  // Re-consume and re-create entries for pay-1, then run the cleanup the
  // batch route performs before deleting the underlying payment.
  await (storage as any).baoWithholdingAllocations.consume(["wiz-jan"], "pay-1");
  entries.push(
    { id: "e-b1", referenceType: "payment", referenceId: "pay-1", chargePlugin: "bao-er-report-to-ee-allocation", chargePluginKey: "cfg-1:pay-1:wiz-jan:w-1", chargePluginConfigId: "cfg-1", eaId: "ea-w1", amount: "-10.00" },
    { id: "e-b2", referenceType: "payment", referenceId: "pay-1", chargePlugin: "bao-er-report-to-ee-allocation", chargePluginKey: "cfg-1:pay-1:wiz-jan:w-2", chargePluginConfigId: "cfg-1", eaId: "ea-w2", amount: "-20.00" },
  );
  await cleanupUploadSourcePaymentArtifacts("pay-1", { baoUploadSource: { wizardIds: ["wiz-jan"] } });
  check("batch delete removes all worker entries", entries.length === 0, entries);
  check(
    "batch delete releases uploads",
    allocations.every((a) => a.consumedByPaymentId === null),
    allocations,
  );

  // ---- paymentSimpleAllocation suppression ----
  await import("../../server/plugins/ledger/charge/plugins/paymentSimpleAllocation");
  const simplePlugin = getChargePlugin("payment-simple-allocation")!;
  const simpleResult = await simplePlugin.execute(
    paymentContext({ paymentId: "pay-3", details: { baoUploadSource: { wizardIds: ["wiz-feb"] } } }),
    { id: "cfg-simple", account: ACCOUNT, settings: {} },
  );
  check(
    "simple allocation creates no entry for upload-source payment",
    simpleResult.success && simpleResult.transactions.length === 0,
    simpleResult,
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
