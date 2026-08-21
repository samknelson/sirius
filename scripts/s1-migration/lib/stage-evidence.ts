/**
 * Count evidence gate for live S1 staging.
 *
 * A live source is not a snapshot: daily runs may observe a bounded count
 * change while paging. We accept that only when the staged identity set exactly
 * matches the completed scan and the scan count falls inside the source's
 * before/after count window. Final-freeze always requires exact equality.
 */
export type StageMode = "daily" | "final-freeze";

export interface CountEvidenceInput {
  sourceCountBefore: number;
  sourceCountAfter: number;
  identitiesScanned: number;
  stagedCount: number;
}

export interface CountEvidence extends CountEvidenceInput {
  integrity: "pass" | "fail";
  sourceDrift: boolean;
  acceptedLiveDrift: boolean;
  status: "pass" | "fail";
  reason?: string;
}

export function assessCountEvidence(mode: StageMode, input: CountEvidenceInput): CountEvidence {
  const { sourceCountBefore, sourceCountAfter, identitiesScanned, stagedCount } = input;
  const integrity = identitiesScanned === stagedCount ? "pass" : "fail";
  const minimumObservedSourceCount = Math.min(sourceCountBefore, sourceCountAfter);
  const maximumObservedSourceCount = Math.max(sourceCountBefore, sourceCountAfter);
  const scanFallsWithinSourceWindow =
    identitiesScanned >= minimumObservedSourceCount && identitiesScanned <= maximumObservedSourceCount;
  const sourceDrift =
    sourceCountBefore !== sourceCountAfter ||
    identitiesScanned !== sourceCountBefore ||
    identitiesScanned !== sourceCountAfter;

  if (integrity === "fail") {
    return {
      ...input,
      integrity,
      sourceDrift,
      acceptedLiveDrift: false,
      status: "fail",
      reason: "staged identity count does not match the completed source identity scan",
    };
  }
  if (mode === "final-freeze" && sourceDrift) {
    return {
      ...input,
      integrity,
      sourceDrift,
      acceptedLiveDrift: false,
      status: "fail",
      reason: "final-freeze requires exact stable source counts",
    };
  }
  if (mode === "daily" && !scanFallsWithinSourceWindow) {
    return {
      ...input,
      integrity,
      sourceDrift,
      acceptedLiveDrift: false,
      status: "fail",
      reason: "source identity scan falls outside the observed live-source count window",
    };
  }
  return {
    ...input,
    integrity,
    sourceDrift,
    acceptedLiveDrift: mode === "daily" && sourceDrift,
    status: "pass",
  };
}