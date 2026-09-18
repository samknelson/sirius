import { describe, expect, it } from "vitest";
import {
  SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
  assertSiriusIdReferenceRetention,
  planSiriusIdOwnership,
  projectSiriusIdOwnershipEvidence,
  siriusIdPlanHash,
  type SiriusIdOwnershipDecision,
  type SiriusIdOwnershipPlan,
  type SiriusIdReferenceRetention,
  type SiriusIdOwnershipSnapshot,
} from "../../server/storage/workers/sirius-id-ownership-plan";
import { projectSiriusIdOwnershipDashboard } from "../../server/modules/s1-migration-dashboard";

const snapshot = (partial: Partial<SiriusIdOwnershipSnapshot>): SiriusIdOwnershipSnapshot => ({
  stagingPresent: true,
  idMapPresent: true,
  claims: [],
  workers: [],
  contactMappings: [{ sourceNid: 91, s2Id: "contact-91", stub: false, loader: "t3t1-contacts-workers" }],
  ...partial,
});

const shell = (id: string, siriusId: number | null, data: Record<string, unknown> | null = {}) => ({
  id,
  siriusId,
  contactId: "contact-91",
  data: data == null ? null : { migrationShell: true, s1ContactNid: 91, ...data },
  workerMappings: [],
  shellMappings: [{ sourceNid: 91, stub: false, loader: "t15-relationships" }],
});

const decision = (
  sourceNid: number,
  action: SiriusIdOwnershipDecision["action"],
): SiriusIdOwnershipDecision => ({
  sourceNid,
  siriusId: sourceNid,
  action,
  claimantWorkerId: null,
  currentOwnerWorkerId: null,
  detail: action,
});

const dashboardPlan = (
  decisions: SiriusIdOwnershipDecision[],
  partial: Partial<SiriusIdOwnershipPlan> = {},
): SiriusIdOwnershipPlan => ({
  planVersion: SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
  evidenceDigest: "dashboard-test-evidence",
  snapshotPresent: true,
  scope: {
    siriusIds: null,
    sourceNids: null,
    retireShells: false,
    allShells: false,
    shellWorkerIds: null,
  },
  decisions,
  rekeys: [],
  reservations: [],
  hardBlockers: 0,
  pendingRekeys: 0,
  ...partial,
});

