import type { DependentCoverageEvidence } from "@shared/covered-dependent-history";
import type { MonthlyCoverageRow } from "./worker-monthly-coverage-history";
import { summarizeDependentCoverage } from "./monthly-dependent-coverage";

export function CoveredDependentsMonth({ evidence, month }: { evidence?: DependentCoverageEvidence; month: string }) {
  return (
    <section aria-label={`Covered dependents for ${month}`} className="mt-4 min-w-0 rounded-md border bg-background p-3">
      <h5 className="font-semibold">Covered dependents for {month}</h5>
      <p className="mt-1 text-xs text-muted-foreground">People with recorded coverage provided through this worker for this month. Names and relationship labels use retained metadata, not a historical identity snapshot.</p>
      {evidence?.state !== "available" ? (
        <p role="status" className="mt-2">Dependent coverage evidence is unavailable for this month.</p>
      ) : !evidence.dependents.length ? (
        <p className="mt-2 text-muted-foreground">No recorded dependent coverage for this month.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {Array.from(new Map(evidence.dependents.map((person) => [person.personId, person])).values()).map((person) => (
            <li key={person.personId} className="min-w-0 break-words">
              <p className="font-medium">{person.name} <span className="font-normal text-muted-foreground">· {person.relationship ?? "Relationship unavailable"}</span></p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function CoveredDependentsSpan({ rows, olderUnloaded }: { rows: MonthlyCoverageRow[]; olderUnloaded: boolean }) {
  const summary = summarizeDependentCoverage(rows);
  return (
    <section aria-label="Covered dependents in loaded span" className="min-w-0 rounded-md border bg-background p-3 text-sm">
      <h4 className="font-semibold">Covered dependents in this span</h4>
      <p className="mt-1 text-xs text-muted-foreground">Each person evidenced in the loaded span is listed once. Select a month to see who is evidenced for that month. Names and relationship labels use retained metadata, not a historical identity snapshot.</p>
      {olderUnloaded && <p role="status" className="mt-2 text-xs">Older months have not loaded; this dependent list may be incomplete.</p>}
      {summary.unavailableMonths > 0 && <p role="status" className="mt-2">Dependent coverage evidence is unavailable for {summary.unavailableMonths} {summary.unavailableMonths === 1 ? "month" : "months"} in this span. This list includes only available evidence and may be incomplete.</p>}
      {!summary.people.length && summary.unavailableMonths === 0 && <p className="mt-2 text-muted-foreground">No recorded dependent coverage for this span.</p>}
      {summary.people.length > 0 && (
        <ul className="mt-3 space-y-3">
          {summary.people.map((person) => (
            <li key={person.personId} className="min-w-0 break-words">
              <span className="font-medium">{person.name}</span>
              <span className="text-muted-foreground"> · {person.relationship ?? "Relationship unavailable"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
