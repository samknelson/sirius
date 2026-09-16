import { createHash } from "node:crypto";

/**
 * The S1 worker mapping is the only identity evidence used here.  In
 * particular, a matching number is never treated as evidence that two people
 * are the same person.
 */
export interface SiriusIdClaim {
  sourceNid: number;
  /** Trimmed source value retained only as diagnostic metadata (never PII). */
  rawSiriusId: string | null;
  siriusId: number | null;
  sourceIdProblem: "missing" | "non_numeric" | "out_of_range" | null;
}

export interface SiriusIdWorker {
  id: string;
  siriusId: number;
  data: Record<string, unknown> | null;
  workerMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  shellMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
}

export interface SiriusIdOwnershipSnapshot {
  stagingPresent: boolean;
  idMapPresent: boolean;
  claims: SiriusIdClaim[];
  workers: SiriusIdWorker[];
}

export type SiriusIdOwnershipAction =
  | "correct"
  | "new_claim_reserved"
  | "mapped_rekey"
  | "displace_generated"
  | "source_duplicate"
  | "source_id_missing"
  | "source_id_non_numeric"
  | "source_id_out_of_range"
  | "blocked_mapping_missing"
  | "blocked_mapping_ambiguous"
  | "blocked_owner_native"
  | "blocked_owner_mapping_ambiguous"
  | "blocked_owner_entitlement_unknown";

export interface SiriusIdRekey {
  workerId: string;
  fromSiriusId: number;
  toSiriusId: number;
  reason: "mapped_rekey" | "displace_generated";
  sourceNid: number;
}

export interface SiriusIdOwnershipDecision {
  sourceNid: number;
  siriusId: number | null;
  action: SiriusIdOwnershipAction;
  claimantWorkerId: string | null;
  currentOwnerWorkerId: string | null;
  detail: string;
}

export interface SiriusIdOwnershipPlan {
  snapshotPresent: boolean;
  /** Scope is approval evidence, not just a diagnostic display filter. */
  scope: { siriusIds: number[] | null; sourceNids: number[] | null };
  decisions: SiriusIdOwnershipDecision[];
  rekeys: SiriusIdRekey[];
  reservations: number[];
  hardBlockers: number;
  pendingRekeys: number;
}

/** Pure candidate calculation used by the locked shell allocator. Sequence
 * state is a reservation too: a native insert may have taken nextval before
 * it waits for the workers lock. */
export function nextRelationshipShellSiriusId(
  currentWorkerIds: Iterable<number>,
  stagedReservations: Iterable<number>,
  sequenceLastValue: number = 0,
): number {
  let highest = Math.max(0, sequenceLastValue);
  for (const id of currentWorkerIds) if (Number.isSafeInteger(id) && id > highest) highest = id;
  for (const id of stagedReservations) if (Number.isSafeInteger(id) && id > highest) highest = id;
  if (highest >= 2_147_483_647) throw new Error("No signed-serial Sirius ID remains for a relationship shell.");
  return highest + 1;
}

export interface SiriusIdWorkerEvidence {
  workerId: string;
  siriusId: number;
  workerMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  shellMappings: Array<{ sourceNid: number; stub: boolean; loader: string }>;
  migrationShell: boolean;
  generatedAllocation: boolean;
  /** Current staged entitlement for each exact S1 worker mapping, when that
   * source node is present in the current staging snapshot. */
  currentSourceEntitlements: Array<{
    sourceNid: number;
    siriusId: number | null;
    sourceIdProblem: "missing" | "non_numeric" | "out_of_range" | null;
  }>;
}

export interface SiriusIdDecisionEvidence {
  decision: SiriusIdOwnershipDecision;
  claimant: SiriusIdWorkerEvidence | null;
  owner: SiriusIdWorkerEvidence | null;
}

function isGenerated(worker: SiriusIdWorker): boolean {
  const allocation = worker.data?.migrationSiriusIdAllocation;
  const allocationKind =
    allocation && typeof allocation === "object"
      ? (allocation as Record<string, unknown>).kind
      : null;
  // A shell mapping plus the persisted shell marker is sufficient evidence for
  // old shell rows created before allocation provenance existed.  A shell
  // marker alone is intentionally not enough: it could have been edited.
  return allocationKind === "generated" ||
    (worker.shellMappings.length > 0 && worker.data?.migrationShell === true);
}

