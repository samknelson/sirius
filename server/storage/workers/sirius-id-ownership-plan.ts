import { createHash } from "node:crypto";

/** Hashes from the numeric-displacement planner are deliberately incompatible. */
export const SIRIUS_ID_OWNERSHIP_PLAN_VERSION = "s1-sirius-id-ownership-v2-null-shell-retirement";

export interface SiriusIdClaim {
  sourceNid: number;
  rawSiriusId: string | null;
  siriusId: number | null;
  sourceIdProblem: "missing" | "non_numeric" | "out_of_range" | null;
  /** Staged S1 worker -> contact relationship. This is provenance, never a name match. */
  contactNid?: number | null;
  sourceContactProblem?: "missing" | "non_numeric" | "out_of_range" | null;
}

export interface SiriusIdWorker {
  id: string;
  /** Relationship shells may intentionally have no local numeric ID. */
  siriusId: number | null;
  /** UUID of the target contact, required to verify a relationship shell. */
  contactId?: string | null;
  data: Record<string, unknown> | null;
  workerMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  shellMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
}

export interface SiriusIdOwnershipSnapshot {
  stagingPresent: boolean;
  idMapPresent: boolean;
  claims: SiriusIdClaim[];
  workers: SiriusIdWorker[];
  contactMappings?: Array<{ sourceNid: number; s2Id: string; stub: boolean; loader: string }>;
}

export interface SiriusIdOwnershipPlanOptions {
  /** Existing numeric shell IDs are never selected unless this is explicit. */
  retireShells?: boolean;
  /** Select every shell candidate for diagnostic/review. Requires retireShells. */
  allShells?: boolean;
  /** Exact UUID selection for an evidence-reviewed shell retirement. */
  shellWorkerIds?: ReadonlySet<string>;
}

export type SiriusIdOwnershipAction =
  | "correct"
  | "new_claim_reserved"
  | "mapped_rekey"
  | "retire_shell"
  | "source_duplicate"
  | "source_id_missing"
  | "source_id_non_numeric"
  | "source_id_out_of_range"
  | "blocked_mapping_missing"
  | "blocked_mapping_ambiguous"
  | "blocked_owner_native"
  | "blocked_owner_mapping_ambiguous"
  | "blocked_owner_entitlement_unknown"
  | "blocked_owner_outside_scope"
  | "blocked_shell_retirement_not_selected"
  | "blocked_shell_selection_missing"
  | "blocked_shell_provenance_missing"
  | "blocked_shell_provenance_ambiguous"
  | "blocked_shell_authoritative_entitlement";

export interface SiriusIdRekey {
  workerId: string;
  fromSiriusId: number | null;
  /** NULL is intentional parking for a shell or for an exact authoritative swap. */
  toSiriusId: number | null;
  reason: "mapped_rekey" | "retire_shell";
  sourceNid: number | null;
}

export interface SiriusIdOwnershipDecision {
  sourceNid: number | null;
  siriusId: number | null;
  action: SiriusIdOwnershipAction;
  claimantWorkerId: string | null;
  currentOwnerWorkerId: string | null;
  detail: string;
}

export interface SiriusIdOwnershipPlan {
  planVersion: typeof SIRIUS_ID_OWNERSHIP_PLAN_VERSION;
  /** Hash of only reviewed, sanitized provenance evidence (never worker data). */
  evidenceDigest: string;
  snapshotPresent: boolean;
  scope: {
    siriusIds: number[] | null;
    sourceNids: number[] | null;
    retireShells: boolean;
    allShells: boolean;
    shellWorkerIds: string[] | null;
  };
  decisions: SiriusIdOwnershipDecision[];
  rekeys: SiriusIdRekey[];
  reservations: number[];
  hardBlockers: number;
  pendingRekeys: number;
}

