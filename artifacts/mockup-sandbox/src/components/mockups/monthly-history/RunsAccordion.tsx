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

const localIcons: Record<string, LucideIcon> = { Eye, HeartPulse, Pill, Smile, Wallet };

type Run = { status: MonthlyCoverageRow["status"]; rows: MonthlyCoverageRow[] };

function statusLabel(status: MonthlyCoverageRow["status"]) {
  return status === "active" ? "Active" : status === "inactive" ? "Inactive" : "Not confirmed";
}

function formatHours(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Unavailable"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`;
}

function renderIcon(iconName: string | null | undefined, className: string) {
  const Icon = iconName ? localIcons[iconName] : undefined;
  return Icon ? <Icon className={className} aria-hidden="true" /> : null;
}

function NamedBenefit({ benefit }: { benefit: BenefitIcon }) {
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/20 text-muted-foreground"
        style={benefit.color ? { color: benefit.color } : undefined}
      >
        {renderIcon(benefit.icon, "h-4 w-4") ?? <Star className="h-4 w-4" />}
      </span>
      <span className="min-w-0 break-words text-muted-foreground">{benefit.name}</span>
    </div>
  );
}

function MonthEvidence({ row, showCharges }: { row: MonthlyCoverageRow; showCharges: boolean }) {
  const benefits = (items: string[], icons: BenefitIcon[] | undefined) =>
    icons ?? items.map((name) => ({ name, icon: null, color: null }));

  return (
    <article
      className={`coverage-first-decision text-sm${row.status === "inactive" ? " coverage-first-decision--not-covered" : row.status === "unknown" ? " coverage-first-decision--quiet" : ""}`}
      aria-label={`Coverage for ${row.coverageMonth.label}`}
      data-testid="monthly-coverage-card"
    >
      <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-testid="monthly-coverage-card-header">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
          <h4 className="text-base font-semibold">{row.coverageMonth.label}</h4>
        </div>
        <span className={`coverage-first-status order-3 col-span-2 justify-self-center text-center sm:order-2 sm:col-span-1 ${row.status === "active" ? "coverage-first-status--covered" : row.status === "inactive" ? "coverage-first-status--not-covered" : "coverage-first-status--quiet"}`} role="status">
          {statusLabel(row.status)}
        </span>
        <div className="order-2 min-w-0 text-right sm:order-3">
          <p className="text-xs font-medium text-muted-foreground">Work month</p>
          <p className="text-base font-semibold">{row.workMonth.label}</p>
        </div>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2" data-testid="monthly-coverage-card-columns">
        <section aria-label={`Benefits for ${row.coverageMonth.label}`} className="min-w-0 rounded-md border bg-background p-3">
          <h5 className="font-semibold">Benefits received for {row.coverageMonth.label}</h5>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="monthly-medical-dental-benefits">
            {row.medical.length
              ? benefits(row.medical, row.medicalBenefitIcons).map((benefit) => <NamedBenefit key={`medical-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded medical benefit</span>}
            {row.dental.length
              ? benefits(row.dental, row.dentalBenefitIcons).map((benefit) => <NamedBenefit key={`dental-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded dental benefit</span>}
          </div>
          {row.other.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Other recorded benefits:</p>
              <TooltipProvider>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Other recorded benefits">
                  {benefits(row.other, row.otherBenefitIcons).map((benefit, index) => (
                    <li key={`${benefit.name}-${index}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            aria-label={benefit.name}
                            className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-full bg-muted/20 text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            style={benefit.color ? { color: benefit.color } : undefined}
                          >
                            {renderIcon(benefit.icon, "h-4 w-4") ?? <Star className="h-4 w-4" />}
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
          <h5 className="font-semibold">Hours by employer</h5>
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

export function RunsAccordion() {
  const initialCount = Math.min(24, MONTHLY_COVERAGE_ROWS.length);
  const [visibleCount, setVisibleCount] = useState(initialCount);
  const [openRuns, setOpenRuns] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<Record<string, string>>({});
  const visibleRows = MONTHLY_COVERAGE_ROWS.slice(0, visibleCount);
  const runs = useMemo(() => {
    const result: Run[] = [];
    visibleRows.forEach((row) => {
      const latest = result[result.length - 1];
      const oldest = latest?.rows[latest.rows.length - 1]?.coverageMonth;
      const consecutive = oldest && oldest.year * 12 + oldest.month - (row.coverageMonth.year * 12 + row.coverageMonth.month) === 1;
      if (!latest || latest.status !== row.status || !consecutive) result.push({ status: row.status, rows: [row] });
      else latest.rows.push(row);
    });
    return result;
  }, [visibleRows]);
  const hasOlder = visibleCount < MONTHLY_COVERAGE_PAGE.total;
  const toggleRun = (id: string) =>
    setOpenRuns((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const partialBoundary = hasOlder;

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
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full bg-[hsl(170_40%_38%)]" /> Active
              <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[hsl(8_58%_43%)]" /> Inactive
              <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[hsl(39_22%_55%)]" /> Not confirmed
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {MONTHLY_COVERAGE_PAGE.partial && (
              <p role="status" className="rounded-lg border p-3 text-sm">
                Some coverage details are unavailable. Months without a confirmed decision are shown as unknown.
              </p>
            )}
            {MONTHLY_COVERAGE_PAGE.total === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No monthly coverage, hours, scan, or charge history has been recorded for this worker.
              </p>
            )}
            {runs.map((run, index) => {
              const latestMonth = run.rows[0].coverageMonth;
              const id = `coverage-run-${latestMonth.year}-${latestMonth.month}`;
              const isOpen = openRuns.includes(id);
              const newest = latestMonth.label;
              const oldest = run.rows[run.rows.length - 1].coverageMonth.label;
              const range = run.rows.length === 1 ? newest : `${oldest} – ${newest}`;
              const isOldestLoadedBoundary = index === runs.length - 1 && partialBoundary;
              const monthKey = (row: MonthlyCoverageRow) => `${row.coverageMonth.year}-${row.coverageMonth.month}`;
              const selectedRow = run.rows.find((row) => monthKey(row) === selectedMonths[id]) ?? run.rows[0];
              return (
                <section
                  key={`${run.status}-${id}`}
                  className={`coverage-first-decision p-0${run.status === "inactive" ? " coverage-first-decision--not-covered" : run.status === "unknown" ? " coverage-first-decision--quiet" : ""}`}
                  aria-label={`${statusLabel(run.status)} coverage ${range}`}
                >
                  <h3>
                    <button
                      type="button"
                      id={`${id}-button`}
                      aria-expanded={isOpen}
                      aria-controls={`${id}-panel`}
                      onClick={() => toggleRun(id)}
                      className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className={`coverage-first-status ${run.status === "active" ? "coverage-first-status--covered" : run.status === "inactive" ? "coverage-first-status--not-covered" : "coverage-first-status--quiet"}`}>
                        {statusLabel(run.status)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{range}</span>
                        {isOldestLoadedBoundary && (
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            Older months have not loaded; this may continue further back.
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        {run.rows.length} {run.rows.length === 1 ? "month" : "months"}
                      </span>
                      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </h3>
                  {isOpen && (
                    <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} className="space-y-3 px-3 pb-3 sm:px-4">
                      <p className="px-1 text-xs text-muted-foreground">
                        {run.rows.length > 1
                          ? "Select a coverage month to see its benefits and work-month evidence. The status is the same across this period; benefits may vary by month."
                          : "Monthly decision and recorded evidence."}
                      </p>
                      {run.rows.length > 1 && (
                        <div role="group" aria-label={`Coverage months for ${statusLabel(run.status)} ${range}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                          {run.rows.map((row) => (
                            <button
                              key={monthKey(row)}
                              type="button"
                              aria-pressed={monthKey(row) === monthKey(selectedRow)}
                              aria-controls={`${id}-selected-month`}
                              onClick={() => setSelectedMonths((current) => ({ ...current, [id]: monthKey(row) }))}
                              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                                monthKey(row) === monthKey(selectedRow)
                                  ? "border-current bg-background font-semibold"
                                  : "border-border bg-background/70 hover:border-current hover:bg-background"
                              }`}
                            >
                              <span className="block">{row.coverageMonth.label}</span>
                              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                                Work: {row.workMonth.label} · {formatHours(row.hours?.reported)}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div id={`${id}-selected-month`}>
                        <p className="mb-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                          Showing {selectedRow.coverageMonth.label} coverage, based on {selectedRow.workMonth.label} work.
                        </p>
                        <MonthEvidence row={selectedRow} showCharges={MONTHLY_COVERAGE_PAGE.showCharges} />
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
            {hasOlder && (
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