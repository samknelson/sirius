import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));
vi.mock("../../server/plugins/trust/eligibility/executor", () => ({
  evaluateBenefitEligibility: mocks.evaluate,
  pluginConfigToEligibilityRule: (config: any) => ({
    pluginKey: config.pluginId, appliesTo: ["start", "continue"], config: {},
  }),
}));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => true }));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
  runInSavepoint: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/middleware/request-context", () => ({
  withWmbScanWrites: (fn: () => Promise<unknown>) => fn(),
  withWmbBenefitRoleHistoryInvalidationBatch: (_: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { runBenefitsScan } from "../../server/services/benefits-scan";

type Row = { id: string; workerId: string; month: number; year: number; benefitId: string; sourceRelationId: string | null; employerId: string };
const elected = (relationshipIds: string[], benefitIds = ["b"]) => ({
  id: "e", workerId: "sub", employerId: "employer", relationshipIds, benefitIds,
  startYmd: "2025-01-01", endYmd: null,
});

function fixture(input: {
  election?: ReturnType<typeof elected> | null;
  rows?: Row[];
  relations?: Array<{ id: string; worker1: string; worker2: string; relationTypeName: string; otherWorker: { displayName: string } }>;
  policyBenefits?: string[];
}) {
  const rows = [...(input.rows ?? [])];
  const created: Row[] = [];
  const deleted: Row[] = [];
  const election = input.election ?? null;
  const storage: any = {
    workers: {
      getWorker: async (id: string) => ({ id, denormHomeEmployerId: "employer" }),
      getWorkerDisplayName: async (id: string) => id,
    },
    workerTrustElections: { getActiveByWorkerAsOf: async (id: string) => id === "sub" ? election : undefined },
    employers: { getEmployer: async (id: string) => ({ id, name: id, denormPolicyId: "policy" }) },
    employerPolicyHistory: { getEmployerPolicyHistory: async () => [] },
    policies: { getPolicyById: async () => ({ id: "policy", siriusId: "p", name: "Policy", data: { benefitIds: input.policyBenefits ?? ["b"] } }) },
    variables: { getByName: async () => null },
    pluginConfigs: { search: async () => ["b", "retired"].map(benefit => ({
      config: { pluginId: "rule" }, subsidiary: { benefit },
    })) },
    trustBenefits: { getAllTrustBenefits: async () => [
      { id: "b", name: "Benefit" }, { id: "retired", name: "Old benefit" },
    ] },
    workerRelations: { searchWorkerRelations: async () => input.relations ?? [] },
    trust: { wmb: {
      getWorkerBenefits: async (id: string) => rows.filter(row => row.workerId === id),
      getSubscriberDependentCoverage: async () => rows.filter(row =>
        ["old", "selected"].includes(row.sourceRelationId ?? "") &&
        [12, 1].includes(row.month)),
      createWorkerBenefit: async (data: Omit<Row, "id">) => {
        const row = { ...data, id: `new-${created.length}` };
        rows.push(row); created.push(row); return row;
      },
      deleteWorkerBenefit: async (id: string) => {
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) return false;
        deleted.push(...rows.splice(index, 1)); return true;
      },
      enqueueBenefitRoleHistoryInvalidations: async () => {},
    } },
  };
  return { storage, rows, created, deleted };
}
function coverage(id: string, workerId: string, benefitId: string, month: number, sourceRelationId: string | null): Row {
  return { id, workerId, benefitId, month, year: month === 12 ? 2025 : 2026, sourceRelationId, employerId: "employer" };
}

