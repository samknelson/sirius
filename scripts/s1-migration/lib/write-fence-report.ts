import type { AppWriteFenceLease } from "../../../server/services/s1-write-fence";

export interface WriteFenceReport {
  status?: string;
  released?: boolean;
  releaseStatus?: "released" | "failed";
  [key: string]: unknown;
}

/**
 * Release the exclusive sync fence and fold the terminal cleanup outcome into
 * the report. The caller persists this updated report only after its initial
 * aggregate row has been recorded while the fence is still held.
 */
export async function finalizeWriteFenceReport(
  lease: AppWriteFenceLease,
  report: Record<string, unknown>,
  failures: string[],
): Promise<void> {
  const current = (report.writeFence ?? {}) as WriteFenceReport;
  try {
    await lease.release();
    report.writeFence = {
      ...current,
      released: true,
      releaseStatus: "released",
    };
  } catch {
    failures.push(
      "app write fence release failed; the lock session was discarded and pool shutdown provides final cleanup",
    );
    report.writeFence = {
      ...current,
      released: false,
      releaseStatus: "failed",
    };
  }
  report.failures = failures;
  report.result = failures.length === 0 ? "PASS" : "FAIL";
}