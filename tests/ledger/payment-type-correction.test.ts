import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
const mocks = vi.hoisted(() => ({
  state: {} as any, audit: [] as any[], execute: vi.fn(), reconcile: vi.fn(), access: vi.fn(), component: vi.fn(),
  tail: Promise.resolve(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({
    execute: mocks.execute,
    select: () => ({
      from: (table: any) => {
        const rows = () => {
          switch (getTableName(table)) {
            case "options_ledger_payment_type": return [mocks.state.type];
            case "ledger_payments": return mocks.state.payments;
            case "ledger": return mocks.state.entries;
            case "ledger_ea": return mocks.state.eas;
            case "ledger_accounts": return mocks.state.accounts;
            case "ledger_payment_attempts": return mocks.state.attempts;
            case "plugin_configs": return mocks.state.configs;
            default: throw Error("Unexpected table");
          }
        };
        return { then: (fn: any) => Promise.resolve(structuredClone(rows())).then(fn),
          where: async () => structuredClone(rows()), leftJoin: async () => structuredClone(rows()) };
      },
    }),
    update: () => ({ set: (values: any) => ({ where: async () => Object.assign(mocks.state.type, values) }) }),
    insert: () => ({ values: async (values: any) => { mocks.audit.push(values); } }),
  }),
  runInTransaction: async (fn: any) => {
    // Emulate the exclusive confirmation lock, including rollback-before-unlock.
    const prior = mocks.tail;
    let release!: () => void;
    mocks.tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    const before = structuredClone(mocks.state);
    const auditBefore = structuredClone(mocks.audit);
    try { return await fn(); } catch (error) { mocks.state = before; mocks.audit = auditBefore; throw error; }
    finally { release(); }
  },
}));
vi.mock("../../server/modules/ledger/payments", () => ({
  triggerPaymentChargePlugins: mocks.reconcile,
  validateProposedAllocation: (details: any) => ({ valid: true, allocations: details?.proposedAllocation }),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: mocks.access }));
vi.mock("../../server/modules/components", () => ({ requireComponent: mocks.component }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => ({ userId: "admin-1", chargeConfigCache: new Map() }) }));

const { buildCorrectionPreview, correctionSnapshot, previewPaymentTypeCorrection, confirmPaymentTypeCorrection, registerPaymentTypeCorrectionRoutes } =
  await import("../../server/modules/ledger/payment-type-correction");

function fixture(): any {
  return {
    type: { id: "t1", name: "Legacy charge", direction: "credit", currencyCode: "USD" },
    payments: [{ id: "p1", amount: "50.00", paymentType: "t1", status: "cleared", ledgerEaId: "ea1",
      dateReceived: new Date("2026-01-10T12:00:00Z"), details: null }],
    entries: [{ id: "entry1", amount: "-50.00", chargePlugin: "payment-simple-allocation",
      chargePluginKey: "c1:p1", chargePluginConfigId: "c1", referenceType: "payment", referenceId: "p1",
      eaId: "ea1", statementYmd: "2026-01-10", date: new Date("2026-01-10T12:00:00Z"), memo: null,
      data: { pluginId: "payment-simple-allocation", pluginConfigId: "c1", paymentId: "p1",
        originalAmount: "50.00", ledgerEaId: "ea1", allocationId: null } }],
    eas: [{ id: "ea1", accountId: "a1", entityType: "worker", entityId: "w1" }],
    accounts: [{ id: "a1", currencyCode: "USD", gatewayConfigId: null }],
    attempts: [], configs: [{ config: { id: "c1", pluginId: "payment-simple-allocation", enabled: true },
      charge: { id: "c1", account: "a1", scope: "global" } }],
  };
}
beforeEach(() => {
  mocks.state = fixture(); mocks.audit = []; mocks.execute.mockReset(); mocks.reconcile.mockReset();
  mocks.reconcile.mockImplementation(async () => { mocks.state.entries[0].amount = "50.00"; });
});

