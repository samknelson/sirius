import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { runHistoricalBackfill } from "../../scripts/oneoffs/backfill-wmb-events";
import type { TrustWmbEventsStorage } from "../../server/storage/trust/wmb-events";
import { emptyWmbPhase, runWmbEventPhase, validatedCoverageCutoff } from "../../scripts/s1-migration/lib/wmb-event-phase";
import { PROFILES } from "../../scripts/s1-migration/sync-config";
import { reviewedCoverageDetail } from "./wmb-coverage-fixture";
import { RejectLog } from "../../scripts/s1-migration/lib/loader-utils";
import { buildLoaderResult, emptySummary, loaderExitCode } from "../../scripts/s1-migration/lib/sync";

const detail = {
  openEndThrough: "2031-03",
  historicalEventEvidence: { inclusiveCutoff: "2031-03", complete: true,
    stagedSpans: 3, processedSpans: 3, rejectedSpans: 0, verifyFailures: 0 },
};
const input = { enabled: true, dryRun: false, importSucceeded: true, stagingComplete: true, detail, horizon: "2031-03" };
const makePage = (after = "", next: string | null = null) => ({
  mode: "live", basis: "stored-coverage", cutoff: "2031-03",
  workers: 1, afterWorker: after, lastWorker: next ?? `${after}z`,
  totals: { created: 1, unchanged: 0, removed: 0, skipped: 0, failed: 0 },
  byTypeBenefitMonth: [{ type: "terminate", benefitId: "b", month: "2031-02",
    created: 1, unchanged: 0, removed: 0, skipped: 0, samples: [] }],
  nextAfterWorker: next, incomplete: next !== null,
});

