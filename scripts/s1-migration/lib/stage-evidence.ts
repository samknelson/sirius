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
  deferredOutsideRange?: boolean;
}

export interface CountEvidence extends CountEvidenceInput {
  integrity: "pass" | "fail";
  sourceDrift: boolean;
  acceptedLiveDrift: boolean;
  status: "pass" | "fail";
  reason?: string;
}

export interface StageShardLogEntry {
  index: number;
  afterNid: number;
  throughNid: number;
  identitiesScanned: number;
  payloadExtracted: number;
  durationMs: number;
}

/**
 * Keep CloudWatch events bounded even when a sparse source spans hundreds of
 * NID ranges. Aggregate every range, then retain only the slowest few as
 * actionable diagnostics.
 */
export function formatShardLogSummary(shards: StageShardLogEntry[], slowestLimit = 5): string {
  const nonEmpty = shards.filter((shard) => shard.identitiesScanned > 0);
  const identitiesScanned = shards.reduce((sum, shard) => sum + shard.identitiesScanned, 0);
  const payloadExtracted = shards.reduce((sum, shard) => sum + shard.payloadExtracted, 0);
  const workMs = shards.reduce((sum, shard) => sum + shard.durationMs, 0);
  const slowest = [...shards]
    .sort((a, b) => b.durationMs - a.durationMs || a.index - b.index)
    .slice(0, Math.max(0, slowestLimit))
    .map((shard) =>
      `${shard.index}[${shard.afterNid + 1}-${shard.throughNid}]=${shard.identitiesScanned}/${shard.payloadExtracted} (${shard.durationMs}ms)`,
    );
  return [
    `ranges=${shards.length}`,
    `nonEmpty=${nonEmpty.length}`,
    `empty=${shards.length - nonEmpty.length}`,
    `scanned=${identitiesScanned}`,
    `payloads=${payloadExtracted}`,
    `rangeWork=${workMs}ms`,
    ...(slowest.length > 0 ? [`slowest: ${slowest.join(" ")}`] : []),
  ].join(" ");
}

export function assessCountEvidence(mode: StageMode, input: CountEvidenceInput): CountEvidence {
  const { sourceCountBefore, sourceCountAfter, identitiesScanned, stagedCount } = input;
  const integrity = input.deferredOutsideRange ? (stagedCount >= identitiesScanned ? "pass" : "fail") : (identitiesScanned === stagedCount ? "pass" : "fail");
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
  if (mode === "daily" && !input.deferredOutsideRange && !scanFallsWithinSourceWindow) {
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

/**
 * Pure model of resumable range staging.  Kept here (rather than in the
 * database layer) so production-scale failure/resume cases can be exercised
 * without credentials or a 500k-row fixture.
 */
export function simulateResumableRanges(
  identityCount: number,
  rangeSize: number,
  completedRanges: number[] = [],
): { ranges: Array<{ index: number; after: number; through: number; verified: boolean; cleaned: boolean; scanned: boolean }>; deferredOutOfBound: boolean; resumedWithoutRescan: number } {
  if (!Number.isSafeInteger(identityCount) || identityCount < 0) throw new Error("identityCount must be a non-negative integer");
  if (!Number.isSafeInteger(rangeSize) || rangeSize < 1) throw new Error("rangeSize must be a positive integer");
  const completed = new Set(completedRanges);
  const ranges = [];
  for (let after = 0, index = 1; after < identityCount; index++) {
    const through = Math.min(identityCount, after + rangeSize);
    const verified = completed.has(index) || through >= after;
    ranges.push({ index, after, through, verified, cleaned: verified, scanned: !completed.has(index) });
    after = through;
  }
  return { ranges, deferredOutOfBound: true, resumedWithoutRescan: completed.size };
}