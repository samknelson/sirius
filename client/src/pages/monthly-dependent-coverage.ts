import type { CoveredDependent } from "@shared/covered-dependent-history";
import type { MonthlyCoverageRow } from "./worker-monthly-coverage-history";

type Month = MonthlyCoverageRow["coverageMonth"];
export interface DependentRange {
  from: Month;
  through: Month;
  person: CoveredDependent;
}

/** Summarize only loaded, available months; gaps never imply continuity. */
export function summarizeDependentCoverage(rows: MonthlyCoverageRow[]) {
  const people = new Map<string, DependentRange[]>();
  let unavailableMonths = 0;
  for (const row of [...rows].sort((a, b) => ordinal(a.coverageMonth) - ordinal(b.coverageMonth))) {
    if (row.dependentCoverage?.state !== "available") {
      unavailableMonths++;
      continue;
    }
    for (const person of row.dependentCoverage.dependents) {
      const ranges = people.get(person.personId) ?? [];
      const last = ranges[ranges.length - 1];
      if (last && ordinal(row.coverageMonth) - ordinal(last.through) === 1 &&
          signature(last.person) === signature(person)) {
        last.through = row.coverageMonth;
      } else {
        ranges.push({ from: row.coverageMonth, through: row.coverageMonth, person });
      }
      people.set(person.personId, ranges);
    }
  }
  return {
    people: [...people.entries()].map(([personId, ranges]) => ({ personId, ranges }))
      .sort((a, b) => a.ranges[0].person.name.localeCompare(b.ranges[0].person.name) || a.personId.localeCompare(b.personId)),
    unavailableMonths,
  };
}

function ordinal(month: Month) { return month.year * 12 + month.month; }
function signature(person: CoveredDependent) {
  return JSON.stringify([person.name, person.relationship,
    person.benefits.map((benefit) => [benefit.id, benefit.name]).sort((a, b) => a[0].localeCompare(b[0]))]);
}
