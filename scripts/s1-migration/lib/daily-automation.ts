import type { WmbEventPhase } from "./wmb-event-phase";

export const DAILY_SYNC_COMMAND = [
  "npx",
  "tsx",
  "scripts/s1-migration/run-scheduled-daily.ts",
] as const;

export const SCHEDULED_SYNC_ARGS = [
  "tsx",
  "scripts/s1-migration/sync.ts",
  "--mode",
  "daily",
  "--profile",
  "production",
  "--skip-seeders",
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
  skipSeeders?: unknown;
  keepGoing?: unknown;
  gates?: unknown;
  fleetTotals?: unknown;
  findingsByKind?: unknown;
  wmbEvents?: unknown;
};

export type SanitizedDailySummary = {
  status: "success" | "findings" | "failure";
  result: "PASS" | "FAIL";
  durationSec: number | null;
  gates: Record<string, string>;
  counters: Record<string, number>;
  findingsByKind: Record<string, number>;
  wmbEvents: WmbEventPhase;
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

/** Explicit allowlist, not a spread of child data: alerts must never expose
 * worker samples, benefit IDs, SQL or untrusted exception strings. */
export function sanitizedWmbEvents(value: unknown): WmbEventPhase {
  if (!value || typeof value !== "object") throw new Error("missing WMB event phase");
  const phase = value as WmbEventPhase;
  const statuses = ["pass", "fail", "disabled", "skipped"];
  const reasons = ["awaiting-tested-image-activation", "coverage-not-completed",
    "dry-run-no-verified-stored-history-cutoff", "unsafe-or-missing-complete-history-evidence",
    "missing-completed-stage-evidence",
    "invalid-traversal-bound", "malformed-page-result", "malformed-event-totals",
    "inconsistent-event-totals", "worker-reconciliation-failed", "unfinished-traversal",
    "stalled-or-invalid-cursor", "page-limit-exceeded", "page-execution-failed"];
  const counterKeys = ["created", "unchanged", "removed", "skipped"] as const;
  const validCounters = (counts: unknown, keys: readonly string[]) =>
    !!counts && typeof counts === "object" && keys.every(key => {
      const count = (counts as Record<string, unknown>)[key];
      return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
    });
  if (!statuses.includes(phase.status) || phase.basis !== "stored-coverage" ||
      !["live", "preview"].includes(phase.mode) ||
      (phase.cutoff !== null && (typeof phase.cutoff !== "string" ||
        !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(phase.cutoff))) ||
      !Number.isFinite(phase.durationSec) || phase.durationSec < 0 ||
      !Number.isSafeInteger(phase.pages) || phase.pages < 0 ||
      !Number.isSafeInteger(phase.workers) || phase.workers < 0 ||
      typeof phase.complete !== "boolean" ||
      (phase.reason !== null && !reasons.includes(phase.reason)) ||
      !validCounters(phase.totals, [...counterKeys, "failed"]) ||
      !phase.byType || !["start", "restart", "terminate"].every(type =>
        validCounters(phase.byType[type as keyof typeof phase.byType], counterKeys)) ||
      (phase.status === "pass" && (!phase.complete || !phase.cutoff || phase.totals.failed !== 0 || phase.reason !== null)) ||
      (phase.status !== "pass" && (phase.complete || phase.reason === null))) {
    throw new Error("malformed WMB event phase");
  }
  const counts = (data: Record<string, number>) =>
    Object.fromEntries(counterKeys.map(key => [key, data[key]])) as Omit<WmbEventPhase["totals"], "failed">;
  return {
    status: phase.status, reason: phase.reason, mode: phase.mode, basis: "stored-coverage",
    cutoff: phase.cutoff, durationSec: phase.durationSec, pages: phase.pages,
    workers: phase.workers, complete: phase.complete,
    totals: { ...counts(phase.totals), failed: phase.totals.failed },
    byType: { start: counts(phase.byType.start), restart: counts(phase.byType.restart),
      terminate: counts(phase.byType.terminate) },
  };
}

export function assertScheduledDailyReport(report: DailySyncReport): void {
  const violations: string[] = [];
  if (report.command !== "sync") violations.push("command must be sync");
  if (report.mode !== "daily") violations.push("mode must be daily");
  if (report.profile !== "production") violations.push("profile must be production");
  if (report.forceReconcile !== false) violations.push("forceReconcile must be false");
  if (report.skipStage !== false) violations.push("skipStage must be false");
  if (report.skipSeeders !== true) violations.push("skipSeeders must be true");
  if (report.keepGoing !== false) violations.push("keepGoing must be false");
  if (report.result !== "PASS" && report.result !== "FAIL") violations.push("result must be PASS or FAIL");
  const wmbEvents = sanitizedWmbEvents(report.wmbEvents);
  if (stringMap(report.gates).wmbEvents !== wmbEvents.status) violations.push("WMB event gate does not match phase");
  if (report.result === "PASS" && !["pass", "disabled"].includes(wmbEvents.status)) {
    violations.push("PASS requires WMB events pass or explicitly disabled");
  }
  if (report.result === "PASS") {
    const gates = stringMap(report.gates);
    for (const gate of ["stage", "fleet", "parity"]) {
      if (gates[gate] !== "pass") violations.push(`PASS requires ${gate} gate to pass`);
    }
  }
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
    wmbEvents: sanitizedWmbEvents(report.wmbEvents),
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
