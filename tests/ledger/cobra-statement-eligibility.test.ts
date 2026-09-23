import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  storage: {
    baoCobraCases: { listElectedActiveCasesForCoveredPerson: vi.fn() },
    workerTrustElections: { listByWorker: vi.fn() },
    pluginConfigs: { search: vi.fn() },
    ledger: { entries: { getCobraStatementMonthEvidence: vi.fn() } },
  },
  getClient: vi.fn(),
}));
vi.mock("../../server/storage/database", () => ({ storage: mocks.storage }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit: vi.fn() },
  EventType: {},
}));

const { BaoCobraPlugin } = await import(
  "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-cobra"
);
const { createLedgerEntryStorage } = await import("../../server/storage/ledger");

const baseCase = {
  id: "case-1",
  coveredPersonWorkerId: "worker-1",
  cobraEffectiveYmd: "2026-01-01",
  maxPeriodYmd: "2027-12-31",
};
const election = (caseId: string, benefitIds = ["medical"]) => ({
  enrollmentType: "cobra",
  benefitIds,
  data: { cobraCaseId: caseId },
});
const context = {
  subscriberWorker: { id: "worker-1" },
  benefitId: "medical",
  asOfYear: 2026,
  asOfMonth: 4,
};
const plugin = new BaoCobraPlugin();
const evaluate = () => plugin.evaluate(context as any, {} as any);

describe("COBRA statement-month eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage.baoCobraCases.listElectedActiveCasesForCoveredPerson.mockResolvedValue([baseCase]);
    mocks.storage.workerTrustElections.listByWorker.mockResolvedValue([election("case-1")]);
    mocks.storage.pluginConfigs.search.mockResolvedValue([
      { config: { id: "config-1", pluginId: "sitespecific-bao-cobra", enabled: true }, subsidiary: { scope: "global", account: "cobra-account" } },
    ]);
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue(null);
  });

  it("fails closed without a configured account or posted charge", async () => {
    mocks.storage.pluginConfigs.search.mockResolvedValueOnce([]);
    expect((await evaluate()).reason).toMatch(/No COBRA billing account/);
    expect(mocks.storage.ledger.entries.getCobraStatementMonthEvidence).not.toHaveBeenCalled();
    mocks.storage.pluginConfigs.search.mockResolvedValueOnce([
      { config: { id: "config-1", pluginId: "sitespecific-bao-cobra", enabled: true }, subsidiary: { scope: "global", account: "cobra-account" } },
    ]);
    expect((await evaluate()).reason).toMatch(/No posted COBRA charge/);
  });

  it("does not grant an unpaid month during grace or from an overall account credit", async () => {
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
      balanceCents: 10000, caseChargeCents: 10000, hasAllocation: false,
    });
    expect((await evaluate()).reason).toMatch(/No payment allocated/);
    expect(mocks.storage.ledger.entries.getCobraStatementMonthEvidence)
      .toHaveBeenCalledWith("worker-1", "cobra-account", "case-1", "2026-04");
  });

  it("does not let another statement month's credit mask this month's debt", async () => {
    // The account can be zero overall while April still owes $100.
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
      balanceCents: 10000, caseChargeCents: 10000, hasAllocation: true,
    });
    expect((await evaluate()).reason).toMatch(/nonzero balance/);
  });

  it("requires exactly zero monthly balance, not partial payment or overpayment", async () => {
    for (const balanceCents of [1, -1, 5000, -5000]) {
      mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
        balanceCents, caseChargeCents: 10000, hasAllocation: true,
      });
      const result = await evaluate();
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/nonzero balance/);
    }
  });

  it("denies a fully reversed charge even if an unrelated adjustment balances the payment", async () => {
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
      balanceCents: 0, caseChargeCents: 0, hasAllocation: true,
    });
    expect((await evaluate()).reason).toMatch(/No posted COBRA charge/);
  });

  it("grants when this case's charge and a posted allocation balance the requested month", async () => {
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
      balanceCents: 0, caseChargeCents: 10000, hasAllocation: true,
    });
    expect((await evaluate()).eligible).toBe(true);
  });

  it("keeps benefit and case association and tries other covering cases", async () => {
    mocks.storage.baoCobraCases.listElectedActiveCasesForCoveredPerson.mockResolvedValue([
      { ...baseCase, id: "case-other", maxPeriodYmd: "2026-02-28" },
      baseCase,
    ]);
    mocks.storage.workerTrustElections.listByWorker.mockResolvedValue([
      election("case-other"), election("case-1"),
    ]);
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mockResolvedValue({
      balanceCents: 0, caseChargeCents: 10000, hasAllocation: true,
    });
    expect((await evaluate()).eligible).toBe(true);
    expect(mocks.storage.ledger.entries.getCobraStatementMonthEvidence).toHaveBeenCalledTimes(1);
    mocks.storage.workerTrustElections.listByWorker.mockResolvedValue([election("case-1", ["dental"])]);
    expect((await evaluate()).eligible).toBe(false);
    expect((await evaluate()).reason).toMatch(/No COBRA election covers/);
  });

  it("continues to a second covering case when the first case is unpaid", async () => {
    mocks.storage.baoCobraCases.listElectedActiveCasesForCoveredPerson.mockResolvedValue([
      { ...baseCase, id: "unpaid-case" }, baseCase,
    ]);
    mocks.storage.workerTrustElections.listByWorker.mockResolvedValue([
      election("unpaid-case"), election("case-1"),
    ]);
    mocks.storage.ledger.entries.getCobraStatementMonthEvidence
      .mockResolvedValueOnce({ balanceCents: 10000, caseChargeCents: 10000, hasAllocation: false })
      .mockResolvedValueOnce({ balanceCents: 0, caseChargeCents: 10000, hasAllocation: true });
    expect((await evaluate()).eligible).toBe(true);
    expect(mocks.storage.ledger.entries.getCobraStatementMonthEvidence.mock.calls.map(
      (call: string[]) => call[2],
    )).toEqual(["unpaid-case", "case-1"]);
  });
});

