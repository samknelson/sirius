import { logger } from "../../../logger";
import { randomUUID } from "node:crypto";

/** Safety ceilings, not historical cutoffs. Crossing one refuses the whole run. */
export const COVERAGE_LIMITS = {
  page: 1000, keys: 400_000, rows: 125_000, bytes: 64 * 1024 * 1024,
  durationMs: 120_000, queryMs: 10_000,
} as const;

export class CoverageBudget {
  private readonly started = performance.now();
  private readonly scanId = randomUUID();
  private bytes = 0;
  private rows = 0;
  check(keys = 0) {
    if (performance.now() - this.started > COVERAGE_LIMITS.durationMs ||
        keys > COVERAGE_LIMITS.keys || this.rows > COVERAGE_LIMITS.rows ||
        this.bytes > COVERAGE_LIMITS.bytes) {
      this.log("budget-exceeded", "Refusing incomplete evidence", { keys });
      throw new Error("Coverage evidence exceeded its safe resource budget. No partial review was accepted. Ask an administrator to inspect the coverage scan diagnostics before retrying.");
    }
  }
  retain(row: unknown) {
    this.rows++;
    this.bytes += Buffer.byteLength(JSON.stringify(row));
    this.check();
  }
  log(event: string, phase: string, extra: Record<string, number> = {}) {
    const { rss, heapUsed, external } = process.memoryUsage();
    logger.info("EDI coverage resources", {
      service: "edi-coverage", scanId: this.scanId, event, phase, rows: this.rows, evidenceBytes: this.bytes,
      elapsedMs: Math.round(performance.now() - this.started), rss, heapUsed, external, ...extra,
    });
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