/** Sanitized, pure diagnostic projection. It deliberately exposes allocation
 * evidence and mappings, but never the worker data blob, contact data, or
 * other potentially sensitive target columns. */
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
    return {
      workerId: worker.id,
      siriusId: worker.siriusId,
      workerMappings: worker.workerMappings.map((mapping) => ({ ...mapping })),
      shellMappings: worker.shellMappings.map((mapping) => ({ ...mapping })),
      migrationShell: worker.data?.migrationShell === true,
      generatedAllocation: isGenerated(worker),
      currentSourceEntitlements: worker.workerMappings
        .map((mapping) => claimByNid.get(mapping.sourceNid))
        .filter((claim): claim is SiriusIdClaim => claim != null)
        .map((claim) => ({
          sourceNid: claim.sourceNid,
          siriusId: claim.siriusId,
          sourceIdProblem: claim.sourceIdProblem,
        })),
    };
  };
  return plan.decisions.map((decision) => ({
    decision,
    claimant: project(decision.claimantWorkerId),
    owner: project(decision.currentOwnerWorkerId),
  }));
}

/** Deterministic, JSON-safe hash used as the operator approval token. */
export function siriusIdPlanHash(plan: SiriusIdOwnershipPlan): string {
  const payload = {
    snapshotPresent: plan.snapshotPresent,
    scope: plan.scope,
    decisions: [...plan.decisions]
      .sort((a, b) => (a.siriusId ?? Number.MAX_SAFE_INTEGER) - (b.siriusId ?? Number.MAX_SAFE_INTEGER) || a.sourceNid - b.sourceNid)
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
 * Produces a conservative plan.  `scopeSiriusIds` is for an operator-approved
 * repair subset; all staged claims still participate as reservations and as
 * evidence about a mapped owner's current entitlement.
 */
export function planSiriusIdOwnership(
  snapshot: SiriusIdOwnershipSnapshot,
  scopeSiriusIds?: ReadonlySet<number>,
  scopeSourceNids?: ReadonlySet<number>,
): SiriusIdOwnershipPlan {
  const reservations = [...new Set(snapshot.claims.flatMap((c) => c.siriusId == null ? [] : [c.siriusId]))].sort((a, b) => a - b);
  const scope = {
    siriusIds: scopeSiriusIds == null ? null : [...scopeSiriusIds].sort((a, b) => a - b),
    sourceNids: scopeSourceNids == null ? null : [...scopeSourceNids].sort((a, b) => a - b),
  };
  if (!snapshot.stagingPresent) {
    return { snapshotPresent: false, scope, decisions: [], rekeys: [], reservations, hardBlockers: 1, pendingRekeys: 0 };
  }

  const claimsById = new Map<number, SiriusIdClaim[]>();
  for (const claim of snapshot.claims) {
    if (claim.siriusId != null) {
      claimsById.set(claim.siriusId, [...(claimsById.get(claim.siriusId) ?? []), claim]);
    }
  }
  const ownerBySiriusId = new Map(snapshot.workers.map((worker) => [worker.siriusId, worker]));
  const mappedWorkerBySource = new Map<number, SiriusIdWorker[]>();
  for (const worker of snapshot.workers) {
    for (const mapping of worker.workerMappings) {
      mappedWorkerBySource.set(mapping.sourceNid, [...(mappedWorkerBySource.get(mapping.sourceNid) ?? []), worker]);
    }
  }

  const isSelected = (claim: SiriusIdClaim): boolean =>
    (scopeSiriusIds == null && scopeSourceNids == null) ||
    (claim.siriusId != null && scopeSiriusIds?.has(claim.siriusId) === true) ||
    scopeSourceNids?.has(claim.sourceNid) === true;
  const selected = snapshot.claims
    .filter(isSelected)
    .sort((a, b) => (a.siriusId ?? Number.MAX_SAFE_INTEGER) - (b.siriusId ?? Number.MAX_SAFE_INTEGER) || a.sourceNid - b.sourceNid);
  const decisions: SiriusIdOwnershipDecision[] = [];
  const requestedRekeys = new Map<string, SiriusIdRekey>();

  const decide = (
    claim: SiriusIdClaim,
    action: SiriusIdOwnershipAction,
    claimantWorkerId: string | null,
    currentOwnerWorkerId: string | null,
    detail: string,
  ) => decisions.push({ sourceNid: claim.sourceNid, siriusId: claim.siriusId, action, claimantWorkerId, currentOwnerWorkerId, detail });

  for (const claim of selected) {
    const claimantMatches = mappedWorkerBySource.get(claim.sourceNid) ?? [];
    if (claim.siriusId == null) {
      const action =
        claim.sourceIdProblem === "missing" ? "source_id_missing" :
        claim.sourceIdProblem === "non_numeric" ? "source_id_non_numeric" :
        "source_id_out_of_range";
      decide(
        claim,
        action,
        claimantMatches.length === 1 ? claimantMatches[0].id : null,
        null,
        "S1 did not supply a usable authoritative Sirius ID; source review is required and no generated replacement is allowed.",
      );
      continue;
    }
    if (!snapshot.idMapPresent) {
      decide(
        claim,
        "blocked_mapping_missing",
        null,
        null,
        "The S1 worker mapping table is unavailable, so exact source ownership cannot be proven.",
      );
      continue;
    }
    const sameSourceClaims = claimsById.get(claim.siriusId) ?? [];
    if (sameSourceClaims.length !== 1) {
      decide(claim, "source_duplicate", null, null, "S1 has more than one staged claimant for this Sirius ID.");
      continue;
    }
    if (claimantMatches.length > 1) {
      decide(claim, "blocked_mapping_ambiguous", null, null, "The exact S1 worker mapping points to multiple S2 workers.");
      continue;
    }
    const claimant = claimantMatches[0] ?? null;
    if (claimant && claimant.workerMappings.length !== 1) {
      decide(
        claim,
        "blocked_mapping_ambiguous",
        claimant.id,
        null,
        "The mapped S2 worker has multiple S1 worker mappings; exact source ownership is ambiguous.",
      );
      continue;
    }
    const owner = ownerBySiriusId.get(claim.siriusId) ?? null;
    if (!claimant) {
      if (!owner) {
        decide(claim, "new_claim_reserved", null, null, "No S2 row owns this authoritative ID; reserve it for the new staged worker.");
      } else if (owner.workerMappings.length > 1) {
        decide(claim, "blocked_owner_mapping_ambiguous", null, owner.id, "The current owner has multiple S1 worker mappings.");
      } else if (owner.workerMappings.length === 1) {
        decide(claim, "blocked_owner_entitlement_unknown", null, owner.id, "The current owner has an S1 worker mapping; do not displace it automatically.");
      } else if (isGenerated(owner)) {
        requestedRekeys.set(owner.id, {
          workerId: owner.id,
          fromSiriusId: owner.siriusId,
          toSiriusId: 0,
          reason: "displace_generated",
          sourceNid: claim.sourceNid,
        });
        decide(claim, "displace_generated", null, owner.id, "A proven migration-generated row without an S1 worker mapping occupies the authoritative ID.");
      } else {
        decide(claim, "blocked_owner_native", null, owner.id, "The current owner is not proven migration-generated.");
      }
      continue;
    }

    if (claimant.id === owner?.id || claimant.siriusId === claim.siriusId) {
      decide(claim, "correct", claimant.id, owner?.id ?? null, "The exact mapped S2 worker already owns the authoritative ID.");
      continue;
    }
    if (!owner) {
      requestedRekeys.set(claimant.id, {
        workerId: claimant.id,
        fromSiriusId: claimant.siriusId,
        toSiriusId: claim.siriusId,
        reason: "mapped_rekey",
        sourceNid: claim.sourceNid,
      });
      decide(claim, "mapped_rekey", claimant.id, null, "The exact mapped S2 worker can reclaim its free authoritative ID.");
      continue;
    }
    if (owner.workerMappings.length > 1) {
      decide(claim, "blocked_owner_mapping_ambiguous", claimant.id, owner.id, "The current owner has multiple S1 worker mappings.");
      continue;
    }
    if (owner.workerMappings.length === 1) {
      decide(claim, "blocked_owner_entitlement_unknown", claimant.id, owner.id, "The current owner has an S1 worker mapping; do not displace it automatically.");
      continue;
    }
    if (isGenerated(owner)) {
      requestedRekeys.set(claimant.id, {
        workerId: claimant.id,
        fromSiriusId: claimant.siriusId,
        toSiriusId: claim.siriusId,
        reason: "mapped_rekey",
        sourceNid: claim.sourceNid,
      });
      requestedRekeys.set(owner.id, {
        workerId: owner.id,
        fromSiriusId: owner.siriusId,
        toSiriusId: 0,
        reason: "displace_generated",
        sourceNid: claim.sourceNid,
      });
      decide(claim, "displace_generated", claimant.id, owner.id, "The mapped claimant reclaims its ID; the proven generated occupant is displaced.");
      continue;
    }
    decide(claim, "blocked_owner_native", claimant.id, owner.id, "The current owner is not proven migration-generated.");
  }

  const used = new Set<number>([
    ...reservations,
    ...snapshot.workers.map((worker) => worker.siriusId),
    ...[...requestedRekeys.values()].map((rekey) => rekey.toSiriusId).filter(Boolean),
  ]);
  let next = Math.max(0, ...used) + 1;
  const rekeys = [...requestedRekeys.values()]
    .sort((a, b) => a.workerId.localeCompare(b.workerId))
    .map((rekey) => {
      if (rekey.toSiriusId !== 0) return rekey;
      while (used.has(next)) next++;
      const toSiriusId = next++;
      used.add(toSiriusId);
      return { ...rekey, toSiriusId };
    });
  const hardBlockers = Math.max(snapshot.idMapPresent ? 0 : 1, decisions.filter((d) =>
    d.action === "source_duplicate" || d.action.startsWith("source_id_") || d.action.startsWith("blocked_"),
  ).length);
  return {
    snapshotPresent: true,
    scope,
    decisions,
    rekeys,
    reservations,
    hardBlockers,
    pendingRekeys: rekeys.length,
  };
}