describe("bounded ledger evidence query", () => {
  it("scopes the aggregate to worker, COBRA account, case and statement month, with allocation provenance", async () => {
    const execute = vi.fn(async (_query: unknown) => ({
      rows: [{ balance_cents: "0", case_charge_cents: "10000", has_base_charge: true, has_allocation: true }],
    }));
    mocks.getClient.mockReturnValue({ execute });
    const result = await createLedgerEntryStorage().getCobraStatementMonthEvidence(
      "worker-1", "cobra-account", "case-1", "2026-04",
    );
    expect(result).toEqual({ balanceCents: 0, caseChargeCents: 10000, hasAllocation: true });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0] as any);
    expect(query.params).toEqual(expect.arrayContaining([
      "case-1", "2026-04-01", "2026-05-01", "worker-1", "cobra-account",
    ]));
    expect(query.sql).toContain("l.statement_ymd >=");
    expect(query.sql).toContain("l.statement_ymd <");
    expect(query.sql).toContain("l.reference_type IN ('cobra_case', 'cobra_case_adjustment')");
    expect(query.sql).toContain("l.reference_type = 'cobra_case'");
    expect(query.sql).toContain("l.data->>'allocationId'");
    expect(query.sql).toContain("l.amount < 0");
    expect(query.sql).toContain("ea.entity_type = 'worker'");
    expect(query.sql).toContain("SUM(l.amount * 100)");
  });

  it("returns no evidence for an empty month and rejects malformed month keys", async () => {
    mocks.getClient.mockReturnValue({ execute: vi.fn(async () => ({
      rows: [{ balance_cents: null, case_charge_cents: null, has_allocation: null }],
    })) });
    const entries = createLedgerEntryStorage();
    expect(await entries.getCobraStatementMonthEvidence("w", "a", "c", "2026-04")).toBeNull();
    await expect(entries.getCobraStatementMonthEvidence("w", "a", "c", "2026-13"))
      .rejects.toThrow(/YYYY-MM/);
  });

  it("does not count an adjustment alone as a posted case premium", async () => {
    mocks.getClient.mockReturnValue({ execute: vi.fn(async () => ({
      rows: [{ balance_cents: "0", case_charge_cents: "10000", has_base_charge: false, has_allocation: true }],
    })) });
    expect(await createLedgerEntryStorage().getCobraStatementMonthEvidence(
      "w", "a", "c", "2026-04",
    )).toMatchObject({ caseChargeCents: 0 });
  });
});