describe("Sirius ID ownership planner", () => {
  it("uses an exact worker mapping, not a matching number, to confirm ownership", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "mapped", siriusId: 100, data: null,
        workerMappings: [{ sourceNid: 10, stub: false, loader: "t3t1-contacts-workers" }],
        shellMappings: [],
      }],
    }));
    expect(plan.decisions).toMatchObject([{ action: "correct", claimantWorkerId: "mapped" }]);
    expect(plan.rekeys).toEqual([]);
  });

  it("retains nullable UUID-only shells in the snapshot without treating NULL as ID zero", () => {
    const plan = planSiriusIdOwnership(snapshot({ workers: [shell("null-shell", null)] }));
    expect(plan.rekeys).toEqual([]);
    expect(plan.decisions).toEqual([]);
  });

  it("requires explicit retirement review before clearing a proven shell for an S1 claim", () => {
    const state = snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [shell("shell", 100)],
    });
    const diagnostic = planSiriusIdOwnership(state);
    expect(diagnostic.decisions[0]).toMatchObject({ action: "blocked_shell_retirement_not_selected" });
    expect(diagnostic.hardBlockers).toBe(1);

    const reviewed = planSiriusIdOwnership(state, undefined, undefined, {
      retireShells: true,
      shellWorkerIds: new Set(["shell"]),
    });
    expect(reviewed.hardBlockers).toBe(0);
    expect(reviewed.rekeys).toEqual([{
      workerId: "shell", fromSiriusId: 100, toSiriusId: null, reason: "retire_shell", sourceNid: 10,
    }]);
  });

  it("allows all-shell review to retire a historic shell without treating ordinary workers as candidates", () => {
    const ordinaryWorker = {
      id: "ordinary-worker",
      siriusId: 666_854,
      contactId: "ordinary-contact",
      data: null,
      workerMappings: [{ sourceNid: 10, stub: false, loader: "t3t1-contacts-workers" }],
      shellMappings: [],
    };
    const state = snapshot({ workers: [ordinaryWorker, shell("historic-shell", 1_009_147)] });
    const plan = planSiriusIdOwnership(state, undefined, undefined, { retireShells: true, allShells: true });
    expect(plan.scope).toMatchObject({ retireShells: true, allShells: true, shellWorkerIds: null });
    expect(plan.decisions).toMatchObject([{ action: "retire_shell", currentOwnerWorkerId: "historic-shell" }]);
    expect(plan.hardBlockers).toBe(0);
    expect(plan.rekeys).toEqual([{
      workerId: "historic-shell", fromSiriusId: 1_009_147, toSiriusId: null, reason: "retire_shell", sourceNid: null,
    }]);
  });

  it("refuses all malformed, ambiguous, mapped, and authoritative shell-like provenance", () => {
    const noMarker = shell("no-marker", 101, null);
    const multipleShellMaps = { ...shell("many-shell-maps", 102), shellMappings: [
      { sourceNid: 92, stub: false, loader: "relationships" },
      { sourceNid: 93, stub: false, loader: "relationships" },
    ] };
    const workerMapped = {
      ...shell("worker-mapped", 103),
      workerMappings: [{ sourceNid: 11, stub: false, loader: "t3t1-contacts-workers" }],
    };
    const authoritative = shell("authoritative", 104, {
      migrationShell: true,
      migrationSiriusIdAllocation: { kind: "authoritative" },
    });
    const malformedAllocation = shell("malformed-allocation", 105, {
      migrationSiriusIdAllocation: { kind: 17 },
    });
    const plan = planSiriusIdOwnership(snapshot({
      workers: [noMarker, multipleShellMaps, workerMapped, authoritative, malformedAllocation],
    }), undefined, undefined, { retireShells: true, allShells: true });
    expect(plan.rekeys).toEqual([]);
    expect(plan.decisions.map((decision) => decision.action)).toEqual([
      "blocked_shell_authoritative_entitlement",
      "blocked_shell_provenance_missing",
      "blocked_shell_provenance_ambiguous",
      "blocked_shell_provenance_missing",
      "blocked_shell_provenance_ambiguous",
    ]);
    expect(plan.hardBlockers).toBe(5);
  });

  it("does not clear a generated marker without independent shell proof", () => {
    const plan = planSiriusIdOwnership(snapshot({
      workers: [{
        id: "generated-only", siriusId: 100, data: { migrationSiriusIdAllocation: { kind: "generated" } },
        workerMappings: [], shellMappings: [],
      }],
    }), undefined, undefined, { retireShells: true, allShells: true });
    expect(plan.decisions[0]).toMatchObject({ action: "blocked_shell_provenance_missing" });
    expect(plan.rekeys).toEqual([]);
  });

  it("requires marker/contact/map agreement and rejects noncanonical or stale shell provenance", () => {
    const markerMismatch = shell("marker-mismatch", 100, { s1ContactNid: 92 });
    const stubMap = {
      ...shell("stub-map", 101),
      shellMappings: [{ sourceNid: 91, stub: true, loader: "t15-relationships" }],
    };
    const wrongContact = { ...shell("wrong-contact", 102), contactId: "different-contact" };
    const plan = planSiriusIdOwnership(snapshot({
      workers: [markerMismatch, stubMap, wrongContact],
    }), undefined, undefined, { retireShells: true, allShells: true });
    expect(plan.rekeys).toEqual([]);
    expect(plan.decisions.map((decision) => decision.action))
      .toEqual(["blocked_shell_provenance_missing", "blocked_shell_provenance_missing", "blocked_shell_provenance_missing"]);
  });

  it("blocks shell retirement when its marked S1 contact now has an authoritative staged worker", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{
        sourceNid: 10, rawSiriusId: "800", siriusId: 800, sourceIdProblem: null,
        contactNid: 91, sourceContactProblem: null,
      }],
      workers: [shell("shell", 100)],
    }), undefined, undefined, { retireShells: true, shellWorkerIds: new Set(["shell"]) });
    expect(plan.decisions).toContainEqual(expect.objectContaining({
      action: "blocked_shell_authoritative_entitlement",
      currentOwnerWorkerId: "shell",
    }));
    expect(plan.rekeys).toEqual([]);
  });

  it("refuses direct retirement where a staged authoritative entitlement exists", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [shell("shell", 100)],
    }), undefined, undefined, { retireShells: true, allShells: true });
    expect(plan.decisions).toMatchObject([
      { action: "retire_shell", sourceNid: 10 },
    ]);
    // The source-claim repair is the only approved route; the all-shell pass
    // does not add a second unreviewed retirement decision.
    expect(plan.rekeys).toHaveLength(1);
  });

  it("uses NULL parking for an exact, fully scoped S1 authoritative swap", () => {
    const state = snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [
        {
          id: "a", siriusId: 101, data: null,
          workerMappings: [{ sourceNid: 10, stub: false, loader: "t3t1-contacts-workers" }], shellMappings: [],
        },
        {
          id: "b", siriusId: 100, data: null,
          workerMappings: [{ sourceNid: 11, stub: false, loader: "t3t1-contacts-workers" }], shellMappings: [],
        },
      ],
    });
    const plan = planSiriusIdOwnership(state, undefined, new Set([10, 11]));
    expect(plan.hardBlockers).toBe(0);
    expect(plan.rekeys).toEqual([
      { workerId: "a", fromSiriusId: 101, toSiriusId: 100, reason: "mapped_rekey", sourceNid: 10 },
      { workerId: "b", fromSiriusId: 100, toSiriusId: 101, reason: "mapped_rekey", sourceNid: 11 },
    ]);
  });

  it("does not rekey an exact owner outside the approved source scope", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [
        { sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null },
        { sourceNid: 11, rawSiriusId: "101", siriusId: 101, sourceIdProblem: null },
      ],
      workers: [
        { id: "a", siriusId: 101, data: null, workerMappings: [{ sourceNid: 10, stub: false, loader: "t3t1-contacts-workers" }], shellMappings: [] },
        { id: "b", siriusId: 100, data: null, workerMappings: [{ sourceNid: 11, stub: false, loader: "t3t1-contacts-workers" }], shellMappings: [] },
      ],
    }), undefined, new Set([10]));
    expect(plan.decisions[0]).toMatchObject({ action: "blocked_owner_outside_scope" });
    expect(plan.rekeys).toEqual([]);
  });

  it("refuses a stub or noncanonical worker mapping as exact rekey proof", () => {
    const plan = planSiriusIdOwnership(snapshot({
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
      workers: [{
        id: "stub-worker", siriusId: 90, data: null,
        workerMappings: [{ sourceNid: 10, stub: true, loader: "t3t1-contacts-workers" }],
        shellMappings: [],
      }],
    }));
    expect(plan.decisions[0]).toMatchObject({ action: "blocked_mapping_ambiguous" });
    expect(plan.rekeys).toEqual([]);
  });

  it("includes explicit shell selection and the v2 version in the approval hash", () => {
    const state = snapshot({ workers: [shell("shell-b", 102), shell("shell-a", 101)] });
    const all = planSiriusIdOwnership(state, undefined, undefined, { retireShells: true, allShells: true });
    const one = planSiriusIdOwnership(state, undefined, undefined, {
      retireShells: true, shellWorkerIds: new Set(["shell-a"]),
    });
    expect(all.planVersion).toBe(SIRIUS_ID_OWNERSHIP_PLAN_VERSION);
    expect(siriusIdPlanHash(all)).not.toBe(siriusIdPlanHash(one));
    expect(siriusIdPlanHash(all)).toBe(siriusIdPlanHash(planSiriusIdOwnership(
      snapshot({ workers: [...state.workers].reverse() }),
      undefined,
      undefined,
      { retireShells: true, allShells: true },
    )));
  });

  it("changes the approval hash when a reviewed shell UUID set or source state becomes stale", () => {
    const current = snapshot({ workers: [shell("shell-a", 101)] });
    const reviewed = planSiriusIdOwnership(current, undefined, undefined, {
      retireShells: true, allShells: true,
    });
    const shellSetChanged = planSiriusIdOwnership(snapshot({
      workers: [shell("shell-a", 101), shell("shell-b", 102)],
    }), undefined, undefined, { retireShells: true, allShells: true });
    const sidChanged = planSiriusIdOwnership(snapshot({ workers: [shell("shell-a", 102)] }),
      undefined, undefined, { retireShells: true, allShells: true });
    expect(siriusIdPlanHash(shellSetChanged)).not.toBe(siriusIdPlanHash(reviewed));
    expect(siriusIdPlanHash(sidChanged)).not.toBe(siriusIdPlanHash(reviewed));
  });

  it("blocks the whole exact shell scope when any requested UUID is missing or already retired", () => {
    const plan = planSiriusIdOwnership(snapshot({
      workers: [shell("valid-shell", 101), shell("already-retired", null)],
    }), undefined, undefined, {
      retireShells: true,
      shellWorkerIds: new Set(["valid-shell", "already-retired", "missing-shell"]),
    });

    expect(plan.rekeys).toEqual([{
      workerId: "valid-shell", fromSiriusId: 101, toSiriusId: null, reason: "retire_shell", sourceNid: null,
    }]);
    expect(plan.decisions.filter((decision) => decision.action === "blocked_shell_selection_missing"))
      .toMatchObject([
        { currentOwnerWorkerId: "already-retired" },
        { currentOwnerWorkerId: "missing-shell" },
      ]);
    expect(plan.hardBlockers).toBe(2);
  });

  it("binds a retirement hash to reviewed contact and mapping provenance even when its action is unchanged", () => {
    const original = snapshot({ workers: [shell("shell-a", 101)] });
    const retargeted = snapshot({
      workers: [{
        ...shell("shell-a", 101, { s1ContactNid: 92 }),
        contactId: "contact-92",
        shellMappings: [{ sourceNid: 92, stub: false, loader: "t15-relationships" }],
      }],
      contactMappings: [{ sourceNid: 92, s2Id: "contact-92", stub: false, loader: "t3t1-contacts-workers" }],
    });
    const originalPlan = planSiriusIdOwnership(original, undefined, undefined, {
      retireShells: true, shellWorkerIds: new Set(["shell-a"]),
    });
    const retargetedPlan = planSiriusIdOwnership(retargeted, undefined, undefined, {
      retireShells: true, shellWorkerIds: new Set(["shell-a"]),
    });
    expect(originalPlan.decisions.map((decision) => decision.action)).toEqual(["retire_shell"]);
    expect(retargetedPlan.decisions.map((decision) => decision.action)).toEqual(["retire_shell"]);
    expect(originalPlan.rekeys).toEqual(retargetedPlan.rekeys);
    expect(originalPlan.evidenceDigest).not.toBe(retargetedPlan.evidenceDigest);
    expect(siriusIdPlanHash(originalPlan)).not.toBe(siriusIdPlanHash(retargetedPlan));
  });

  it("rejects any per-UUID FK retention drift before a repair transaction can commit", () => {
    const before: SiriusIdReferenceRetention = {
      workerRows: [{ workerId: "shell-a", rows: 1 }, { workerId: "shell-b", rows: 1 }],
      foreignKeyReferences: [{
        constraintName: "relations_worker_fk",
        table: "public.worker_relations",
        column: "worker_2",
        byWorker: [
          { workerId: "shell-a", rows: 1, rowIdentityHash: "a" },
          { workerId: "shell-b", rows: 1, rowIdentityHash: "b" },
        ],
      }],
    };
    expect(() => assertSiriusIdReferenceRetention(before, structuredClone(before))).not.toThrow();
    const moved = structuredClone(before);
    moved.foreignKeyReferences[0].byWorker = [
      { workerId: "shell-a", rows: 0, rowIdentityHash: "" },
      { workerId: "shell-b", rows: 2, rowIdentityHash: "a,b" },
    ];
    expect(() => assertSiriusIdReferenceRetention(before, moved))
      .toThrow(/foreign-key reference retention changed/);
  });

  it("projects proof state without exposing worker data", () => {
    const state = snapshot({ workers: [shell("shell", 100, {
      migrationShell: true, private: "not projected",
    })] });
    const plan = planSiriusIdOwnership(state, undefined, undefined, {
      retireShells: true, shellWorkerIds: new Set(["shell"]),
    });
    expect(projectSiriusIdOwnershipEvidence(state, plan)[0]?.owner).toMatchObject({
      workerId: "shell",
      migrationShell: true,
      shellProof: "proven",
      shellMappings: [{ sourceNid: 91, loader: "t15-relationships" }],
    });
    expect(JSON.stringify(projectSiriusIdOwnershipEvidence(state, plan))).not.toContain("not projected");
  });

  it("keeps a blocker visible after more than 200 healthy ownership decisions", () => {
    const decisions = [
      ...Array.from({ length: 201 }, (_, i) => decision(i + 1, "correct")),
      decision(202, "blocked_owner_native"),
    ];
    const projection = projectSiriusIdOwnershipDashboard(snapshot({}), dashboardPlan(decisions, {
      hardBlockers: 1,
    }));

    expect(projection.decisions).toEqual([
      expect.objectContaining({ sourceNid: 202, action: "blocked_owner_native" }),
    ]);
    expect(projection.decisionsTruncated).toBe(false);
  });

  it("truncates only when the full plan contains more than 200 issue decisions", () => {
    const healthy = [decision(1, "correct"), decision(2, "new_claim_reserved")];
    const issues = Array.from({ length: 201 }, (_, i) => decision(i + 3, "source_id_missing"));
    const exactly200 = projectSiriusIdOwnershipDashboard(
      snapshot({}),
      dashboardPlan([...healthy, ...issues.slice(0, 200)]),
    );
    const moreThan200 = projectSiriusIdOwnershipDashboard(
      snapshot({}),
      dashboardPlan([...healthy, ...issues]),
    );

    expect(exactly200.decisions).toHaveLength(200);
    expect(exactly200.decisionsTruncated).toBe(false);
    expect(moreThan200.decisions).toHaveLength(200);
    expect(moreThan200.decisionsTruncated).toBe(true);
  });

  it("omits clean decisions while preserving full-plan counts, totals, and hash", () => {
    const decisions = [
      decision(1, "correct"),
      decision(2, "correct"),
      decision(3, "new_claim_reserved"),
      decision(4, "mapped_rekey"),
      decision(5, "blocked_mapping_missing"),
    ];
    const plan = dashboardPlan(decisions, {
      hardBlockers: 1,
      pendingRekeys: 7,
      rekeys: [{
        workerId: "worker-4",
        fromSiriusId: 40,
        toSiriusId: 4,
        reason: "mapped_rekey",
        sourceNid: 4,
      }],
    });
    const projection = projectSiriusIdOwnershipDashboard(snapshot({}), plan);

    expect(projection.decisions.map(({ action }) => action))
      .toEqual(["mapped_rekey", "blocked_mapping_missing"]);
    expect(projection.actionCounts).toEqual({
      correct: 2,
      new_claim_reserved: 1,
      mapped_rekey: 1,
      blocked_mapping_missing: 1,
    });
    expect(projection.hardBlockers).toBe(1);
    expect(projection.pendingRekeys).toBe(7);
    expect(projection.planHash).toBe(siriusIdPlanHash(plan));
  });

  it("preserves the missing-staging dashboard response semantics", () => {
    expect(projectSiriusIdOwnershipDashboard(snapshot({
      stagingPresent: false,
      idMapPresent: false,
      claims: [{ sourceNid: 10, rawSiriusId: "100", siriusId: 100, sourceIdProblem: null }],
    }), null)).toEqual({
      stagingPresent: false,
      idMapPresent: false,
      stagedClaims: 0,
      decisions: [],
      decisionsTruncated: false,
      actionCounts: {},
      hardBlockers: 1,
      pendingRekeys: 0,
      planHash: null,
    });
  });
});