import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  payments: [] as any[], types: [] as any[], ea: {} as any, account: {} as any,
  access: true, balance: "180.00", creates: vi.fn(), updates: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  ledger: {
    accounts: { get: async () => state.account },
    ea: { get: async () => state.ea, getBalance: async () => state.balance },
    payments: {
      getByUpload: async () => state.payments,
      createForUpload: async (upload: string, input: any) => {
        state.creates(upload, input);
        const payment = { ...input, id: `receipt-${state.payments.length}`, uploadWizardId: upload };
        state.payments.push(payment); return payment;
      },
      updateEmployerSubmission: async (id: string, input: any) => {
        state.updates(id, input);
        Object.assign(state.payments.find(p => p.id === id), input);
      },
    },
  },
} }));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({ list: async () => state.types }) }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccessInline: async () => ({ granted: state.access }) }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "effective-user" } }) }));
import { buildLegalConfirmationStep } from "../../server/plugins/wizards/gbhet-legal-payment";
import { legalRemittanceSchema, legalPaymentMinor, ledgerMinor, ledgerDecimal, EMPLOYER_SUBMITTED } from "@shared/legal-payment";
const step = buildLegalConfirmationStep();
let ctx: any;
beforeEach(() => {
  state.payments = []; state.creates.mockClear(); state.updates.mockClear();
  state.ea = { id: "ea", accountId: "account", entityType: "employer", entityId: "employer" };
  state.account = { id: "account", currencyCode: "USD", isActive: true };
  state.access = true; state.balance = "180.00";
  state.types = [
    { id: "check", name: "Check", category: "financial", currencyCode: "USD", data: { legalRemittanceMethod: "check" } },
    { id: "wire", name: "Wire", category: "financial", currencyCode: "USD", data: { legalRemittanceMethod: "wire" } },
    { id: "adjustment", name: "Check", category: "adjustment", currencyCode: "USD", data: { legalRemittanceMethod: "check" } },
    { id: "foreign", name: "Check", category: "financial", currencyCode: "EUR", data: { legalRemittanceMethod: "check" } },
  ];
  ctx = {
    wizardId: "upload", req: { user: {}, session: {} },
    wizard: { id: "upload", type: "gbhet_legal_workers_monthly", entityId: "employer", status: "completed", data: {
      processResults: { successCount: 2 }, legalCompletion: { version: 2, totals: { chargeReadFailed: false },
        chargeGroups: [{ eaId: "ea", accountId: "account", accountName: "Legal", currency: "USD", amount: "100.00", entries: 2, invoicePaths: [] }] },
    } },
    input: { eaId: "ea", action: "submit", remittance: { amount: "100.00", method: "check", paymentType: "check" } },
  };
});
async function submit() {
  const out = await step.submit!(ctx);
  Object.assign(ctx.wizard.data, out.data);
  return out;
}
describe("Scoped Legal remittances", () => {
  it.each(["gbhet_legal_workers_monthly", "gbhet_legal_workers_corrections"])("submits and edits one uncredited receipt for %s", async type => {
    ctx.wizard.type = type;
    await submit(); await submit();
    ctx.input.remittance = { ...ctx.input.remittance, method: "wire", paymentType: "wire", merchant: "Payer", checkTransactionNumber: "wire-ref" };
    await submit();
    expect(state.creates).toHaveBeenCalledTimes(1);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      status: EMPLOYER_SUBMITTED, dateReceived: null, dateCleared: null, allocated: false,
      ledgerEaId: "ea", amount: "100.00", uploadWizardId: "upload",
      details: { submittedBy: "effective-user", uploadPath: "/wizards/upload", merchant: "Payer", checkTransactionNumber: "wire-ref" },
    });
    expect((await step.getData!(ctx) as any).accounts[0].balance).toBe("180.00");
    expect(step.serializeSubmit).toBe(true);
  });
  it("saves incomplete drafts without creating or changing a ledger receipt", async () => {
    ctx.input = { eaId: "ea", action: "save", remittance: { amount: "", notes: "Awaiting approval" } };
    await submit();
    expect(state.creates).not.toHaveBeenCalled();
    expect(ctx.wizard.data.legalRemittances.ea).toEqual({ amount: "", notes: "Awaiting approval" });
    ctx.input.remittance.amount = "0"; await submit();
    expect(state.creates).not.toHaveBeenCalled();
  });
  it.each(["0", "-1.00", "Infinity", "NaN", "1e2", "1.001", "100000000.00", "1.00usd", ""])("refuses invalid payment amount %j", async amount => {
    ctx.input.remittance.amount = amount;
    await expect(submit()).rejects.toThrow(); expect(state.creates).not.toHaveBeenCalled();
  });
  it.each(["draft", "failed", "canceled"])("refuses payment for incomplete/failed state %s", async status => {
    ctx.wizard.status = status; await expect(submit()).rejects.toThrow(/Finish processing/);
  });
  it("allows historical viewing without inventing a payment or outcome", async () => {
    ctx.wizard.data.processResults = null; await expect(submit()).rejects.toThrow(/Finish processing/);
    ctx.wizard.data.processResults = {}; ctx.wizard.data.legalCompletion = null;
    await expect(submit()).rejects.toThrow(/Actual account charges/);
    expect(await step.getData!(ctx)).toMatchObject({ historical: true, population: null, totals: null, accounts: [] });
  });
  it("rejects fabricated charge data and accounts not charged by this upload", async () => {
    ctx.input.uploadTotal = "1"; await expect(submit()).rejects.toThrow(); delete ctx.input.uploadTotal;
    ctx.wizard.data.legalCompletion.totals.chargeReadFailed = true; await expect(submit()).rejects.toThrow(/Actual account charges/);
    ctx.wizard.data.legalCompletion.totals.chargeReadFailed = false;
    ctx.input.eaId = "foreign"; await expect(submit()).rejects.toThrow(/charged by this upload/);
  });
  it.each(["adjustment", "foreign", "unknown"])("rejects invalid method configuration %s", async paymentType => {
    ctx.input.remittance.paymentType = paymentType; await expect(submit()).rejects.toThrow(/configured financial/);
  });
  it("requires explicit method mapping and type choice, even for named Check types", async () => {
    delete state.types[0].data;
    expect((await step.getData!(ctx) as any).accounts[0].methods.map((m: any) => m.id)).toEqual(["wire"]);
    await expect(submit()).rejects.toThrow(/configured financial/);
    state.types[0].data = { legalRemittanceMethod: "check" };
    state.types.push({ ...state.types[0], id: "check2" });
    expect((await step.getData!(ctx) as any).accounts[0].methods).toHaveLength(3);
    delete ctx.input.remittance.paymentType; await expect(submit()).rejects.toThrow(/configured financial/);
  });
  it("keeps different currencies and accounts independent", async () => {
    await submit();
    ctx.wizard.data.legalCompletion.chargeGroups.push({ eaId: "ea-eur", accountId: "account-eur", currency: "EUR", amount: "20.00", entries: 1, invoicePaths: [] });
    state.ea = { ...state.ea, id: "ea-eur", accountId: "account-eur" };
    state.account = { id: "account-eur", currencyCode: "EUR", isActive: true };
    ctx.input = { eaId: "ea-eur", action: "submit", remittance: { amount: "20", method: "check", paymentType: "foreign" } };
    await submit();
    expect(state.payments.map(p => [p.ledgerEaId, p.amount])).toEqual([["ea", "100.00"], ["ea-eur", "20.00"]]);
    expect(state.payments[1].details.proposedAllocation).toEqual([{ eaId: "ea-eur", amount: "20.00", statementYmd: "" }]);
  });
  it.each(["cleared", "canceled", "draft"])("does not overwrite staff action %s, but permits an exact retry", async status => {
    await submit(); state.payments[0].status = status;
    await submit(); expect(state.updates).not.toHaveBeenCalled();
    ctx.input.remittance.amount = "101"; await expect(submit()).rejects.toThrow(/Staff have started/);
  });
  it("enforces employer ownership and account policy", async () => {
    state.ea.entityId = "other-employer"; await expect(submit()).rejects.toThrow(/belong/);
    state.ea.entityId = "employer"; state.access = false; await expect(submit()).rejects.toThrow(/access/);
    expect(state.creates).not.toHaveBeenCalled();
  });
  it("rejects sensitive or privileged fields and invalid dates", async () => {
    for (const field of ["status", "dateCleared", "dateReceived", "routingNumber", "accountNumber", "proposedAllocation", "submittedBy"]) {
      ctx.input.remittance[field] = "forbidden";
      await expect(submit()).rejects.toThrow(); delete ctx.input.remittance[field];
    }
    ctx.input.remittance.paymentDate = "2026-02-30"; await expect(submit()).rejects.toThrow(/valid.*date/);
    ctx.input.remittance.method = "wire"; await expect(submit()).rejects.toThrow();
  });
  it("keeps unavailable balance separate from zero and uses currency-safe arithmetic", async () => {
    state.balance = "unavailable";
    expect((await step.getData!(ctx) as any).accounts[0]).toMatchObject({ balance: null, error: expect.any(String) });
    expect(ledgerDecimal(ledgerMinor("180.00") - ledgerMinor("100.00"))).toBe("80.00");
    expect(ledgerDecimal(ledgerMinor("-20.00") - ledgerMinor("100.00"))).toBe("-120.00");
    expect(() => legalPaymentMinor("1.01", "JPY")).toThrow();
    expect(legalRemittanceSchema.safeParse({ amount: "1", accountNumber: "forbidden" }).success).toBe(false);
  });
});