describe("subscriber-dependent WMB scan", () => {
  beforeEach(() => {
    mocks.evaluate.mockReset();
    mocks.evaluate.mockImplementation(async (benefitId: string, _rules: unknown, input: any) => {
      const ageout = input.relationship?.dependentWorkerId === "aged";
      const eligible = !ageout && !!input.election &&
        (!input.relationship || input.election.relationshipIds.includes(input.relationship.relationId));
      return { eligible, results: [{ pluginKey: ageout ? "ageout" : "rule", eligible, reason: ageout ? "Aged out" : "Election" }] };
    });
  });

  it("starts selected dependents in subscriber context, stops old grants first and leaves other ownership untouched", async () => {
    const f = fixture({
      election: elected(["selected"]),
      relations: [{ id: "selected", worker1: "sub", worker2: "dep", relationTypeName: "child", otherWorker: { displayName: "dep" } }],
      rows: [
        coverage("old-prev", "dep", "b", 12, "old"),
        coverage("old-current", "dep", "b", 1, "old"),
        coverage("other", "dep", "b", 1, "somebody-else"),
        coverage("independent", "dep", "b", 1, null),
      ],
    });
    const result = await runBenefitsScan(f.storage, "sub", 1, 2026, "live", { includeDependents: true });
    const old = result.people.find(p => p.sourceRelationId === "old")!;
    const selected = result.people.find(p => p.sourceRelationId === "selected")!;
    expect(old.actions.find(a => a.benefitId === "b")).toMatchObject({ scanType: "continue", action: "delete", executed: true });
    expect(selected.actions.find(a => a.benefitId === "b")).toMatchObject({ scanType: "start", action: "create", executed: true });
    expect(f.deleted.map(row => row.id)).toEqual(["old-current"]);
    expect(f.created.find(row => row.workerId === "dep")).toMatchObject({ sourceRelationId: "selected", employerId: "employer" });
    expect(f.rows.map(row => row.id)).toContain("other");
    expect(f.rows.map(row => row.id)).toContain("independent");
    expect(mocks.evaluate).toHaveBeenCalledWith("b", expect.anything(), expect.objectContaining({
      workerId: "sub", employerId: "employer", election: expect.objectContaining({ id: "e" }),
      relationship: { dependentWorkerId: "dep", relationId: "selected" },
    }));
    const second = await runBenefitsScan(f.storage, "sub", 1, 2026, "live", { includeDependents: true });
    expect(second.people.find(p => p.sourceRelationId === "selected")?.actions.find(a => a.benefitId === "b")?.action).toBe("none");
    expect(f.created.filter(row => row.workerId === "dep")).toHaveLength(1);
  });

  it("stops a lapsed dependent and a benefit removed from the current policy without granting other benefits", async () => {
    const f = fixture({
      rows: [
        coverage("prev", "dep", "retired", 12, "old"),
        coverage("current", "dep", "retired", 1, "old"),
      ],
      policyBenefits: ["b"],
    });
    const result = await runBenefitsScan(f.storage, "sub", 1, 2026, "live", { includeDependents: true });
    const dep = result.people.find(p => p.role === "dependent")!;
    expect(dep.actions).toEqual([expect.objectContaining({
      benefitId: "retired", scanType: "continue", eligible: false, action: "delete", executed: true,
    })]);
    expect(f.created).toHaveLength(0);
    expect(f.deleted.map(row => row.id)).toEqual(["current"]);
  });

  it("keeps elected dependent ageout failures even without an existing current row", async () => {
    const f = fixture({
      election: elected(["selected"]),
      relations: [{ id: "selected", worker1: "sub", worker2: "aged", relationTypeName: "child", otherWorker: { displayName: "aged" } }],
      rows: [coverage("prev", "aged", "b", 12, "selected")],
    });
    const result = await runBenefitsScan(f.storage, "sub", 1, 2026, "live", { includeDependents: true });
    expect(result.people.find(p => p.workerId === "aged")?.actions).toEqual([
      expect.objectContaining({ scanType: "continue", eligible: false, action: "none",
        pluginResults: [expect.objectContaining({ pluginKey: "ageout", reason: "Aged out" })] }),
    ]);
  });

  it("reports an unresolvable dependent evaluation instead of silently omitting it", async () => {
    const f = fixture({
      election: elected(["selected"]),
      relations: [{ id: "selected", worker1: "sub", worker2: "dep", relationTypeName: "child", otherWorker: { displayName: "dep" } }],
    });
    f.storage.trust.wmb.getWorkerBenefits = async (id: string) => {
      if (id === "dep") throw new Error("dependent read failed");
      return [];
    };
    const result = await runBenefitsScan(f.storage, "sub", 1, 2026, "test", { includeDependents: true });
    expect(result.people.find(p => p.workerId === "dep")?.error).toBe("dependent read failed");
  });
});
