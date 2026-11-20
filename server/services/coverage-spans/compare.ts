import { readSourceSegmentStarts, resolveSegmentStarts } from "../../plugins/trust/provider-edi/coverage-starts";
import { readSourceTerminationEvidence, readTerminationEvidence } from "../../plugins/trust/provider-edi/termination-population";
import type { TrustProviderEdiContext } from "../../plugins/trust/provider-edi/registry";
import { evidenceHash } from "../../plugins/trust/provider-edi/coverage-conflicts";

/**
 * Explicit read-only comparison, never called from generation. The caller must
 * supply an authorized read-only context and a pinned population. Differences
 * are evidence to review, not permission to overwrite retained source facts.
 */
export async function compareCoverageSpanEvidence(
  ctx: TrustProviderEdiContext,
  anchorIds: readonly string[],
  benefitIds: string[],
) {
  if (anchorIds.length > 500 || benefitIds.length > 20)
    throw new Error("Comparison is limited to 500 anchors and 20 benefits per invocation.");
  const started = performance.now();
  const beforeMemory = process.memoryUsage();
  const sourceStarts = await ctx.storage.readOnly.query(db => readSourceSegmentStarts(db, anchorIds),
    { statementTimeoutMs: 10_000 });
  const maintainedStarts = await resolveSegmentStarts(ctx, anchorIds);
  const sourceEndings = await readSourceTerminationEvidence(ctx, benefitIds);
  const maintainedEndings = await readTerminationEvidence(ctx, benefitIds);
  const starts = anchorIds.flatMap(id => {
    const before = sourceStarts.find(row => row.id === id);
    const after = maintainedStarts.get(id);
    const shape = (row: typeof before) => row ? {
      start: row.coverageStartYmd, cobra: row.isCobra, conflictMonths: row.conflictMonths,
      conflictRecords: row.conflictRecords, problem: row.problem,
    } : null;
    return evidenceHash(shape(before)) === evidenceHash(shape(after)) ? [] : [{
      anchorId: id, source: shape(before), maintained: shape(after),
      disposition: "Review required; no source evidence changed.",
    }];
  });
  const shapeEndings = (value: typeof sourceEndings) => ({
    selected: [...value.selected].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    excluded: [...value.excluded].map(group => ({
      reason: group.reason, records: group.rows.map(row => row.id).sort(),
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  const source = shapeEndings(sourceEndings), maintained = shapeEndings(maintainedEndings);
  return {
    anchorCount: anchorIds.length, startDifferences: starts,
    endingDifference: evidenceHash(source) === evidenceHash(maintained) ? null : { source, maintained },
    milliseconds: Math.round(performance.now() - started),
    memory: { before: beforeMemory, after: process.memoryUsage() },
    classification: "Read-only comparison; environment and source snapshot must be recorded by the caller.",
  };
}