export interface SiriusIdWorkerEvidence {
  workerId: string;
  siriusId: number | null;
  contactId: string | null;
  shellContactNid: number | null;
  workerMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  shellMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  migrationShell: boolean;
  /** Retained for audit compatibility; it is never proof by itself. */
  generatedAllocation: boolean;
  authoritativeAllocation: boolean;
  shellProof: "proven" | "missing_marker_or_mapping" | "ambiguous_mapping" | "marker_contact_mismatch" | "noncanonical_mapping" | "contact_mapping_unknown" | "has_worker_mapping" | "authoritative_allocation" | "allocation_invalid";
  currentSourceEntitlements: Array<{
    sourceNid: number;
    siriusId: number | null;
    sourceIdProblem: "missing" | "non_numeric" | "out_of_range" | null;
  }>;
  /** Any current staged worker tied to this shell's exact S1 contact. */
  sourceContactEntitlements: Array<{
    sourceNid: number;
    siriusId: number | null;
    sourceIdProblem: "missing" | "non_numeric" | "out_of_range" | null;
    sourceContactProblem: "missing" | "non_numeric" | "out_of_range" | null;
  }>;
}

export interface SiriusIdDecisionEvidence {
  decision: SiriusIdOwnershipDecision;
  claimant: SiriusIdWorkerEvidence | null;
  owner: SiriusIdWorkerEvidence | null;
}

/** Sanitized per-UUID FK evidence used by the transactional applier. */
export interface SiriusIdReferenceRetention {
  workerRows: Array<{ workerId: string; rows: number }>;
  foreignKeyReferences: Array<{
    constraintName: string;
    table: string;
    column: string;
    byWorker: Array<{ workerId: string; rows: number; rowIdentityHash: string }>;
  }>;
}

/** Kept pure so this rollback guard has a focused, database-free regression test. */
export function assertSiriusIdReferenceRetention(
  before: SiriusIdReferenceRetention,
  after: SiriusIdReferenceRetention,
): asserts after is SiriusIdReferenceRetention {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Worker UUID or foreign-key reference retention changed during repair; no changes were committed.");
  }
}

function allocationKind(worker: SiriusIdWorker): string | null {
  const allocation = worker.data?.migrationSiriusIdAllocation;
  return allocation && typeof allocation === "object" && typeof (allocation as Record<string, unknown>).kind === "string"
    ? (allocation as Record<string, unknown>).kind as string
    : null;
}

function markerContactNid(worker: SiriusIdWorker): number | null {
  const nid = worker.data?.s1ContactNid;
  return typeof nid === "number" && Number.isSafeInteger(nid) && nid > 0 ? nid : null;
}

function allocationIsInvalid(worker: SiriusIdWorker): boolean {
  const allocation = worker.data?.migrationSiriusIdAllocation;
  if (allocation == null) return false;
  const kind = allocationKind(worker);
  return kind == null || !["generated", "relationship-shell", "authoritative"].includes(kind);
}

function isShellCandidate(worker: SiriusIdWorker): boolean {
  return worker.data?.migrationShell === true ||
    worker.shellMappings.length > 0 ||
    Object.prototype.hasOwnProperty.call(worker.data ?? {}, "migrationSiriusIdAllocation");
}

function isCanonicalWorkerMapping(mapping: { stub: boolean; loader: string }): boolean {
  return !mapping.stub && mapping.loader === "t3t1-contacts-workers";
}

