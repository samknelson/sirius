import { useMemo, useState } from "react";
import {
  ChevronDown,
  Eye,
  HeartPulse,
  Pill,
  Smile,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MONTHLY_COVERAGE_PAGE,
  MONTHLY_COVERAGE_ROWS,
  type BenefitIcon,
  type MonthlyCoverageRow,
} from "./_data";
import "./_group.css";

const localIcons: Record<string, LucideIcon> = {
  Eye,
  HeartPulse,
  Pill,
  Smile,
  Wallet,
};

type CoverageRun = {
  id: string;
  status: MonthlyCoverageRow["status"];
  rows: MonthlyCoverageRow[];
};

function renderIcon(iconName: string | null | undefined, className: string) {
  const Icon = iconName ? localIcons[iconName] : undefined;
  return Icon ? <Icon className={className} aria-hidden="true" /> : null;
}

function formatHours(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Unavailable"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`;
}

function NamedBenefit({ benefit }: { benefit: BenefitIcon }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/20 text-muted-foreground"
        style={benefit.color ? { color: benefit.color } : undefined}
      >
        {renderIcon(benefit.icon ?? undefined, "h-4 w-4") ?? <Star className="h-4 w-4" />}
      </span>
      <span className="min-w-0 break-words text-muted-foreground">{benefit.name}</span>
    </div>
  );
}

function monthOrdinal(row: MonthlyCoverageRow): number {
  return row.coverageMonth.year * 12 + row.coverageMonth.month;
}

function groupRuns(rows: MonthlyCoverageRow[]): CoverageRun[] {
  const runs: CoverageRun[] = [];
  for (const row of rows) {
    const current = runs[runs.length - 1];
    const priorRow = current?.rows[current.rows.length - 1];
    const isAdjacent = priorRow && monthOrdinal(priorRow) - monthOrdinal(row) === 1;
    if (current && current.status === row.status && isAdjacent) {
      current.rows.push(row);
    } else {
      runs.push({
        id: `${row.coverageMonth.year}-${row.coverageMonth.month}-${row.status}`,
        status: row.status,
        rows: [row],
      });
    }
  }
  return runs;
}

function statusName(status: MonthlyCoverageRow["status"]): string {
  return status === "active" ? "Active" : status === "inactive" ? "Inactive" : "Not confirmed";
}

