import { describe, expect, it } from "vitest";
import { importedMonthAuthority } from "../../server/services/sitespecific/bao/imported-coverage-authority";
import type { ImportedCoverageEvidence } from "../../server/storage/worker-imported-coverage";

export function completeImportEvidence(): ImportedCoverageEvidence {
  return {
    identityVerified: true, snapshotVerified: true, firstMonthIndex: 2020 * 12, desiredMonthIndexes: [],
    report: {
      loader: "t17-benefit-history", dryRun: false,
      verify: { status: "pass", failures: 0 },
      rejectGate: { status: "pass", counts: {} }, blockingFindings: [],
      detail: {
        staged: 10, openEndThrough: "2024-04",
        historicalEventEvidence: {
          complete: true, inclusiveCutoff: "2024-04", stagedSpans: 10,
          processedSpans: 10, rejectedSpans: 0, verifyFailures: 0,
        },
      },
    },
  };
}

describe("imported monthly history authority", () => {
  it("requires complete all-source import evidence and constrains both boundaries", () => {
    const evidence = completeImportEvidence();
    expect(importedMonthAuthority(evidence, 2024, 4)).toEqual({ state: "verified" });
    expect(importedMonthAuthority(evidence, 2020, 1)).toEqual({ state: "verified" });
    expect(importedMonthAuthority(evidence, 2019, 12).state).toBe("unavailable");
    expect(importedMonthAuthority(evidence, 2024, 5).state).toBe("unavailable");
  });

  it("refuses incomplete, accepted-with-rejects, preview, malformed and failed reports", () => {
    const edits = [
      (r: any) => { r.dryRun = true; },
      (r: any) => { r.verify.failures = 1; },
      (r: any) => { r.rejectGate.counts = { relation_unmapped: 1 }; },
      (r: any) => { r.blockingFindings = [{ kind: "failed" }]; },
      (r: any) => { r.detail.historicalEventEvidence.complete = false; },
      (r: any) => { r.detail.historicalEventEvidence.rejectedSpans = 1; },
      (r: any) => { r.detail.historicalEventEvidence.processedSpans = 9; },
      (r: any) => { r.detail.historicalEventEvidence.inclusiveCutoff = "2024-03"; },
      (r: any) => { r.detail.openEndThrough = "2024-13"; },
      (r: any) => { delete r.detail.historicalEventEvidence; },
      (r: any) => { r.detail = { anchors: { created: 3 }, eventBackfill: { complete: true } }; },
    ];
    for (const edit of edits) {
      const evidence = completeImportEvidence();
      edit(evidence.report);
      expect(importedMonthAuthority(evidence, 2024, 4).state).toBe("unavailable");
    }
  });

  it("refuses missing identity, stale staging and span-only evidence", () => {
    expect(importedMonthAuthority(null, 2024, 4).state).toBe("unavailable");
    for (const edit of [
      { identityVerified: false }, { snapshotVerified: false }, { firstMonthIndex: null },
      { report: null }, { report: {} },
    ]) {
      expect(importedMonthAuthority({ ...completeImportEvidence(), ...edit }, 2024, 4).state).toBe("unavailable");
    }
  });
  it("does not turn lost positive source coverage into a negative import decision", () => {
    const evidence = completeImportEvidence();
    evidence.desiredMonthIndexes = [2024 * 12 + 3];
    expect(importedMonthAuthority(evidence, 2024, 4)).toMatchObject({
      state: "unavailable", explanation: "Imported positive coverage could not be confirmed in the available coverage records.",
    });
  });
});
