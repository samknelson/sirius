import type { DependentCoverageEvidence } from "@shared/covered-dependent-history";
import type { MonthlyCoverageRow } from "./worker-monthly-coverage-history";
import { summarizeDependentCoverage } from "./monthly-dependent-coverage";

export function CoveredDependentsMonth({ evidence, month }: { evidence?: DependentCoverageEvidence; month: string }) {
  return (
    <section aria-label={`Covered dependents for ${month}`} className="mt-4 min-w-0 rounded-md border bg-background p-3">
      <h5 className="font-semibold">Covered dependents for {month}</h5>
      <p className="mt-1 text-xs text-muted-foreground">Recorded benefits provided through this worker. Names and relationship labels use retained metadata, not a historical identity snapshot.</p>
      {evidence?.state !== "available" ? (
        <p role="status" className="mt-2">Dependent coverage evidence is unavailable for this month.</p>
      ) : !evidence.dependents.length ? (
        <p className="mt-2 text-muted-foreground">No recorded dependent coverage for this month.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {evidence.dependents.map((person) => (
            <li key={person.personId} className="min-w-0 break-words">
              <p className="font-medium">{person.name} <span className="font-normal text-muted-foreground">· {person.relationship ?? "Relationship unavailable"}</span></p>
              <ul aria-label={`Recorded benefits for ${person.name}`} className="mt-1 list-inside list-disc text-muted-foreground">
                {person.benefits.map((benefit) => <li key={benefit.id}>{benefit.name}</li>)}
              </ul>
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
      <p className="mt-1 text-xs text-muted-foreground">Inclusive recorded month ranges within the loaded span. Names and relationship labels use retained metadata. Benefits may change; select a month for its authoritative detail.</p>
      {olderUnloaded && <p role="status" className="mt-2 text-xs">Older months have not loaded; these ranges may continue further back.</p>}
      {summary.unavailableMonths > 0 && <p role="status" className="mt-2">Dependent coverage evidence is unavailable for {summary.unavailableMonths} {summary.unavailableMonths === 1 ? "month" : "months"} in this span. Ranges include only available evidence.</p>}
      {!summary.people.length && summary.unavailableMonths === 0 && <p className="mt-2 text-muted-foreground">No recorded dependent coverage for this span.</p>}
      {summary.people.length > 0 && (
        <ul className="mt-3 space-y-3">
          {summary.people.map(({ personId, ranges }) => (
            <li key={personId} className="min-w-0">
              <ul className="space-y-2">
                {ranges.map(({ from, through, person }) => (
                  <li key={`${from.year}-${from.month}`} className="break-words">
                    <span className="font-medium">{person.name}</span>
                    <span className="text-muted-foreground"> · {person.relationship ?? "Relationship unavailable"}</span>
                    <p>{from.label}{from.year !== through.year || from.month !== through.month ? ` – ${through.label}` : ""}</p>
                    <p className="text-muted-foreground">{person.benefits.map((benefit) => benefit.name).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