function CoverageMonth({ row, showCharges }: { row: MonthlyCoverageRow; showCharges: boolean }) {
  return (
    <article
      className={`coverage-first-decision text-sm${row.status === "inactive" ? " coverage-first-decision--not-covered" : row.status === "unknown" ? " coverage-first-decision--quiet" : ""}`}
      aria-label={`Coverage for ${row.coverageMonth.label}`}
      data-testid="monthly-coverage-card"
    >
      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-testid="monthly-coverage-card-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
          <h3 className="text-base font-semibold">{row.coverageMonth.label}</h3>
        </div>
        <span className={`coverage-first-status order-3 col-span-2 justify-self-center text-center sm:order-2 sm:col-span-1 ${row.status === "active" ? "coverage-first-status--covered" : row.status === "inactive" ? "coverage-first-status--not-covered" : "coverage-first-status--quiet"}`} role="status">
          {statusName(row.status)}
        </span>
        <div className="order-2 min-w-0 text-right sm:order-3">
          <p className="text-xs font-medium text-muted-foreground">Work month</p>
          <p className="text-base font-semibold">{row.workMonth.label}</p>
        </div>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2" data-testid="monthly-coverage-card-columns">
        <section aria-label={`Benefits for ${row.coverageMonth.label}`} className="min-w-0 rounded-md border bg-background p-3">
          <h4 className="font-semibold">Benefits received for {row.coverageMonth.label}</h4>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="monthly-medical-dental-benefits">
            {row.medical.length
              ? (row.medicalBenefitIcons ?? row.medical.map((name) => ({ name, icon: null, color: null })))
                .map((benefit) => <NamedBenefit key={`medical-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded medical benefit</span>}
            {row.dental.length
              ? (row.dentalBenefitIcons ?? row.dental.map((name) => ({ name, icon: null, color: null })))
                .map((benefit) => <NamedBenefit key={`dental-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded dental benefit</span>}
          </div>
          {row.other.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Other recorded benefits:</p>
              <TooltipProvider>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Other recorded benefits">
                  {(row.otherBenefitIcons ?? row.other.map((name) => ({ name, icon: null, color: null }))).map((benefit, index) => (
                    <li key={`${benefit.name}-${index}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            aria-label={benefit.name}
                            className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-full bg-muted/20 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={benefit.color ? { color: benefit.color } : undefined}
                          >
                            {renderIcon(benefit.icon ?? undefined, "h-4 w-4") ?? <Star className="h-4 w-4" />}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{benefit.name}</TooltipContent>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </TooltipProvider>
            </div>
          )}
          {row.status === "inactive" && (
            <p className="mt-3 border-t pt-3 text-muted-foreground">
              <span className="font-medium text-foreground">Scan reason: </span>
              {row.reasons.length ? row.reasons.join(" · ") : "No specific reason confirmed by the scan."}
            </p>
          )}
        </section>
        <section aria-label={`Work-month evidence for ${row.workMonth.label}`} className="min-w-0 rounded-md border bg-background p-3">
          <h4 className="font-semibold">Hours by employer</h4>
          {row.employerHours === null || row.employerHours === undefined ? (
            <p className="mt-1 text-muted-foreground">Employer hours unavailable.</p>
          ) : row.employerHours.length === 0 ? (
            <p className="mt-1 text-muted-foreground">No employer hours recorded for this work month.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {row.employerHours.map((employer, index) => (
                <li key={`${employer.employerId ?? employer.employerName}-${index}`} className="flex min-w-0 flex-wrap justify-between gap-x-3">
                  <span className="min-w-0 break-words">{employer.employerName}</span>
                  <strong className="shrink-0 tabular-nums">{formatHours(employer.reported)}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t pt-3">
            <p>Total reported across employers: <strong className="tabular-nums">{formatHours(row.hours?.reported)}</strong></p>
            <p className="mt-1">Applicable threshold: <strong className="tabular-nums">{formatHours(row.hours?.required)}</strong></p>
            {(row.hours?.reported === null || row.hours?.reported === undefined ||
              row.hours.required === null || row.hours.required === undefined) && (
                <p className="mt-2 text-xs text-muted-foreground">Hours are evidence for the review; they do not by themselves determine coverage.</p>
              )}
          </div>
        </section>
      </div>
      {row.status === "unknown" && <p className="mt-3 rounded-md bg-muted/40 p-3 text-muted-foreground">A reliable coverage decision is not available for this month.</p>}
      {showCharges && (
        <p className="mt-3 border-t pt-3">
          Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong>
        </p>
      )}
    </article>
  );
}

export function ExceptionAccordion() {
  const [visibleCount, setVisibleCount] = useState(20);
  const visibleRows = MONTHLY_COVERAGE_ROWS.slice(0, visibleCount);
  const runs = useMemo(() => groupRuns(visibleRows), [visibleRows]);
  const lastRunId = runs[runs.length - 1]?.id;
  const [runOpenOverrides, setRunOpenOverrides] = useState<Record<string, boolean>>({});

  return (
    <div className="monthly-history-preview min-h-screen bg-background text-foreground">
      <section
        id="monthly-coverage-history"
        tabIndex={-1}
        aria-label="Monthly coverage history"
        className="mt-6 scroll-mt-4"
        data-testid="worker-monthly-coverage-history"
      >
        <Card>
          <CardHeader>
            <CardTitle>Monthly coverage history</CardTitle>
            <p className="text-sm text-muted-foreground">
              Coverage months are based on work three months earlier. Only recorded benefits and confirmed scan decisions are shown as known.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {MONTHLY_COVERAGE_PAGE.partial && (
              <p role="status" className="rounded-lg border p-3 text-sm">
                Some history may be unavailable. Months without a confirmed decision are shown as not confirmed—not as inactive.
              </p>
            )}
            {MONTHLY_COVERAGE_PAGE.total === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No monthly coverage, hours, scan, or charge history has been recorded for this worker.
              </p>
            )}
            {runs.map((run, index) => {
              const isOpen = runOpenOverrides[run.id] ?? run.status !== "active";
              const oldest = run.rows[run.rows.length - 1].coverageMonth.label;
              const newest = run.rows[0].coverageMonth.label;
              const range = oldest === newest ? oldest : `${oldest} – ${newest}`;
              const count = run.rows.length;
              const olderRun = runs[index + 1];
              const nextBoundary = olderRun
                ? `Status changed between ${olderRun.rows[0].coverageMonth.label} and ${run.rows[run.rows.length - 1].coverageMonth.label}.`
                : null;
              const isOldestLoadedRun = run.id === lastRunId;

              return (
                <section
                  key={run.id}
                  className={`coverage-first-decision text-sm${run.status === "inactive" ? " coverage-first-decision--not-covered" : run.status === "unknown" ? " coverage-first-decision--quiet" : ""}`}
                  aria-label={`${statusName(run.status)} coverage, ${range}`}
                  data-testid="coverage-status-run"
                >
                  <button
                    type="button"
                    className="w-full rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                    aria-expanded={isOpen}
                    aria-controls={`coverage-run-${run.id}`}
                    onClick={() => setRunOpenOverrides((current) => ({ ...current, [run.id]: !isOpen }))}
                  >
                    <span className="flex flex-wrap items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`coverage-first-status ${run.status === "active" ? "coverage-first-status--covered" : run.status === "inactive" ? "coverage-first-status--not-covered" : "coverage-first-status--quiet"}`}>
                            {statusName(run.status)}
                          </span>
                          {run.status === "inactive" && (
                            <span className="text-xs font-semibold uppercase tracking-wide">Coverage interruption</span>
                          )}
                          {run.status === "unknown" && (
                            <span className="text-xs font-medium">Separate, unconfirmed period</span>
                          )}
                        </span>
                        <span className="mt-2 block text-base font-semibold">{range}</span>
                        <span className="mt-1 block text-muted-foreground">
                          {count} {count === 1 ? "month" : "months"} in this recorded run
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-foreground">
                        {isOpen ? "Hide monthly details" : "Inspect months"}
                        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                      </span>
                    </span>
                    {nextBoundary && (
                      <span className="mt-3 block border-t border-current/10 pt-2 text-xs text-muted-foreground">
                        {nextBoundary}
                      </span>
                    )}
                    {run.status === "active" && !isOpen && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Recorded status only; benefits may vary by month.
                      </span>
                    )}
                    {isOldestLoadedRun && MONTHLY_COVERAGE_PAGE.partial && (
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Oldest month currently loaded; earlier history may change this boundary.
                      </span>
                    )}
                  </button>
                  {isOpen && (
                    <div id={`coverage-run-${run.id}`} className="mt-4 space-y-3 border-t border-current/10 pt-4">
                      {run.rows.map((row) => (
                        <CoverageMonth key={`${row.coverageMonth.year}-${row.coverageMonth.month}`} row={row} showCharges={MONTHLY_COVERAGE_PAGE.showCharges} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {visibleRows.length < MONTHLY_COVERAGE_PAGE.total && (
              <Button variant="outline" onClick={() => setVisibleCount(MONTHLY_COVERAGE_ROWS.length)}>
                Load older months
              </Button>
            )}
            {visibleRows.length > 0 && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Showing {visibleRows.length} of {MONTHLY_COVERAGE_PAGE.total} months.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}