function shellProof(
  worker: SiriusIdWorker,
  contactMappings: NonNullable<SiriusIdOwnershipSnapshot["contactMappings"]>,
): SiriusIdWorkerEvidence["shellProof"] {
  if (worker.data?.migrationShell !== true || worker.shellMappings.length === 0) return "missing_marker_or_mapping";
  if (worker.shellMappings.length !== 1) return "ambiguous_mapping";
  if (worker.workerMappings.length !== 0) return "has_worker_mapping";
  const contactNid = markerContactNid(worker);
  if (contactNid == null) return "missing_marker_or_mapping";
  const shellMapping = worker.shellMappings[0];
  if (shellMapping.sourceNid !== contactNid) return "marker_contact_mismatch";
  if (shellMapping.stub || shellMapping.loader !== "t15-relationships") return "noncanonical_mapping";
  const mappedContacts = contactMappings.filter((mapping) => mapping.sourceNid === contactNid);
  if (
    mappedContacts.length !== 1 ||
    mappedContacts[0].stub ||
    mappedContacts[0].loader !== "t3t1-contacts-workers" ||
    worker.contactId == null ||
    mappedContacts[0].s2Id !== worker.contactId
  ) return "contact_mapping_unknown";
  if (allocationKind(worker) === "authoritative") return "authoritative_allocation";
  if (allocationIsInvalid(worker)) return "allocation_invalid";
  return "proven";
}

function isProvenShell(
  worker: SiriusIdWorker,
  contactMappings: NonNullable<SiriusIdOwnershipSnapshot["contactMappings"]>,
): boolean {
  return worker.siriusId != null && shellProof(worker, contactMappings) === "proven";
}

function isHardBlocker(action: SiriusIdOwnershipAction): boolean {
  return action === "source_duplicate" || action.startsWith("source_id_") || action.startsWith("blocked_");
}

/** Sanitized evidence only: UUIDs, source node IDs, and loader/provenance flags. */
export function projectSiriusIdOwnershipEvidence(
  snapshot: SiriusIdOwnershipSnapshot,
  plan: SiriusIdOwnershipPlan,
): SiriusIdDecisionEvidence[] {
  const workerById = new Map(snapshot.workers.map((worker) => [worker.id, worker]));
  const claimByNid = new Map(snapshot.claims.map((claim) => [claim.sourceNid, claim]));
  const project = (workerId: string | null): SiriusIdWorkerEvidence | null => {
    if (workerId == null) return null;
    const worker = workerById.get(workerId);
    if (!worker) return null;
    const kind = allocationKind(worker);
    return {
      workerId: worker.id,
      siriusId: worker.siriusId,
      contactId: worker.contactId ?? null,
      shellContactNid: markerContactNid(worker),
      workerMappings: worker.workerMappings.map((mapping) => ({ ...mapping })),
      shellMappings: worker.shellMappings.map((mapping) => ({ ...mapping })),
      migrationShell: worker.data?.migrationShell === true,
      generatedAllocation: kind === "generated",
      authoritativeAllocation: kind === "authoritative",
      shellProof: shellProof(worker, snapshot.contactMappings ?? []),
      currentSourceEntitlements: worker.workerMappings
        .map((mapping) => claimByNid.get(mapping.sourceNid))
        .filter((claim): claim is SiriusIdClaim => claim != null)
        .map((claim) => ({
          sourceNid: claim.sourceNid,
          siriusId: claim.siriusId,
          sourceIdProblem: claim.sourceIdProblem,
        })),
      sourceContactEntitlements: markerContactNid(worker) == null ? [] : snapshot.claims
        .filter((claim) => claim.contactNid === markerContactNid(worker))
        .map((claim) => ({
          sourceNid: claim.sourceNid,
          siriusId: claim.siriusId,
          sourceIdProblem: claim.sourceIdProblem,
          sourceContactProblem: claim.sourceContactProblem ?? "missing",
        })),
    };
  };
  return plan.decisions.map((decision) => ({
    decision,
    claimant: project(decision.claimantWorkerId),
    owner: project(decision.currentOwnerWorkerId),
  }));
}

function sortedMappings(mappings: Array<{ sourceNid: number; stub: boolean; loader: string }>) {
  return mappings
    .map(({ sourceNid, stub, loader }) => ({ sourceNid, stub, loader }))
    .sort((a, b) => a.sourceNid - b.sourceNid || a.loader.localeCompare(b.loader) || Number(a.stub) - Number(b.stub));
}