describe("post-import historical WMB phase", () => {
  it("requires valid stored-coverage evidence without asserting source completeness", () => {
    expect(validatedCoverageCutoff(detail, input.horizon)).toBe(input.horizon);
    expect(validatedCoverageCutoff(reviewedCoverageDetail, "2026-10")).toBe("2026-10");
    for (const patch of [{ complete: undefined }, { complete: "false" }, { rejectedSpans: 1 },
      { rejectedSpans: -1 }, { rejectedSpans: 0.5 }, { rejectedSpans: 4 }, { rejectedSpans: undefined },
      { processedSpans: 2 }, { processedSpans: "3" }, { stagedSpans: NaN },
      { stagedSpans: Number.MAX_SAFE_INTEGER + 1 }, { inclusiveCutoff: "2031-04" },
      { stagedSpans: 0 }, { verifyFailures: 1 }, { verifyFailures: undefined }]) {
      expect(validatedCoverageCutoff({ ...detail,
        historicalEventEvidence: { ...detail.historicalEventEvidence, ...patch } }, input.horizon)).toBeNull();
    }
    expect(validatedCoverageCutoff(null, input.horizon)).toBeNull();
    expect(validatedCoverageCutoff(detail, "2031-13")).toBeNull();
    expect(validatedCoverageCutoff(detail, "0000-01")).toBeNull();
    expect(validatedCoverageCutoff({ ...detail, openEndThrough: "2031-04" }, input.horizon)).toBeNull();
  });

  it("leaves rejection policy with the importer and accepts only its successful outcome", async () => {
    const allowed = PROFILES.production.steps["benefit-history"].allowRejects!;
    for (const reason of [...allowed, "bad_end_date", "wmb_create_failed", "unknown_reject"]) {
      const rejects = new RejectLog();
      rejects.add(reason, { sourceRow: "must-not-leak" });
      const imported = buildLoaderResult({ loader: "t17-benefit-history", logicVersion: 3,
        dryRun: false, forceReconcile: false, summary: emptySummary(), rejects,
        allowedRejects: allowed, verifyFailures: 0, detail: reviewedCoverageDetail });
      const accepted = loaderExitCode(imported) === 0;
      expect(accepted).toBe(allowed.includes(reason));
      const page = vi.fn().mockResolvedValue({ ...makePage(), cutoff: "2026-10",
        byTypeBenefitMonth: [{ ...makePage().byTypeBenefitMonth[0], month: "2026-09" }] });
      const result = await runWmbEventPhase({ ...input, horizon: "2026-10",
        detail: imported.detail, importSucceeded: accepted }, page);
      expect(result.status).toBe(accepted ? "pass" : "skipped");
      expect(page).toHaveBeenCalledTimes(accepted ? 1 : 0);
      if (accepted) expect(result).toMatchObject({ cutoff: "2026-10", complete: true,
        policy: "accepted-import-stored-coverage", sourceHistory: reviewedCoverageDetail.historicalEventEvidence });
      expect(imported.detail.historicalEventEvidence).toEqual(reviewedCoverageDetail.historicalEventEvidence);
      expect(JSON.stringify(result)).not.toContain("must-not-leak");
    }
  });

  it("never reconciles failed/incomplete imports or dry-run hypothetical changes", async () => {
    const page = vi.fn();
    expect((await runWmbEventPhase({ ...input, importSucceeded: false }, page)).status).toBe("skipped");
    expect((await runWmbEventPhase({ ...input, enabled: false }, page)).status).toBe("disabled");
    const preview = await runWmbEventPhase({ ...input, dryRun: true }, page);
    expect(preview).toMatchObject({ status: "skipped", mode: "preview", basis: "stored-coverage" });
    for (const detail of [null, {}, { historicalEventEvidence: null },
      { ...reviewedCoverageDetail, openEndThrough: "2026-09" }]) {
      expect((await runWmbEventPhase({ ...input, detail }, page)).reason)
        .toBe("unsafe-or-missing-stored-coverage-evidence");
    }
    expect((await runWmbEventPhase({ ...input, stagingComplete: false }, page)).reason).toBe("missing-completed-stage-evidence");
    expect(page).not.toHaveBeenCalled();
  });

  it("traverses every page, aggregates separately, and retries from the beginning", async () => {
    const page = vi.fn().mockResolvedValueOnce(makePage("", "a"))
      .mockResolvedValueOnce(makePage("a", "b")).mockResolvedValueOnce(makePage("b"));
    const result = await runWmbEventPhase(input, page, 1);
    expect(result).toMatchObject({ status: "pass", complete: true, pages: 3, workers: 3,
      totals: { created: 3, failed: 0 }, byType: { terminate: { created: 3 } } });
    expect(page.mock.calls[1][0]).toContain("--after-worker=a");
    expect(page.mock.calls[0][0]).toContain("--live");
    const retry = vi.fn().mockResolvedValue(makePage());
    await runWmbEventPhase(input, retry);
    expect(retry.mock.calls[0][0]).not.toEqual(expect.arrayContaining(["--after-worker=b"]));
  });

  it("fails on exceptions, worker failures, malformed results, stalled cursors and bounded unfinished traversal", async () => {
    const exception = await runWmbEventPhase(input, vi.fn().mockRejectedValue(new Error("credential=secret")));
    expect(exception.reason).toBe("page-execution-failed");
    expect(JSON.stringify(exception)).not.toContain("secret");
    for (const page of [
      null,
      { ...makePage(), workers: -1 },
      { ...makePage(), cutoff: "2031-04" },
      { ...makePage(), mode: "preview" },
      { ...makePage(), basis: "source-history" },
      { ...makePage(), afterWorker: "wrong" },
      { ...makePage(), lastWorker: "" },
      { ...makePage(), byTypeBenefitMonth: [{ ...makePage().byTypeBenefitMonth[0], type: "unknown" }] },
      { ...makePage(), byTypeBenefitMonth: [{ ...makePage().byTypeBenefitMonth[0], month: "2031-04" }] },
      { ...makePage(), totals: { ...makePage().totals, failed: 1 }, incomplete: true },
      { ...makePage(), incomplete: true },
      { ...makePage("", "a"), nextAfterWorker: "" },
      { ...makePage(), byTypeBenefitMonth: [] },
      { ...makePage(), totals: { ...makePage().totals, created: NaN } },
    ]) {
      const result = await runWmbEventPhase(input, vi.fn().mockResolvedValue(page), 1);
      expect(result.status).toBe("fail");
      expect(result.complete).toBe(false);
    }
    const bounded = await runWmbEventPhase(input, vi.fn().mockResolvedValue(makePage("", "a")), 1, 1);
    expect(bounded.reason).toBe("page-limit-exceeded");
    for (const [size, pages] of [[0, 1], [5001, 1], [1, 0], [1.5, 1], [1, Infinity]]) {
      const run = vi.fn();
      expect((await runWmbEventPhase(input, run, size, pages)).reason).toBe("invalid-traversal-bound");
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("validates workers before writes and treats a malformed worker decision as failure", async () => {
    const target = { pageHistoricalWorkers: vi.fn().mockResolvedValue(["z", "a"]),
      reconcileHistoricalWorker: vi.fn() } as unknown as TrustWmbEventsStorage;
    await expect(runHistoricalBackfill(["--cutoff=2031-03", "--live"], target)).rejects.toThrow("invalid-worker-page");
    expect(target.reconcileHistoricalWorker).not.toHaveBeenCalled();
    vi.mocked(target.pageHistoricalWorkers).mockResolvedValue(["a"]);
    vi.mocked(target.reconcileHistoricalWorker).mockResolvedValue([{ change: "oops" }] as never);
    const page = await runHistoricalBackfill(["--cutoff=2031-03"], target);
    expect(page.totals.failed).toBe(1);
    expect(page.incomplete).toBe(true);
    expect(target.reconcileHistoricalWorker).toHaveBeenCalledWith("a", 2031 * 12 + 3, undefined, true);
  });

  it("preserves production activation, packages the reconciler, and runs before result/fence cleanup without cron activation", () => {
    expect(PROFILES.production.historicalWmbEvents).toBe(true);
    const sync = readFileSync("scripts/s1-migration/sync.ts", "utf8");
    const invoke = sync.indexOf("const wmbEvents = await runWmbEventPhase");
    expect(invoke).toBeGreaterThan(sync.indexOf("report.fleetTotals = totals"));
    expect(invoke).toBeLessThan(sync.indexOf("aggregateRunId = await recordRun"));
    expect(invoke).toBeLessThan(sync.indexOf("await finalizeWriteFenceReport"));
    expect(sync).toContain('importSucceeded: !aborted && failures.length === 0');
    expect(sync).toContain('stagingComplete: (report.stage as { status?: string } | undefined)?.status === "pass"');
    expect(sync).not.toContain("initializeCronPluginSystem");
    expect(sync).not.toContain("backfillAllDenorm");
    expect(readFileSync("Dockerfile", "utf8")).toContain("test -f scripts/oneoffs/backfill-wmb-events.ts");
    expect(emptyWmbPhase(false).totals.failed).toBe(0);
  });
});
