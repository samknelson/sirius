import { logger } from "../../../logger";
import { randomUUID } from "node:crypto";

/** Safety ceilings, not historical cutoffs. Crossing one refuses the whole run. */
export const COVERAGE_LIMITS = {
  page: 1000, keys: 400_000, rows: 125_000, bytes: 64 * 1024 * 1024,
  durationMs: 120_000, queryMs: 10_000,
} as const;

export type CoverageCorrelation = { wizardId?: string; runId?: string };
export class CoverageBudgetError extends Error {
  constructor(readonly diagnostics: {
    scanId: string; wizardId?: string; runId?: string; phase: string;
    exceeded: { dimension: string; observed: number; limit: number }[];
  }) {
    super(`Coverage evidence exceeded its safe resource budget: ${diagnostics.exceeded.map(
      d => `${d.dimension} ${d.observed} > ${d.limit}`).join("; ")}. Phase: ${diagnostics.phase}. Reference: ${diagnostics.scanId}. No partial review was accepted. Ask an administrator to inspect the scan diagnostics before retrying.`);
    this.name = "CoverageBudgetError";
  }
}

export class CoverageBudget {
  private readonly started = performance.now();
  private readonly scanId = randomUUID();
  private bytes = 0;
  private rows = 0;
  private keys = 0;
  private phase = "Starting evidence check";
  constructor(private readonly correlation: CoverageCorrelation = {}) {}
  check(keys = 0) {
    this.keys = Math.max(this.keys, keys);
    const exceeded = [
      { dimension: "elapsedMs", observed: Math.floor(performance.now() - this.started), limit: COVERAGE_LIMITS.durationMs },
      { dimension: "coordinateKeys", observed: this.keys, limit: COVERAGE_LIMITS.keys },
      { dimension: "retainedRecords", observed: this.rows, limit: COVERAGE_LIMITS.rows },
      { dimension: "evidenceBytes", observed: this.bytes, limit: COVERAGE_LIMITS.bytes },
    ].filter(d => d.observed > d.limit);
    if (exceeded.length) {
      const diagnostics = { scanId: this.scanId, ...this.correlation, phase: this.phase, exceeded };
      logger.warn("EDI coverage resources", {
        service: "edi-coverage", event: "budget-exceeded", ...this.snapshot(), ...diagnostics,
      });
      throw new CoverageBudgetError(diagnostics);
    }
  }
  retain(row: unknown) {
    this.rows++;
    this.bytes += Buffer.byteLength(JSON.stringify(row));
    this.check();
  }
  log(event: string, phase: string, extra: Record<string, number> = {}) {
    if (event === "phase-start") this.phase = phase;
    logger.info("EDI coverage resources", {
      service: "edi-coverage", ...this.snapshot(), event, phase, ...extra,
    });
  }
  private snapshot() {
    const { rss, heapUsed, external } = process.memoryUsage();
    return { scanId: this.scanId, ...this.correlation, rows: this.rows, evidenceBytes: this.bytes,
      keys: this.keys, elapsedMs: Math.round(performance.now() - this.started), rss, heapUsed, external };
  }
  async yield(keys = 0) {
    this.check(keys);
    await new Promise<void>(resolve => setImmediate(resolve));
    this.check(keys);
  }
}

let admitted = false;
/** Hold through generation too: its projected history remains resident after discovery. */
export function tryAdmitCoverageRun(): (() => void) | null {
  if (admitted) return null;
  admitted = true;
  return () => { admitted = false; };
}
