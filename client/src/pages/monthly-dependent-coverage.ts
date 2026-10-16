import type { CoveredDependent } from "@shared/covered-dependent-history";
import type { MonthlyCoverageRow } from "./worker-monthly-coverage-history";

/** One person per loaded span, regardless of benefit changes or disjoint appearances.
 * Use the newest retained metadata; this is not a historical identity snapshot. */
export function summarizeDependentCoverage(rows: MonthlyCoverageRow[]) {
  const people = new Map<string, CoveredDependent>();
  let unavailableMonths = 0;
  for (const row of [...rows].sort((a, b) =>
    (b.coverageMonth.year * 12 + b.coverageMonth.month) -
    (a.coverageMonth.year * 12 + a.coverageMonth.month))) {
    if (row.dependentCoverage?.state !== "available") {
      unavailableMonths++;
      continue;
    }
    for (const person of row.dependentCoverage.dependents) {
      if (!people.has(person.personId)) people.set(person.personId, person);
    }
  }
  return {
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId)),
    unavailableMonths,
  };
}