/** Evidence digest for exactly the claimants/owners an operator reviews. It
 * intentionally excludes raw source values and arbitrary worker data. */
function reviewedEvidenceDigest(
  snapshot: SiriusIdOwnershipSnapshot,
  decisions: readonly SiriusIdOwnershipDecision[],
): string {
  const workers = new Map(snapshot.workers.map((worker) => [worker.id, worker]));
  const contactMappings = snapshot.contactMappings ?? [];
  const reviewWorker = (workerId: string | null) => {
    if (workerId == null) return null;
    const worker = workers.get(workerId);
    if (!worker) return { workerId, missing: true };
    const shellContactNid = markerContactNid(worker);
    return {
      workerId: worker.id,
      siriusId: worker.siriusId,
      contactId: worker.contactId ?? null,
      migrationShell: worker.data?.migrationShell === true,
      shellContactNid,
      allocationKind: allocationKind(worker),
      allocationInvalid: allocationIsInvalid(worker),
      shellProof: shellProof(worker, contactMappings),
      workerMappings: sortedMappings(worker.workerMappings),
      shellMappings: sortedMappings(worker.shellMappings),
      contactMappings: shellContactNid == null ? [] : contactMappings
        .filter((mapping) => mapping.sourceNid === shellContactNid)
        .map(({ sourceNid, s2Id, stub, loader }) => ({ sourceNid, s2Id, stub, loader }))
        .sort((a, b) => a.s2Id.localeCompare(b.s2Id) || a.loader.localeCompare(b.loader) || Number(a.stub) - Number(b.stub)),
      sourceContactEntitlements: shellContactNid == null ? [] : snapshot.claims
        .filter((claim) => claim.contactNid === shellContactNid)
        .map(({ sourceNid, siriusId, sourceIdProblem, contactNid, sourceContactProblem }) => ({
          sourceNid, siriusId, sourceIdProblem, contactNid, sourceContactProblem: sourceContactProblem ?? "missing",
        }))
        .sort((a, b) => a.sourceNid - b.sourceNid),
    };
  };
  const selectedSourceNids = new Set(decisions.flatMap((decision) => decision.sourceNid == null ? [] : [decision.sourceNid]));
  const payload = {
    selectedClaims: snapshot.claims
      .filter((claim) => selectedSourceNids.has(claim.sourceNid))
      .map(({ sourceNid, siriusId, sourceIdProblem, contactNid, sourceContactProblem }) => ({
        sourceNid, siriusId, sourceIdProblem, contactNid, sourceContactProblem: sourceContactProblem ?? "missing",
      }))
      .sort((a, b) => a.sourceNid - b.sourceNid),
    decisionWorkers: decisions
      .map((decision) => ({
        sourceNid: decision.sourceNid,
        siriusId: decision.siriusId,
        claimant: reviewWorker(decision.claimantWorkerId),
        owner: reviewWorker(decision.currentOwnerWorkerId),
      }))
      .sort((a, b) => (a.siriusId ?? Number.MAX_SAFE_INTEGER) - (b.siriusId ?? Number.MAX_SAFE_INTEGER)
        || (a.sourceNid ?? Number.MAX_SAFE_INTEGER) - (b.sourceNid ?? Number.MAX_SAFE_INTEGER)
        || JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Deterministic, JSON-safe approval token. Plan-version inclusion retires v1 hashes. */
export function siriusIdPlanHash(plan: SiriusIdOwnershipPlan): string {
  const payload = {
    planVersion: SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
    evidenceDigest: plan.evidenceDigest,
    snapshotPresent: plan.snapshotPresent,
    scope: plan.scope,
    decisions: [...plan.decisions]
      .sort((a, b) => (a.siriusId ?? Number.MAX_SAFE_INTEGER) - (b.siriusId ?? Number.MAX_SAFE_INTEGER)
        || (a.sourceNid ?? Number.MAX_SAFE_INTEGER) - (b.sourceNid ?? Number.MAX_SAFE_INTEGER)
        || (a.currentOwnerWorkerId ?? "").localeCompare(b.currentOwnerWorkerId ?? ""))
      .map(({ sourceNid, siriusId, action, claimantWorkerId, currentOwnerWorkerId }) => ({
        sourceNid, siriusId, action, claimantWorkerId, currentOwnerWorkerId,
      })),
    rekeys: [...plan.rekeys]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map(({ workerId, fromSiriusId, toSiriusId, reason, sourceNid }) => ({
        workerId, fromSiriusId, toSiriusId, reason, sourceNid,
      })),
    reservations: [...plan.reservations].sort((a, b) => a - b),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Conservative planner for source ownership and explicit existing-shell
 * retirement. It never invents an ID. A numeric rekey is only a rekey to the
 * current exact S1 entitlement; every temporary state during apply is NULL.
 */
export function planSiriusIdOwnership(
  snapshot: SiriusIdOwnershipSnapshot,
  scopeSiriusIds?: ReadonlySet<number>,
  scopeSourceNids?: ReadonlySet<number>,
  options: SiriusIdOwnershipPlanOptions = {},
): SiriusIdOwnershipPlan {
  if (options.allShells && !options.retireShells) {
    throw new Error("allShells requires explicit retireShells evidence-review mode.");
  }
  if (options.shellWorkerIds && !options.retireShells) {
    throw new Error("shellWorkerIds requires explicit retireShells evidence-review mode.");
  }
  const reservations = [...new Set(snapshot.claims.flatMap((claim) => claim.siriusId == null ? [] : [claim.siriusId]))]
    .sort((a, b) => a - b);
  const scope = {
    siriusIds: scopeSiriusIds == null ? null : [...scopeSiriusIds].sort((a, b) => a - b),
    sourceNids: scopeSourceNids == null ? null : [...scopeSourceNids].sort((a, b) => a - b),
    retireShells: options.retireShells === true,
    allShells: options.allShells === true,
    shellWorkerIds: options.shellWorkerIds == null ? null : [...options.shellWorkerIds].sort(),
  };
  if (!snapshot.stagingPresent) {
    const decisions: SiriusIdOwnershipDecision[] = [];
    return {
      planVersion: SIRIUS_ID_OWNERSHIP_PLAN_VERSION, snapshotPresent: false, scope,
      evidenceDigest: reviewedEvidenceDigest(snapshot, decisions),
      decisions, rekeys: [], reservations, hardBlockers: 1, pendingRekeys: 0,
    };
  }

  const claimsById = new Map<number, SiriusIdClaim[]>();
  const claimByNid = new Map<number, SiriusIdClaim>();
  for (const claim of snapshot.claims) {
    claimByNid.set(claim.sourceNid, claim);
    if (claim.siriusId != null) claimsById.set(claim.siriusId, [...(claimsById.get(claim.siriusId) ?? []), claim]);
  }
  const ownerBySiriusId = new Map<number, SiriusIdWorker>();
  for (const worker of snapshot.workers) if (worker.siriusId != null) ownerBySiriusId.set(worker.siriusId, worker);
  const mappedWorkerBySource = new Map<number, SiriusIdWorker[]>();
  for (const worker of snapshot.workers) for (const mapping of worker.workerMappings) {
    mappedWorkerBySource.set(mapping.sourceNid, [...(mappedWorkerBySource.get(mapping.sourceNid) ?? []), worker]);
  }
  const sourceInScope = (sourceNid: number) =>
    scopeSourceNids == null || scopeSourceNids.has(sourceNid);
  const contactMappings = snapshot.contactMappings ?? [];
  const shellRetirementSelected = (worker: SiriusIdWorker) =>
    options.allShells === true || options.shellWorkerIds?.has(worker.id) === true;
  const shellHasCurrentSourceWorker = (worker: SiriusIdWorker) => {
    const contactNid = markerContactNid(worker);
    return contactNid != null && snapshot.claims.some((claim) => claim.contactNid === contactNid);
  };
  const isSelected = (claim: SiriusIdClaim): boolean =>
    (scopeSiriusIds == null && scopeSourceNids == null) ||
    (claim.siriusId != null && scopeSiriusIds?.has(claim.siriusId) === true) ||
    scopeSourceNids?.has(claim.sourceNid) === true;
  const decisions: SiriusIdOwnershipDecision[] = [];
  const requestedRekeys = new Map<string, SiriusIdRekey>();
  const decide = (
    sourceNid: number | null, siriusId: number | null, action: SiriusIdOwnershipAction,
    claimantWorkerId: string | null, currentOwnerWorkerId: string | null, detail: string,
  ) => decisions.push({ sourceNid, siriusId, action, claimantWorkerId, currentOwnerWorkerId, detail });

  for (const claim of snapshot.claims.filter(isSelected).sort((a, b) =>
    (a.siriusId ?? Number.MAX_SAFE_INTEGER) - (b.siriusId ?? Number.MAX_SAFE_INTEGER) || a.sourceNid - b.sourceNid,
  )) {
    const claimantMatches = mappedWorkerBySource.get(claim.sourceNid) ?? [];
    if (claim.siriusId == null) {
      decide(claim.sourceNid, null,
        claim.sourceIdProblem === "missing" ? "source_id_missing" :
          claim.sourceIdProblem === "non_numeric" ? "source_id_non_numeric" : "source_id_out_of_range",
        claimantMatches.length === 1 ? claimantMatches[0].id : null, null,
        "S1 did not supply a usable authoritative Sirius ID; no local replacement is allowed.");
      continue;
    }
    if (!snapshot.idMapPresent) {
      decide(claim.sourceNid, claim.siriusId, "blocked_mapping_missing", null, null,
        "The S1 worker mapping table is unavailable, so exact source ownership cannot be proven.");
      continue;
    }
    if ((claimsById.get(claim.siriusId) ?? []).length !== 1) {
      decide(claim.sourceNid, claim.siriusId, "source_duplicate", null, null,
        "S1 has more than one staged claimant for this Sirius ID.");
      continue;
    }
    if (claimantMatches.length > 1) {
      decide(claim.sourceNid, claim.siriusId, "blocked_mapping_ambiguous", null, null,
        "The exact S1 worker mapping points to multiple S2 workers.");
      continue;
    }
    const claimant = claimantMatches[0] ?? null;
    if (
      claimant &&
      (claimant.workerMappings.length !== 1 ||
        claimant.workerMappings[0].sourceNid !== claim.sourceNid ||
        !isCanonicalWorkerMapping(claimant.workerMappings[0]))
    ) {
      decide(claim.sourceNid, claim.siriusId, "blocked_mapping_ambiguous", claimant.id, null,
        "The mapped S2 worker does not have one canonical, non-stub S1 worker mapping; exact source ownership is ambiguous.");
      continue;
    }
    const owner = ownerBySiriusId.get(claim.siriusId) ?? null;
    if (!claimant) {
      if (!owner) decide(claim.sourceNid, claim.siriusId, "new_claim_reserved", null, null,
        "No S2 row owns this authoritative ID; reserve it for the new staged worker.");
      else if (isProvenShell(owner, contactMappings) && shellHasCurrentSourceWorker(owner)) {
        decide(claim.sourceNid, claim.siriusId, "blocked_shell_authoritative_entitlement", null, owner.id,
          "The shell contact now has a staged S1 worker; relationship resolution must retarget it before retirement.");
      } else if (isProvenShell(owner, contactMappings) && (!options.retireShells || !shellRetirementSelected(owner))) {
        decide(claim.sourceNid, claim.siriusId, "blocked_shell_retirement_not_selected", null, owner.id,
          "Clearing an existing shell ID requires explicit retirement evidence-review mode and an approved shell UUID scope.");
      } else if (isProvenShell(owner, contactMappings)) {
        requestedRekeys.set(owner.id, {
          workerId: owner.id, fromSiriusId: owner.siriusId!, toSiriusId: null, reason: "retire_shell", sourceNid: claim.sourceNid,
        });
        decide(claim.sourceNid, claim.siriusId, "retire_shell", null, owner.id,
          "The proven relationship shell is cleared to NULL so S1's authoritative ID remains unoccupied.");
      } else {
        decide(claim.sourceNid, claim.siriusId,
          owner.workerMappings.length > 1 ? "blocked_owner_mapping_ambiguous" :
            owner.workerMappings.length === 1 ? "blocked_owner_entitlement_unknown" : "blocked_owner_native",
          null, owner.id, "The current owner is not a proven relationship shell eligible for NULL retirement.");
      }
      continue;
    }
    if (claimant.id === owner?.id || claimant.siriusId === claim.siriusId) {
      decide(claim.sourceNid, claim.siriusId, "correct", claimant.id, owner?.id ?? null,
        "The exact mapped S2 worker already owns the authoritative ID.");
      continue;
    }
    if (owner && isProvenShell(owner, contactMappings) && shellHasCurrentSourceWorker(owner)) {
      decide(claim.sourceNid, claim.siriusId, "blocked_shell_authoritative_entitlement", claimant.id, owner.id,
        "The shell contact now has a staged S1 worker; relationship resolution must retarget it before retirement.");
      continue;
    }
    if (owner && isProvenShell(owner, contactMappings) && (!options.retireShells || !shellRetirementSelected(owner))) {
      decide(claim.sourceNid, claim.siriusId, "blocked_shell_retirement_not_selected", claimant.id, owner.id,
        "Clearing an existing shell ID requires explicit retirement evidence-review mode and an approved shell UUID scope.");
      continue;
    }
    if (owner && isProvenShell(owner, contactMappings)) {
      requestedRekeys.set(owner.id, {
        workerId: owner.id, fromSiriusId: owner.siriusId!, toSiriusId: null, reason: "retire_shell", sourceNid: claim.sourceNid,
      });
    } else if (owner) {
      const ownerMapping = owner.workerMappings.length === 1 && isCanonicalWorkerMapping(owner.workerMappings[0])
        ? owner.workerMappings[0]
        : null;
      const ownerClaim = ownerMapping ? claimByNid.get(ownerMapping.sourceNid) : null;
      if (owner.workerMappings.length > 1) {
        decide(claim.sourceNid, claim.siriusId, "blocked_owner_mapping_ambiguous", claimant.id, owner.id,
          "The current owner has multiple S1 worker mappings.");
        continue;
      }
      if (!ownerMapping || !ownerClaim || ownerClaim.siriusId == null || ownerClaim.sourceIdProblem != null) {
        decide(claim.sourceNid, claim.siriusId, "blocked_owner_entitlement_unknown", claimant.id, owner.id,
          "The current owner has no exact current S1 entitlement proving a safe authoritative rekey.");
        continue;
      }
      if (!sourceInScope(ownerMapping.sourceNid) || !isSelected(ownerClaim)) {
        decide(claim.sourceNid, claim.siriusId, "blocked_owner_outside_scope", claimant.id, owner.id,
          "The occupied ID belongs to an exactly mapped worker outside the approved source-NID scope.");
        continue;
      }
    }
    requestedRekeys.set(claimant.id, {
      workerId: claimant.id, fromSiriusId: claimant.siriusId, toSiriusId: claim.siriusId, reason: "mapped_rekey", sourceNid: claim.sourceNid,
    });
    decide(claim.sourceNid, claim.siriusId, "mapped_rekey", claimant.id, owner?.id ?? null,
      owner ? "Exact S1 mappings prove both sides; workers are parked at NULL under lock before authoritative rekeys."
        : "The exact mapped S2 worker can reclaim its free authoritative ID.");
  }

  if (options.retireShells) {
    if (options.shellWorkerIds) {
      const workerById = new Map(snapshot.workers.map((worker) => [worker.id, worker]));
      for (const requestedWorkerId of [...options.shellWorkerIds].sort()) {
        const worker = workerById.get(requestedWorkerId);
        if (!worker || worker.siriusId == null) {
          decide(
            null,
            null,
            "blocked_shell_selection_missing",
            null,
            requestedWorkerId,
            worker
              ? "The explicitly selected shell worker no longer has a numeric Sirius ID; the exact approved scope is stale."
              : "The explicitly selected shell worker UUID does not exist; the exact approved scope is stale.",
          );
        }
      }
    }
    const selectedShells = snapshot.workers.filter((worker) => worker.siriusId != null && (
      (options.allShells && isShellCandidate(worker)) ||
      options.shellWorkerIds?.has(worker.id) === true
    )).sort((a, b) => a.id.localeCompare(b.id));
    for (const shell of selectedShells) {
      if (requestedRekeys.has(shell.id)) continue;
      const proof = shellProof(shell, contactMappings);
      if (proof === "missing_marker_or_mapping") {
        decide(null, shell.siriusId, "blocked_shell_provenance_missing", null, shell.id,
          "Retirement requires the persisted migrationShell marker and a shell-worker mapping.");
      } else if (proof === "ambiguous_mapping" || proof === "has_worker_mapping") {
        decide(null, shell.siriusId, "blocked_shell_provenance_ambiguous", null, shell.id,
          "Retirement refuses ambiguous shell provenance or any S1 worker mapping.");
      } else if (proof === "authoritative_allocation") {
        decide(null, shell.siriusId, "blocked_shell_authoritative_entitlement", null, shell.id,
          "A shell marked as authoritative is never eligible for retirement.");
      } else if (proof === "marker_contact_mismatch" || proof === "noncanonical_mapping" || proof === "contact_mapping_unknown" || proof === "allocation_invalid") {
        decide(null, shell.siriusId, "blocked_shell_provenance_missing", null, shell.id,
          "Retirement requires canonical marker, shell-worker/contact mappings, and a recognized allocation record when present.");
      } else if (shellHasCurrentSourceWorker(shell)) {
        decide(null, shell.siriusId, "blocked_shell_authoritative_entitlement", null, shell.id,
          "The shell contact now has a staged S1 worker; relationship resolution must retarget it before retirement.");
      } else if ((claimsById.get(shell.siriusId!) ?? []).length > 0) {
        decide(null, shell.siriusId, "blocked_shell_authoritative_entitlement", null, shell.id,
          "A staged authoritative S1 entitlement exists for this ID; review it through its exact source claim.");
      } else {
        requestedRekeys.set(shell.id, {
          workerId: shell.id, fromSiriusId: shell.siriusId!, toSiriusId: null, reason: "retire_shell", sourceNid: null,
        });
        decide(null, shell.siriusId, "retire_shell", null, shell.id,
          "Explicitly selected proven relationship shell has no staged authoritative entitlement and is cleared to NULL.");
      }
    }
  }

  const rekeys = [...requestedRekeys.values()].sort((a, b) => a.workerId.localeCompare(b.workerId));
  const hardBlockers = Math.max(snapshot.idMapPresent ? 0 : 1, decisions.filter((decision) => isHardBlocker(decision.action)).length);
  return {
    planVersion: SIRIUS_ID_OWNERSHIP_PLAN_VERSION,
    evidenceDigest: reviewedEvidenceDigest(snapshot, decisions),
    snapshotPresent: true, scope, decisions, rekeys, reservations, hardBlockers, pendingRekeys: rekeys.length,
  };
}