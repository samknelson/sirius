import { and, eq, exists, gt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { employers, trustWmb } from "@shared/schema";
import type { EdiCoverageConflict } from "@shared/edi-coverage-choices";
import type { TrustProviderEdiContext } from "./registry";
import { CoverageBudget, CoverageBudgetError, COVERAGE_LIMITS, readBudgetedPages, type CoverageCorrelation } from "./coverage-budget";
import { competingSources, coverageKey, type EvidenceRow, type ExcludedGroup } from "./coverage-conflicts";
import { coverageDatabaseFailure } from "./coverage-database-error";
import { coverageColumns, describer } from "./coverage-evidence";
import { monthIndex, monthParts, monthStart } from "./termination-policy";

/**
 * Every remaining conflict, across all benefits, for a range of coverage
 * months. Read-only, and outside any feed run: it excludes nothing and
 * acknowledges nothing. What a conflict IS stays in `competingSources`.
 *
 * Only root conflicts are listed. A dependent a feed leaves out because their
 * subscriber's month conflicts is a consequence, cleared by the same correction.
 */

/** A sanity bound on statements per run; the resource budget is the real ceiling. */
export const MAX_CONFLICT_LIST_MONTHS = 120;
const DEFAULT_MONTHS = 12;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthLabel = (index: number) => monthStart(index).slice(0, 7);

export interface ConflictListRange { from: number; to: number }

/** Blank To is the current month; blank From is the twelve months ending at To. */
export function conflictListRange(
  config: { fromMonth?: unknown; toMonth?: unknown }, today = new Date(),
): ConflictListRange {
  const parse = (value: unknown, label: string, fallback: () => number) => {
    if (value === undefined || value === null || value === "") return fallback();
    if (typeof value !== "string" || !MONTH.test(value))
      throw new Error(`${label} must be a month formatted YYYY-MM, for example 2026-01.`);
    return monthIndex(Number(value.slice(0, 4)), Number(value.slice(5, 7)));
  };
  // Server-local calendar fields: the process zone is the site zone.
  const to = parse(config.toMonth, "To month", () => monthIndex(today.getFullYear(), today.getMonth() + 1));
  const from = parse(config.fromMonth, "From month", () => to - (DEFAULT_MONTHS - 1));
  if (from > to)
    throw new Error(`From month (${monthLabel(from)}) must not be after To month (${monthLabel(to)}).`);
  if (to - from + 1 > MAX_CONFLICT_LIST_MONTHS)
    throw new Error(`Choose a range of at most ${MAX_CONFLICT_LIST_MONTHS} months; ${monthLabel(from)} to ${monthLabel(to)} is ${to - from + 1}.`);
  return { from, to };
}

type Read = TrustProviderEdiContext["storage"]["readOnly"]["query"];

export interface ConflictList {
  conflicts: EdiCoverageConflict[];
  /** Coverage records named by the conflicts. */
  recordCount: number;
  /** Distinct people with at least one conflict. */
  peopleCount: number;
}

/**
 * `read` is the caller's read-only query: the plugin that owns the report
 * declares the read-only opt-in, and nothing here can write.
 */
export async function readConflictingCoverage(
  read: Read, range: ConflictListRange,
  report: (processed: number, total: number, phase: string) => Promise<void> | void = () => {},
  correlation: CoverageCorrelation = {},
): Promise<ConflictList> {
  const budget = new CoverageBudget(correlation);
  const total = range.to - range.from + 1;
  async function phase<T>(name: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    budget.log("phase-start", name);
    try {
      return await work();
    } catch (error) {
      if (error instanceof CoverageBudgetError) throw tooLarge(error);
      throw coverageDatabaseFailure(error, name, Math.round(performance.now() - started), correlation);
    }
  }

  const groups: ExcludedGroup[] = [];
  const other = alias(trustWmb, "other_coverage");
  for (let index = range.from; index <= range.to; index++) {
    const { year, month } = monthParts(index);
    const name = `Reading ${monthLabel(index)} coverage`;
    await report(index - range.from, total, name);
    // The database only narrows to months holding more than one record, which
    // every conflict needs. Each such month arrives complete — all of the
    // person's records for it — and `competingSources` alone judges it.
    const rows: EvidenceRow[] = await phase(name, () => readBudgetedPages(budget, (after, pageSize) =>
      read(db => db.select(coverageColumns).from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        // No benefit filter: every benefit is in scope.
        .where(and(eq(trustWmb.year, year), eq(trustWmb.month, month),
          after ? gt(trustWmb.id, after) : undefined,
          exists(db.select({ one: sql`1` }).from(other).where(and(
            eq(other.workerId, trustWmb.workerId), eq(other.benefitId, trustWmb.benefitId),
            eq(other.year, trustWmb.year), eq(other.month, trustWmb.month), ne(other.id, trustWmb.id))))))
        .orderBy(trustWmb.id).limit(pageSize))));
    const months = new Map<string, EvidenceRow[]>();
    for (const row of rows) {
      const key = coverageKey(row);
      const group = months.get(key);
      if (group) group.push(row); else months.set(key, [row]);
    }
    for (const group of months.values()) {
      if (competingSources(group))
        groups.push({ reason: "conflicting-coverage", rows: [...group].sort((a, b) => a.id.localeCompare(b.id)) });
      // Equivalent same-family, same-class duplicates are not conflicts.
      else for (const row of group) budget.release(row);
    }
  }

  await report(total, total, "Describing conflicts");
  const conflicts = await phase("Describing conflicts", async () => {
    const describe = await describer(read, groups, new Map());
    return groups.map(group => {
      const { kind: _kind, reason: _reason, ...conflict } = describe("exclusion", group);
      budget.weigh(conflict);
      return conflict;
    }).sort(conflictOrder);
  });
  budget.log("complete", "Conflict list complete", { months: total, conflicts: conflicts.length });
  return {
    conflicts,
    recordCount: conflicts.reduce((count, conflict) => count + conflict.records.length, 0),
    peopleCount: new Set(conflicts.map(conflict => conflict.workerId)).size,
  };
}

/** A person's conflicts together, oldest month first. */
export const conflictOrder = (a: EdiCoverageConflict, b: EdiCoverageConflict) =>
  a.personLabel.localeCompare(b.personLabel) || a.workerId.localeCompare(b.workerId) ||
  a.month.localeCompare(b.month) || a.benefitLabel.localeCompare(b.benefitLabel) || a.benefitId.localeCompare(b.benefitId);

/** The shared ceilings, with the one remedy a report has: a shorter range. */
function tooLarge(error: CoverageBudgetError): Error {
  const { exceeded, scanId, phase } = error.diagnostics;
  return new Error(`The conflicting coverage in this range is too large to list safely (${exceeded.map(
    d => `${d.dimension} ${d.observed} > ${d.limit}`).join("; ")}; stage: ${phase}). Nothing was saved. ` +
    `Choose a shorter range of months and run the report again. Reference: ${scanId}.`, { cause: error });
}

/** Statement limit for every read the list makes. */
export const CONFLICT_LIST_QUERY_MS = COVERAGE_LIMITS.queryMs;
