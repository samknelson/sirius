import { runHistoricalBackfill } from "../../oneoffs/backfill-wmb-events";

const YM = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const TYPES = ["start", "restart", "terminate"] as const;
const CHANGES = ["created", "unchanged", "removed", "skipped", "failed"] as const;
export type EventTotals = Record<(typeof CHANGES)[number], number>;
const emptyTotals = (): EventTotals => ({ created: 0, unchanged: 0, removed: 0, skipped: 0, failed: 0 });

export interface WmbEventPhase {
  status: "pass" | "fail" | "disabled" | "skipped";
  reason: string | null;
  mode: "live" | "preview";
  basis: "stored-coverage";
  policy: "accepted-import-stored-coverage";
  sourceHistory: CoverageEvidence | null;
  cutoff: string | null;
  durationSec: number;
  pages: number;
  workers: number;
  totals: EventTotals;
  byType: Record<(typeof TYPES)[number], Omit<EventTotals, "failed">>;
  /** Successful traversal of stored-coverage candidates, not source completeness. */
  complete: boolean;
}

export type CoverageEvidence = {
  inclusiveCutoff: string;
  complete: boolean;
  stagedSpans: number;
  processedSpans: number;
  rejectedSpans: number;
  verifyFailures: number;
};

/** The caller must first pass the importer, staging and parity gates.
 * Reviewed rejects do not certify source completeness; events describe S2. */
export function validatedCoverageCutoff(detail: Record<string, unknown> | null, horizon: string): string | null {
  const evidence = detail?.historicalEventEvidence as CoverageEvidence | undefined;
  if (!YM.test(horizon) || !evidence || evidence.inclusiveCutoff !== horizon ||
      detail?.openEndThrough !== horizon || typeof evidence.complete !== "boolean" ||
      !Number.isSafeInteger(evidence.stagedSpans) || evidence.stagedSpans < 1 ||
      evidence.processedSpans !== evidence.stagedSpans ||
      !Number.isSafeInteger(evidence.rejectedSpans) || evidence.rejectedSpans < 0 ||
      evidence.rejectedSpans > evidence.processedSpans ||
      (evidence.rejectedSpans > 0 && evidence.complete) ||
      evidence.verifyFailures !== 0) return null;
  return horizon;
}

type Page = Awaited<ReturnType<typeof runHistoricalBackfill>>;
type RunPage = (argv: string[]) => Promise<Page>;

export function emptyWmbPhase(dryRun: boolean): WmbEventPhase {
  return {
    status: "skipped", reason: "coverage-not-completed",
    mode: dryRun ? "preview" : "live", basis: "stored-coverage",
    policy: "accepted-import-stored-coverage", sourceHistory: null,
    cutoff: null, durationSec: 0, pages: 0, workers: 0, totals: emptyTotals(),
    byType: { start: { created: 0, unchanged: 0, removed: 0, skipped: 0 },
      restart: { created: 0, unchanged: 0, removed: 0, skipped: 0 },
      terminate: { created: 0, unchanged: 0, removed: 0, skipped: 0 } },
    complete: false,
  };
}

/** Runs only after fleet success; never releases the caller's fence/lock.
 * Page continuation is normal, worker errors are not. Retry from the beginning. */
