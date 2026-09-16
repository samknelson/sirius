export const DAILY_SYNC_COMMAND = [
  "npx",
  "tsx",
  "scripts/s1-migration/run-scheduled-daily.ts",
] as const;

export const FORBIDDEN_SCHEDULED_FLAGS = [
  "--skip-stage",
  "--force-reconcile",
  "--allow-rejects",
  "--allow-findings",
  "--keep-going",
  "--dry-run",
] as const;

export type DailySyncReport = {
  command?: unknown;
  mode?: unknown;
  profile?: unknown;
  result?: unknown;
  durationSec?: unknown;
  forceReconcile?: unknown;
  skipStage?: unknown;
  keepGoing?: unknown;
  gates?: unknown;
  fleetTotals?: unknown;
  findingsByKind?: unknown;
};

export type SanitizedDailySummary = {
  status: "success" | "findings" | "failure";
  result: "PASS" | "FAIL";
  durationSec: number | null;
  gates: Record<string, string>;
  counters: Record<string, number>;
  findingsByKind: Record<string, number>;
};

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function numberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

export function assertScheduledDailyReport(report: DailySyncReport): void {
  const violations: string[] = [];
  if (report.command !== "sync") violations.push("command must be sync");
  if (report.mode !== "daily") violations.push("mode must be daily");
  if (report.profile !== "production") violations.push("profile must be production");
  if (report.forceReconcile !== false) violations.push("forceReconcile must be false");
  if (report.skipStage !== false) violations.push("skipStage must be false");
  if (report.keepGoing !== false) violations.push("keepGoing must be false");
  if (report.result !== "PASS" && report.result !== "FAIL") violations.push("result must be PASS or FAIL");
  if (violations.length) throw new Error(`scheduled daily report contract failed: ${violations.join("; ")}`);
}

export function sanitizeDailySummary(report: DailySyncReport): SanitizedDailySummary {
  assertScheduledDailyReport(report);
  const findingsByKind = numberMap(report.findingsByKind);
  const result = report.result as "PASS" | "FAIL";
  return {
    status: result === "FAIL" ? "failure" : Object.keys(findingsByKind).length ? "findings" : "success",
    result,
    durationSec:
      typeof report.durationSec === "number" && Number.isFinite(report.durationSec)
        ? report.durationSec
        : null,
    gates: stringMap(report.gates),
    counters: numberMap(report.fleetTotals),
    findingsByKind,
  };
}

export function summaryMessage(summary: SanitizedDailySummary, completedAt = new Date()): string {
  return JSON.stringify({
    event: "s1-daily-sync-completed",
    completedAt: completedAt.toISOString(),
    ...summary,
  });
}

export function assertNoForbiddenScheduledFlags(argv: string[]): void {
  const found = FORBIDDEN_SCHEDULED_FLAGS.filter((flag) => argv.includes(flag));
  if (found.length) throw new Error(`scheduled daily sync refuses operator-only flags: ${found.join(", ")}`);
}
