import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Worker } from "@shared/schema";
import type { EligibilityRule, ScanType } from "../../../server/plugins/trust/eligibility/types";
import { RelationshipTypePlugin } from "../server/plugins/trust/eligibility/plugins/relationshipType";
import { evaluateBenefitEligibility } from "../../../server/plugins/trust/eligibility/executor";

const state = vi.hoisted(() => ({
  enabled: [] as string[],
  plugins: new Map<string, RelationshipTypePlugin>(),
  relations: vi.fn(),
}));

vi.mock("../../../server/plugins/trust/eligibility/registry", () => ({
  registerEligibilityPlugin: vi.fn(),
  eligibilityPluginRegistry: {
    get: (id: string) => state.plugins.get(id),
    isPluginEnabled: (id: string, enabled: string[]) => {
      const plugin = state.plugins.get(id);
      return !!plugin && (!plugin.metadata.requiredComponent || enabled.includes(plugin.metadata.requiredComponent));
    },
  },
}));
vi.mock("../../../server/modules/components", () => ({
  getEnabledComponentIds: async () => state.enabled,
}));
vi.mock("../../../server/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../server/storage/database", () => ({
  storage: {
    contacts: { getContact: async () => undefined },
    workerTrustElections: { getActiveByWorkerAsOf: async () => undefined },
    workerRelations: { findActiveBetween: state.relations },
  },
}));
vi.mock("../../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ get: vi.fn() }),
}));
vi.mock("../../../server/services/trust-relationships", () => ({
  readTrustRelationships: state.relations,
  TrustRelationshipsUnavailableError: class extends Error {},
}));

const worker: Worker = {
  id: "subscriber",
  contactId: "contact",
  siriusId: 1,
  ssn: null,
  bargainingUnitId: null,
};
const rule: EligibilityRule = {
  pluginKey: "relationship-type",
  appliesTo: ["start", "continue"],
  config: { appliesTo: ["start", "continue"], allowedRelationTypeIds: [], allowSelf: false },
};
const input = (scanType: ScanType = "start") => ({
  workerId: worker.id,
  worker,
  scanType,
  asOfMonth: 11,
  asOfYear: 2026,
});

describe("production benefit evaluation with unavailable relationship authority", () => {
  beforeEach(() => {
    state.enabled = [];
    state.plugins.clear();
    state.plugins.set("relationship-type", new RelationshipTypePlugin());
  });

  it.each(["start", "continue"] as const)("refuses subscriber/self evaluation during a %s scan", async scanType => {
    const plugin = state.plugins.get("relationship-type")!;
    const evaluate = vi.spyOn(plugin, "evaluate");
    const result = await evaluateBenefitEligibility("benefit", [rule], input(scanType));
    expect(result).toMatchObject({
      eligible: false,
      results: [{ pluginKey: "relationship-type", eligible: false, reason: "Component not enabled: worker.relations" }],
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(state.relations).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps refusal authoritative with stopAfterIneligible=%s", async stopAfterIneligible => {
    const next = new RelationshipTypePlugin();
    Object.assign(next.metadata, { id: "next", requiredComponent: undefined, unavailableBehavior: undefined });
    next.evaluate = vi.fn(async () => ({ eligible: true }));
    state.plugins.set("next", next);
    const result = await evaluateBenefitEligibility(
      "benefit",
      [rule, { ...rule, pluginKey: "next" }],
      { ...input(), stopAfterIneligible },
    );
    expect(result.eligible).toBe(false);
    expect(result.results[0].eligible).toBe(false);
    expect(next.evaluate).toHaveBeenCalledTimes(stopAfterIneligible ? 0 : 1);
  });

  it.each([true, false])("preserves the installed allowSelf=%s decision", async allowSelf => {
    state.enabled = ["worker.relations"];
    const result = await evaluateBenefitEligibility(
      "benefit", [{ ...rule, config: { ...rule.config, allowSelf } }], input(),
    );
    expect(result.eligible).toBe(allowSelf);
    expect(result.results[0].eligible).toBe(allowSelf);
    expect(state.relations).not.toHaveBeenCalled();
  });

  it("preserves the default skip contract for other disabled rules", async () => {
    const plugin = state.plugins.get("relationship-type")!;
    delete plugin.metadata.unavailableBehavior;
    const result = await evaluateBenefitEligibility("benefit", [rule], input());
    expect(result.eligible).toBe(true);
    expect(result.results[0].eligible).toBe(true);
    expect(state.relations).not.toHaveBeenCalled();
  });

  it("also refuses a configured rule whose source is absent", async () => {
    state.plugins.clear();
    const result = await evaluateBenefitEligibility("benefit", [rule], input());
    expect(result).toMatchObject({
      eligible: false,
      results: [{ pluginKey: "relationship-type", eligible: false, reason: "Plugin not found: relationship-type" }],
    });
  });
});
