export type StageContractMode = "daily" | "final-freeze";

export interface StageEvidenceLike {
  source: string;
  sourceCountBefore: number;
  sourceCountAfter: number;
  identitiesScanned: number;
  stagedCount: number;
  integrity: "pass" | "fail";
  sourceDrift: boolean;
  acceptedLiveDrift: boolean;
  status: "pass" | "fail";
  identityVerified?: boolean;
  identityVerificationAttempts?: number;
}

export interface StageResultLike {
  contractVersion: number;
  step: string;
  mode: StageContractMode;
  status: "pass" | "fail";
  mismatches: number;
  acceptedLiveDrifts: number;
  countEvidence: StageEvidenceLike[];
}

/** Independently validate and recompute the stage handoff contract. */
export function validateStageResultPayload(
  mode: StageContractMode,
  payload: unknown,
): { result: StageResultLike | null; errors: string[] } {
  const errors: string[] = [];
  const result = payload as Partial<StageResultLike>;
  if (result.contractVersion !== 2) errors.push(`stage contractVersion=${String(result.contractVersion)} != 2`);
  if (result.step !== "stage") errors.push(`stage step=${String(result.step)} != stage`);
  if (result.mode !== mode) errors.push(`stage mode=${String(result.mode)} != sync mode=${mode}`);
  if (result.status !== "pass" && result.status !== "fail") errors.push("stage status missing/malformed");
  if (!Number.isInteger(result.mismatches) || Number(result.mismatches) < 0) errors.push("stage mismatches missing/malformed");
  if (!Number.isInteger(result.acceptedLiveDrifts) || Number(result.acceptedLiveDrifts) < 0) {
    errors.push("stage acceptedLiveDrifts missing/malformed");
  }
  if (!Array.isArray(result.countEvidence) || result.countEvidence.length === 0) {
    errors.push("stage countEvidence missing/empty");
  } else {
    let derivedFailures = 0;
    let derivedAcceptedLiveDrifts = 0;
    for (const [index, evidence] of result.countEvidence.entries()) {
      const prefix = `stage countEvidence[${index}]`;
      if (!evidence || typeof evidence.source !== "string") {
        errors.push(`${prefix}.source missing`);
        continue;
      }
      for (const field of ["sourceCountBefore", "sourceCountAfter", "identitiesScanned", "stagedCount"] as const) {
        if (!Number.isInteger(evidence[field]) || evidence[field] < 0) errors.push(`${prefix}.${field} missing/malformed`);
      }
      if (typeof evidence.sourceDrift !== "boolean") errors.push(`${prefix}.sourceDrift missing/malformed`);
      if (typeof evidence.acceptedLiveDrift !== "boolean") errors.push(`${prefix}.acceptedLiveDrift missing/malformed`);
      if (evidence.integrity !== "pass" && evidence.integrity !== "fail") errors.push(`${prefix}.integrity missing/malformed`);
      if (evidence.status !== "pass" && evidence.status !== "fail") errors.push(`${prefix}.status missing/malformed`);
      if (evidence.status === "fail") derivedFailures++;
      if (evidence.acceptedLiveDrift) derivedAcceptedLiveDrifts++;
      if (evidence.integrity !== "pass" || evidence.status !== "pass") {
        errors.push(`${prefix} (${evidence.source}) did not pass integrity/evidence`);
      }
      if (evidence.identitiesScanned !== evidence.stagedCount) {
        errors.push(`${prefix} (${evidence.source}) scanned/staged identities differ`);
      }
      const low = Math.min(evidence.sourceCountBefore, evidence.sourceCountAfter);
      const high = Math.max(evidence.sourceCountBefore, evidence.sourceCountAfter);
      const sourceDrift = evidence.sourceCountBefore !== evidence.sourceCountAfter;
      if (evidence.sourceDrift !== sourceDrift) {
        errors.push(`${prefix} (${evidence.source}) sourceDrift disagrees with numeric counts`);
      }
      const expectedAcceptedDrift = mode === "daily" && sourceDrift && evidence.status === "pass";
      if (evidence.acceptedLiveDrift !== expectedAcceptedDrift) {
        errors.push(`${prefix} (${evidence.source}) acceptedLiveDrift disagrees with numeric evidence/status`);
      }
      if (mode === "daily" && (evidence.identitiesScanned < low || evidence.identitiesScanned > high)) {
        errors.push(`${prefix} (${evidence.source}) scan falls outside source count window`);
      }
      if (
        mode === "daily" &&
        evidence.source !== "terms" &&
        !evidence.source.startsWith("raw:") &&
        evidence.identityVerified !== true
      ) {
        errors.push(`${prefix} (${evidence.source}) lacks exact identity-workset verification`);
      }
      if (
        mode === "final-freeze" &&
        !(
          evidence.sourceCountBefore === evidence.sourceCountAfter &&
          evidence.sourceCountAfter === evidence.identitiesScanned &&
          evidence.identitiesScanned === evidence.stagedCount
        )
      ) {
        errors.push(`${prefix} (${evidence.source}) is not exact/stable during final-freeze`);
      }
      if (evidence.acceptedLiveDrift && mode !== "daily") {
        errors.push(`${prefix} (${evidence.source}) accepted drift outside daily mode`);
      }
    }
    if (result.mismatches !== derivedFailures) {
      errors.push(`stage mismatches=${String(result.mismatches)} disagrees with evidence failures=${derivedFailures}`);
    }
    if (result.acceptedLiveDrifts !== derivedAcceptedLiveDrifts) {
      errors.push(
        `stage acceptedLiveDrifts=${String(result.acceptedLiveDrifts)} disagrees with evidence=${derivedAcceptedLiveDrifts}`,
      );
    }
    const derivedStatus = derivedFailures === 0 ? "pass" : "fail";
    if (result.status !== derivedStatus) errors.push(`stage status=${String(result.status)} disagrees with evidence=${derivedStatus}`);
  }
  return { result: errors.length === 0 ? (result as StageResultLike) : null, errors };
}