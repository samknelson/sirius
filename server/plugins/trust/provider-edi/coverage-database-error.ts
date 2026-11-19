import { randomUUID } from "node:crypto";
import { DrizzleQueryError } from "drizzle-orm";
import { logger } from "../../../logger";
import type { CoverageCorrelation } from "./coverage-budget";

/** Never relay a driver's message/detail: it can contain SQL, parameters or row data. */
const REASONS: Record<string, { reason: string; guidance: string }> = {
  "57014": {
    reason: "the database cancelled the query (a statement timeout or another cancellation)",
    guidance: "Ask an administrator to inspect the query diagnostics before retrying.",
  },
  "55P03": {
    reason: "the database could not acquire a required lock",
    guidance: "Ask an administrator to check for blocked database work, then retry.",
  },
  "42P01": {
    reason: "a required database table is unavailable",
    guidance: "Ask an administrator to check database migrations before retrying.",
  },
  "42703": {
    reason: "a required database column is unavailable",
    guidance: "Ask an administrator to check database migrations before retrying.",
  },
  "42883": {
    reason: "the database could not resolve an operator or function",
    guidance: "Ask an administrator to inspect the query and database schema before retrying.",
  },
  "42501": {
    reason: "the database refused access",
    guidance: "Ask an administrator to check database permissions before retrying.",
  },
  "53100": {
    reason: "the database ran out of storage",
    guidance: "Ask an administrator to inspect database capacity before retrying.",
  },
  "53400": {
    reason: "the query reached a database resource limit",
    guidance: "Ask an administrator to inspect the query diagnostics before retrying.",
  },
};
const CONNECTION_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND"]);

export class CoverageDatabaseError extends Error {
  constructor(readonly diagnostics: CoverageCorrelation & {
    reference: string; phase: string; milliseconds: number; code?: string;
    severity?: string; routine?: string;
  }, cause: unknown) {
    const known = diagnostics.code && REASONS[diagnostics.code];
    const connection = diagnostics.code &&
      (CONNECTION_CODES.has(diagnostics.code) || diagnostics.code.startsWith("08"));
    const reason = known ? known.reason : connection ? "the database connection was interrupted or unavailable" : "a database operation failed";
    const guidance = known ? known.guidance : connection ? "Retry Check coverage again once. If it fails again, ask an administrator to inspect the diagnostics." :
      "Ask an administrator to inspect the query diagnostics before retrying.";
    super(`Coverage check failed during ${diagnostics.phase}: ${reason}. ${guidance} Reference: ${diagnostics.reference}. No partial review was accepted and no file was generated.`, { cause });
    this.name = "CoverageDatabaseError";
  }
}

/** Unwrap Drizzle's SQL-and-parameters envelope, retaining only safe diagnostic fields. */
export function coverageDatabaseFailure(
  error: unknown, phase: string, milliseconds: number, correlation: CoverageCorrelation = {},
): unknown {
  if (error instanceof CoverageDatabaseError) return error;
  let current = error;
  let database = false;
  let code: string | undefined;
  let severity: string | undefined;
  let routine: string | undefined;
  const seen = new Set<unknown>();
  for (let depth = 0; current && typeof current === "object" && depth < 10 && !seen.has(current); depth++) {
    seen.add(current);
    const item = current as Record<string, unknown>;
    if (current instanceof DrizzleQueryError) database = true;
    if (typeof item.code === "string" && (/^[0-9A-Z]{5}$/.test(item.code) || CONNECTION_CODES.has(item.code))) {
      database = true;
      code = item.code;
      // These fields describe server code, not the SQL or affected records.
      severity = typeof item.severity === "string" && /^(ERROR|FATAL|PANIC)$/.test(item.severity) ? item.severity : undefined;
      routine = typeof item.routine === "string" && /^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(item.routine) ? item.routine : undefined;
    }
    current = item.cause;
  }
  if (!database) return error;
  const diagnostics = { reference: randomUUID(), ...correlation, phase, milliseconds, code, severity, routine };
  logger.error("EDI coverage database operation failed", {
    service: "edi-coverage", event: "database-failed", ...diagnostics,
  });
  return new CoverageDatabaseError(diagnostics, error);
}