export async function runWmbEventPhase(input: {
  enabled: boolean; dryRun: boolean; importSucceeded: boolean;
  stagingComplete: boolean;
  detail: Record<string, unknown> | null; horizon: string;
}, runPage: RunPage = runHistoricalBackfill, pageSize = 500, maxPages = 100000): Promise<WmbEventPhase> {
  const result = emptyWmbPhase(input.dryRun);
  if (!input.enabled) return { ...result, status: "disabled", reason: "awaiting-tested-image-activation" };
  if (!input.importSucceeded) return result;
  if (input.dryRun) return { ...result, reason: "dry-run-no-verified-stored-history-cutoff" };
  if (!input.stagingComplete) return { ...result, status: "fail", reason: "missing-completed-stage-evidence" };
  const cutoff = validatedCoverageCutoff(input.detail, input.horizon);
  if (!cutoff) return { ...result, status: "fail", reason: "unsafe-or-missing-stored-coverage-evidence" };
  result.cutoff = cutoff;
  // Explicit fields only: never relay loader samples or other source detail.
  const evidence = input.detail!.historicalEventEvidence as CoverageEvidence;
  result.sourceHistory = {
    inclusiveCutoff: cutoff, complete: evidence.complete,
    stagedSpans: evidence.stagedSpans, processedSpans: evidence.processedSpans,
    rejectedSpans: evidence.rejectedSpans, verifyFailures: evidence.verifyFailures,
  };
  const started = Date.now();
  let after = "";
  try {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5000 ||
        !Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("invalid-traversal-bound");
    for (let index = 0; index < maxPages; index++) {
      const page = await runPage([`--cutoff=${cutoff}`, `--limit=${pageSize}`,
        ...(after ? [`--after-worker=${after}`] : []), ...(input.dryRun ? [] : ["--live"])]);
      if (!page || page.cutoff !== cutoff || page.mode !== result.mode || page.basis !== result.basis ||
          page.afterWorker !== after ||
          !Number.isSafeInteger(page.workers) || page.workers < 0 || page.workers > pageSize ||
          (page.workers === 0 ? page.lastWorker !== null :
            typeof page.lastWorker !== "string" || page.lastWorker <= after) ||
          !page.totals || CHANGES.some(key => !Number.isSafeInteger(page.totals[key]) || page.totals[key] < 0) ||
          page.totals.failed > page.workers || typeof page.incomplete !== "boolean" ||
          !Array.isArray(page.byTypeBenefitMonth)) throw new Error("malformed-page-result");
      const pageByType = emptyWmbPhase(input.dryRun).byType;
      for (const group of page.byTypeBenefitMonth) {
        if (!TYPES.includes(group.type as typeof TYPES[number]) ||
            typeof group.benefitId !== "string" || !group.benefitId ||
            typeof group.month !== "string" || !YM.test(group.month) || group.month > cutoff ||
            CHANGES.filter(key => key !== "failed").some(key =>
              !Number.isSafeInteger(group[key as keyof typeof group]) ||
              (group[key as keyof typeof group] as number) < 0)) throw new Error("malformed-event-totals");
        for (const key of ["created", "unchanged", "removed", "skipped"] as const) {
          pageByType[group.type as typeof TYPES[number]][key] += group[key];
        }
      }
      for (const key of ["created", "unchanged", "removed", "skipped"] as const) {
        if (TYPES.reduce((sum, type) => sum + pageByType[type][key], 0) !== page.totals[key]) {
          throw new Error("inconsistent-event-totals");
        }
      }
      result.pages++;
      result.workers += page.workers;
      for (const key of CHANGES) result.totals[key] += page.totals[key];
      for (const type of TYPES) for (const key of ["created", "unchanged", "removed", "skipped"] as const) {
        result.byType[type][key] += pageByType[type][key];
      }
      if (CHANGES.some(key => !Number.isSafeInteger(result.totals[key])) ||
          !Number.isSafeInteger(result.workers)) throw new Error("inconsistent-event-totals");
      if (page.totals.failed) throw new Error("worker-reconciliation-failed");
      const next = page.nextAfterWorker;
      if (next === null) {
        if (page.incomplete) throw new Error("unfinished-traversal");
        result.complete = true;
        result.status = "pass";
        result.reason = null;
        break;
      }
      if (!page.incomplete || page.workers !== pageSize || typeof next !== "string" || next <= after ||
          next !== page.lastWorker) {
        throw new Error("stalled-or-invalid-cursor");
      }
      after = next;
    }
    if (!result.complete) throw new Error("page-limit-exceeded");
  } catch (error) {
    // Only our fixed classes may leave this boundary, never a raw exception.
    const classes = ["invalid-traversal-bound", "malformed-page-result", "malformed-event-totals",
      "inconsistent-event-totals", "worker-reconciliation-failed", "unfinished-traversal",
      "stalled-or-invalid-cursor", "page-limit-exceeded"];
    result.status = "fail";
    result.reason = error instanceof Error && classes.includes(error.message) ? error.message : "page-execution-failed";
  } finally {
    result.durationSec = Math.round((Date.now() - started) / 100) / 10;
  }
  return result;
}
