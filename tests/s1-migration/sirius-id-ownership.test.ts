import { describe, expect, it } from "vitest";
import {
  planSiriusIdOwnership,
  projectSiriusIdOwnershipEvidence,
  nextRelationshipShellSiriusId,
  siriusIdPlanHash,
  type SiriusIdOwnershipSnapshot,
} from "../../server/storage/workers/sirius-id-ownership-plan";

const snapshot = (partial: Partial<SiriusIdOwnershipSnapshot>): SiriusIdOwnershipSnapshot => ({
  stagingPresent: true,
  idMapPresent: true,
  claims: [],
  workers: [],
  ...partial,
});

describe("Sirius ID ownership planner", () => {
  it("uses exact source mapping, not a number match, to confirm ownership", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "mapped", siriusId: 100, data: null,
        workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }],
        shellMappings: [],
      }],
    }));
    expect(plan.decisions).toMatchObject([{ action: "correct", claimantWorkerId: "mapped" }]);
    expect(plan.rekeys).toEqual([]);
  });

  it("blocks duplicate source claims before considering any target repair", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
      ],
    }));
    expect(plan.hardBlockers).toBe(2);
    expect(plan.decisions.map((decision) => decision.action)).toEqual(["source_duplicate", "source_duplicate"]);
  });

  it("blocks valid claims when exact id_map evidence is unavailable, including an empty scoped result", () => {
    const unavailable = snapshot({
      idMapPresent: false,
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
    });
    expect(planSiriusIdOwnership(unavailable).decisions[0]).toMatchObject({ action: "blocked_mapping_missing" });
    expect(planSiriusIdOwnership(snapshot({ idMapPresent: false })).hardBlockers).toBeGreaterThanOrEqual(1);
  });

  it("blocks inverse worker-map ambiguity before considering a correct number or rekey", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [{
        id: "multiply-mapped", siriusId: 100, data: null,
        workerMappings: [
          { sourceNid: 10, stub: false, loader: "contacts-workers" },
          { sourceNid: 11, stub: false, loader: "contacts-workers" },
        ],
        shellMappings: [],
      }],
    }));
    expect(plan.hardBlockers).toBe(2);
    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      "blocked_mapping_ambiguous", "blocked_mapping_ambiguous",
    ]);
    expect(plan.rekeys).toEqual([]);
  });

  it("displaces only a proven generated shell and reserves every staged source ID", () => {
    const state = snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [{
        id: "shell", siriusId: 100, data: { migrationShell: true },
        workerMappings: [],
        shellMappings: [{ sourceNid: 99, stub: false, loader: "relationships" }],
      }],
    });
    const plan = planSiriusIdOwnership(state);
    expect(plan.hardBlockers).toBe(0);
    expect(plan.decisions[0]).toMatchObject({ action: "displace_generated", currentOwnerWorkerId: "shell" });
    expect(plan.rekeys).toEqual([{
      workerId: "shell", fromSiriusId: 100, toSiriusId: 102,
      reason: "displace_generated", sourceNid: 10,
    }]);
    expect(projectSiriusIdOwnershipEvidence(state, plan)[0]).toMatchObject({
      claimant: null,
      owner: {
        workerId: "shell",
        migrationShell: true,
        generatedAllocation: true,
        shellMappings: [{ sourceNid: 99, loader: "relationships" }],
        currentSourceEntitlements: [],
      },
    });
  });

  it("refuses to displace an unproven or native owner", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{ id: "native", siriusId: 100, data: { migrationShell: true }, workerMappings: [], shellMappings: [] }],
    }));
    expect(plan.decisions[0]).toMatchObject({ action: "blocked_owner_native", currentOwnerWorkerId: "native" });
    expect(plan.rekeys).toEqual([]);
  });

  it("refuses a mapped-owner swap without explicit review and makes the approval hash order-independent", () => {
    const state = snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [
        { id: "a", siriusId: 101, data: null, workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }], shellMappings: [] },
        { id: "b", siriusId: 100, data: null, workerMappings: [{ sourceNid: 11, stub: false, loader: "contacts-workers" }], shellMappings: [] },
      ],
    });
    const first = planSiriusIdOwnership(state);
    const second = planSiriusIdOwnership(snapshot({ ...state, workers: [...state.workers].reverse() }));
    expect(first.decisions.map((decision) => decision.action)).toEqual([
      "blocked_owner_entitlement_unknown", "blocked_owner_entitlement_unknown",
    ]);
    expect(first.rekeys).toEqual([]);
    expect(siriusIdPlanHash(first)).toBe(siriusIdPlanHash(second));
  });

  it("blocks missing, non-numeric, and out-of-range source IDs without generating replacements", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: null, siriusId: null, sourceIdProblem: "missing" },
        { sourceNid: 11, rawSiriusId: "bad", siriusId: null, sourceIdProblem: "non_numeric" },
        { sourceNid: 12, rawSiriusId: "2147483648", siriusId: null, sourceIdProblem: "out_of_range" },
      ],
    }));
    expect(plan.hardBlockers).toBe(3);
    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      "source_id_missing", "source_id_non_numeric", "source_id_out_of_range",
    ]);
    expect(plan.rekeys).toEqual([]);
  });

  it("projects mapped workers' current staged entitlement without exposing worker data", () => {
    const state = snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "mapped", siriusId: 100,
        data: { migrationSiriusIdAllocation: { kind: "authoritative" }, private: "not projected" },
        workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }],
        shellMappings: [],
      }],
    });
    const evidence = projectSiriusIdOwnershipEvidence(state, planSiriusIdOwnership(state));
    expect(evidence[0]?.claimant).toEqual({
      workerId: "mapped",
      siriusId: 100,
      workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }],
      shellMappings: [],
      migrationShell: false,
      generatedAllocation: false,
      currentSourceEntitlements: [{ sourceNid: 10, siriusId: 100, sourceIdProblem: null }],
    });
  });

  it("uses sequence state and all staged reservations when selecting a shell ID", () => {
    expect(nextRelationshipShellSiriusId([12, 20], [25, 27], 24)).toBe(28);
    // A native insert can consume nextval before waiting on the table lock.
    expect(nextRelationshipShellSiriusId([12], [20], 26)).toBe(27);
    expect(() => nextRelationshipShellSiriusId([], [], 2_147_483_647)).toThrow(/No signed-serial/);
  });

  it("keeps explicit source-NID scope in the approval hash", () => {
    const state = snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [
        { id: "a", siriusId: 101, data: null, workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }], shellMappings: [] },
        { id: "b", siriusId: 100, data: null, workerMappings: [{ sourceNid: 11, stub: false, loader: "contacts-workers" }], shellMappings: [] },
      ],
    });
    const nidScoped = planSiriusIdOwnership(state, undefined, new Set([10, 11]));
    const idScoped = planSiriusIdOwnership(state, new Set([100, 101]));
    const partialNidScope = planSiriusIdOwnership(state, undefined, new Set([10]));
    expect(nidScoped.hardBlockers).toBe(2);
    expect(partialNidScope.decisions[0]).toMatchObject({ action: "blocked_owner_entitlement_unknown" });
    expect(siriusIdPlanHash(nidScoped)).not.toBe(siriusIdPlanHash(idScoped));
    expect(siriusIdPlanHash(nidScoped)).not.toBe(siriusIdPlanHash(partialNidScope));
  });

  it("never displaces a generated-marked owner that has multiple worker mappings", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "claimant", siriusId: 90, data: null,
        workerMappings: [{ sourceNid: 10, stub: false, loader: "contacts-workers" }],
        shellMappings: [],
      }, {
        id: "generated-but-mapped", siriusId: 100,
        data: { migrationSiriusIdAllocation: { kind: "generated" }, migrationShell: true },
        workerMappings: [
          { sourceNid: 99, stub: false, loader: "contacts-workers" },
          { sourceNid: 98, stub: false, loader: "contacts-workers" },
        ],
        shellMappings: [{ sourceNid: 77, stub: false, loader: "relationships" }],
      }],
    }));
    expect(plan.decisions[0]).toMatchObject({
      action: "blocked_owner_mapping_ambiguous",
      claimantWorkerId: "claimant",
      currentOwnerWorkerId: "generated-but-mapped",
    });
    expect(plan.rekeys).toEqual([]);
  });

  it("does not displace a generated-marked owner with even one worker mapping", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "generated-but-mapped", siriusId: 100,
        data: { migrationSiriusIdAllocation: { kind: "generated" } },
        workerMappings: [{ sourceNid: 99, stub: false, loader: "contacts-workers" }],
        shellMappings: [],
      }],
    }));
    expect(plan.decisions[0]).toMatchObject({
      action: "blocked_owner_entitlement_unknown",
      currentOwnerWorkerId: "generated-but-mapped",
    });
    expect(plan.rekeys).toEqual([]);
  });
});