describe("reviewed payment type correction", () => {
  it("previews exact entries and does not mutate data", async () => {
    const before = structuredClone(mocks.state);
    const preview = await previewPaymentTypeCorrection("t1");
    expect(preview.eligible).toBe(true);
    expect(preview.payments[0].entries[0]).toMatchObject({ id: "entry1", amount: "-50.00", proposedAmount: "50.00" });
    expect(mocks.state).toEqual(before); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("atomically reconciles only simple allocations, preserves identity, and records actor and snapshot", async () => {
    const preview = await previewPaymentTypeCorrection("t1");
    const result = await confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true });
    expect(result).toMatchObject({ direction: "charge", entryCount: 1, paymentCount: 1 });
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }),
      { onlyPluginIds: ["payment-simple-allocation"], suppressSavedEvent: true });
    expect(mocks.state.entries[0]).toMatchObject({ id: "entry1", amount: "50.00" });
    expect(mocks.audit[0]).toMatchObject({ userId: "admin-1", meta: { snapshot: preview.snapshot } });
    expect((await previewPaymentTypeCorrection("t1")).currentDirection).toBe("charge");
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true })).rejects.toThrow("Data changed");
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
  it.each(["payment", "entry", "config", "new-payment"])("refuses stale %s snapshots without writes", async change => {
    const preview = await previewPaymentTypeCorrection("t1");
    if (change === "payment") mocks.state.payments[0].memo = "changed";
    if (change === "entry") mocks.state.entries[0].amount = "-49.00";
    if (change === "config") mocks.state.configs[0].config.enabled = false;
    if (change === "new-payment") mocks.state.payments.push({ ...mocks.state.payments[0], id: "p2" });
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true })).rejects.toThrow("Data changed");
    expect(mocks.state.type.direction).toBe("credit"); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(["bespoke", "missing", "extra-config", "upload", "online", "gateway", "wrong-key", "wrong-sign"])("blocks unsupported %s", async kind => {
    if (kind === "bespoke") mocks.state.entries[0].chargePlugin = "other";
    if (kind === "missing") mocks.state.entries = [];
    if (kind === "extra-config") mocks.state.configs.push({ ...mocks.state.configs[0] });
    if (kind === "upload") mocks.state.payments[0].details = { baoUploadSource: { wizardIds: ["w1"] } };
    if (kind === "online") mocks.state.attempts.push({ id: "attempt", ledgerPaymentId: "p1" });
    if (kind === "gateway") mocks.state.accounts[0].gatewayConfigId = "gateway";
    if (kind === "wrong-key") mocks.state.entries[0].chargePluginKey = "stale";
    if (kind === "wrong-sign") mocks.state.entries[0].amount = "50.00";
    const preview = await previewPaymentTypeCorrection("t1");
    expect(preview.eligible).toBe(false); expect(preview.payments[0].blockers.length).toBeGreaterThan(0);
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true })).rejects.toThrow("Unsupported");
    expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.state.type.direction).toBe("credit");
  });
  it.each(["throw", "identity", "no-op"])("rolls back the type, entries and audit on reconciliation %s", async kind => {
    const preview = await previewPaymentTypeCorrection("t1");
    mocks.reconcile.mockImplementation(async () => {
      if (kind === "throw") { mocks.state.entries[0].amount = "50.00"; throw Error("plugin failed"); }
      if (kind === "identity") { mocks.state.entries[0].amount = "50.00"; mocks.state.entries[0].id = "replacement"; }
    });
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true })).rejects.toThrow();
    expect(mocks.state.type.direction).toBe("credit");
    expect(mocks.state.entries[0]).toMatchObject({ id: "entry1", amount: "-50.00" }); expect(mocks.audit).toEqual([]);
  });
  it.each(["date", "memo", "metadata", "extra-metadata"])("blocks historical %s mismatches before replay", async field => {
    if (field === "date") mocks.state.entries[0].date = new Date("2026-01-10T13:00:00Z");
    if (field === "memo") mocks.state.entries[0].memo = "Historical custom memo";
    if (field === "metadata") mocks.state.entries[0].data.originalAmount = "51.00";
    if (field === "extra-metadata") mocks.state.entries[0].data.legacyProvenance = "import-123";
    const before = structuredClone(mocks.state);
    const preview = await previewPaymentTypeCorrection("t1");
    expect(preview.eligible).toBe(false);
    expect(preview.payments[0].blockers.join(" ")).toContain("overwrite provenance");
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true }))
      .rejects.toThrow("Unsupported");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.state).toEqual(before); expect(mocks.audit).toEqual([]);
  });
  it.each(["date", "memo", "metadata", "extra-field"])("rolls back unexpected post-replay %s changes", async field => {
    const preview = await previewPaymentTypeCorrection("t1");
    const before = structuredClone(mocks.state);
    mocks.reconcile.mockImplementation(async () => {
      const entry = mocks.state.entries[0];
      entry.amount = "50.00";
      if (field === "date") entry.date = new Date("2026-01-11T12:00:00Z");
      if (field === "memo") entry.memo = "Unexpected rewritten description";
      if (field === "metadata") entry.data.originalAmount = "51.00";
      if (field === "extra-field") entry.extraProvenance = "unexpected";
    });
    await expect(confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true }))
      .rejects.toThrow("provenance");
    expect(mocks.state).toEqual(before); expect(mocks.audit).toEqual([]);
  });
  it("preserves a payment-derived custom memo and exact metadata while changing only the sign", async () => {
    mocks.state.payments[0].memo = "Original payment memo";
    mocks.state.entries[0].memo = "Original payment memo";
    const beforeEntry = structuredClone(mocks.state.entries[0]);
    const preview = await previewPaymentTypeCorrection("t1");
    expect(preview.eligible).toBe(true);
    await confirmPaymentTypeCorrection("t1", { snapshot: preview.snapshot, confirmed: true });
    expect(mocks.state.entries[0]).toEqual({ ...beforeEntry, amount: "50.00" });
  });
  it("requires explicit exact confirmation", async () => {
    await expect(confirmPaymentTypeCorrection("t1", { confirmed: "true", snapshot: "x" })).rejects.toThrow("Explicit");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("serializes competing confirmations so only one can reconcile a reviewed snapshot", async () => {
    const preview = await previewPaymentTypeCorrection("t1");
    const body = { snapshot: preview.snapshot, confirmed: true };
    const results = await Promise.allSettled([
      confirmPaymentTypeCorrection("t1", body),
      confirmPaymentTypeCorrection("t1", body),
    ]);
    expect(results.map(r => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveLength(1);
  });
  it("supports multiple reviewed allocations without changing their dates or identities", () => {
    const data = fixture();
    data.payments[0].details = { proposedAllocation: [
      { eaId: "ea1", amount: "20.00", statementYmd: "2026-01-01" },
      { eaId: "ea1", amount: "30.00", statementYmd: "2026-02-01" },
    ] };
    data.entries = data.payments[0].details.proposedAllocation.map((a: any, i: number) => ({
      ...data.entries[0], id: `entry${i}`, amount: (-Number(a.amount)).toFixed(2),
      chargePluginKey: `c1:p1:ea1:${a.statementYmd}`, statementYmd: a.statementYmd,
      data: { ...data.entries[0].data, originalAmount: a.amount, allocationId: `ea1:${a.statementYmd}` },
    }));
    expect(buildCorrectionPreview(data)).toMatchObject({ eligible: true, entryCount: 2 });
  });
  it("canonicalizes nested JSON object order but fingerprints values", () => {
    expect(correctionSnapshot({ a: { x: 1, y: 2 } })).toBe(correctionSnapshot({ a: { y: 2, x: 1 } }));
    expect(correctionSnapshot({ x: 1 })).not.toBe(correctionSnapshot({ x: 2 }));
  });
  it("requires admin access and ledger component on both routes", () => {
    const post = vi.fn(); registerPaymentTypeCorrectionRoutes({ post } as any);
    expect(post).toHaveBeenCalledTimes(2); expect(mocks.access).toHaveBeenCalledWith("admin");
    expect(mocks.component).toHaveBeenCalledWith("ledger");
  });
  it("locks all phantom-producing source tables before inventory reads with a bounded wait", () => {
    const source = readFileSync("server/modules/ledger/payment-type-correction.ts", "utf8");
    expect(source).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(source).toContain("SET LOCAL lock_timeout = '5s'");
    for (const table of ["ledger_payments", "ledger_payment_attempts", "ledger_ea", "ledger_accounts", "plugin_configs_charge"]) {
      expect(source).toContain(table);
    }
    expect(source.indexOf("await lockInventory(true)")).toBeLessThan(source.indexOf("const before = await readInventory(id)"));
  });
});