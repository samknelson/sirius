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

const iconMap: Record<string, LucideIcon> = { Eye, HeartPulse, Pill, Smile, Wallet };
const INITIAL_VISIBLE = 21;

function renderIcon(iconName: string | null | undefined, className: string) {
  const Icon = iconName ? iconMap[iconName] : undefined;
  return Icon ? <Icon className={className} aria-hidden="true" /> : null;
}

function formatHours(value: number | null | undefined) {
  return value === null || value === undefined
    ? "Unavailable"
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} hours`;
}

function monthKey(row: MonthlyCoverageRow) {
  return `${row.coverageMonth.year}-${String(row.coverageMonth.month).padStart(2, "0")}`;
}

function ordinalMonthDistance(a: MonthlyCoverageRow, b: MonthlyCoverageRow) {
  return a.coverageMonth.year * 12 + a.coverageMonth.month -
    (b.coverageMonth.year * 12 + b.coverageMonth.month);
}

function statusName(status: MonthlyCoverageRow["status"]) {
  return status === "active" ? "Active" : status === "inactive" ? "Inactive" : "Not confirmed";
}

function benefitList(benefits: BenefitIcon[], fallback: string[]) {
  return benefits.length ? benefits : fallback.map((name) => ({ name, icon: null, color: null }));
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
  const medical = benefitList(row.medicalBenefitIcons ?? [], row.medical);
  const dental = benefitList(row.dentalBenefitIcons ?? [], row.dental);
  const other = benefitList(row.otherBenefitIcons ?? [], row.other);

  return (
    <div className="timeline-month-evidence">
      <div className="timeline-month-heading">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
          <h4 className="text-lg font-semibold">{row.coverageMonth.label}</h4>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-muted-foreground">Work month</p>
          <p className="font-semibold">{row.workMonth.label}</p>
        </div>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <section aria-label={`Benefits for ${row.coverageMonth.label}`} className="min-w-0 rounded-md border bg-background p-3">
          <h5 className="font-semibold">Benefits recorded for this month</h5>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            {row.medical.length
              ? medical.map((benefit) => <NamedBenefit key={`medical-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded medical benefit</span>}
            {row.dental.length
              ? dental.map((benefit) => <NamedBenefit key={`dental-${benefit.name}`} benefit={benefit} />)
              : <span className="text-muted-foreground">No recorded dental benefit</span>}
          </div>
          {row.other.length > 0 && (
            <div className="mt-3">
              <p className="font-medium">Other recorded benefits</p>
              <TooltipProvider>
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Other recorded benefits">
                  {other.map((benefit, index) => (
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
          {row.status === "unknown" && (
            <p className="mt-3 rounded-md bg-muted/40 p-3 text-muted-foreground">
              A reliable coverage decision is not available for this month. This is not a confirmed inactive decision.
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
                <p className="mt-2 text-xs text-muted-foreground">Hours are evidence for review; they do not by themselves determine coverage.</p>
              )}
          </div>
        </section>
      </div>
      {showCharges && (
        <p className="mt-3 border-t pt-3">
          Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong>
        </p>
      )}
    </div>
  );
}

export function TimelineAccordion() {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const visibleRows = MONTHLY_COVERAGE_ROWS.slice(0, visibleCount);
  const groups = useMemo(() => {
    const result: Array<{ status: MonthlyCoverageRow["status"]; rows: MonthlyCoverageRow[] }> = [];
    visibleRows.forEach((row) => {
      const current = result[result.length - 1];
      const previous = current?.rows[current.rows.length - 1];
      if (current && current.status === row.status && previous && ordinalMonthDistance(previous, row) === 1) {
        current.rows.push(row);
      } else {
        result.push({ status: row.status, rows: [row] });
      }
    });
    return result;
  }, [visibleCount]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [selectedMonths, setSelectedMonths] = useState<Record<string, string>>({});
  const groupKey = (rows: MonthlyCoverageRow[]) => monthKey(rows[0]);
  const showCharges = MONTHLY_COVERAGE_PAGE.showCharges;
  const hasOlder = visibleRows.length < MONTHLY_COVERAGE_PAGE.total;

  const toggleGroup = (key: string) => setOpenGroups((state) => ({ ...state, [key]: !state[key] }));
  const selectMonth = (key: string, month: string) => setSelectedMonths((state) => ({ ...state, [key]: month }));

  return (
    <div className="monthly-history-preview min-h-screen bg-background text-foreground">
      <style>{`
        .monthly-history-preview .timeline-rail {
          --rail-x: 1.15rem;
          position: relative;
          display: grid;
          gap: 1rem;
          padding-left: 2.75rem;
        }
        .monthly-history-preview .timeline-rail::before {
          content: "";
          position: absolute;
          top: 1.2rem;
          bottom: 1.2rem;
          left: var(--rail-x);
          width: 2px;
          background: linear-gradient(to bottom, hsl(170 34% 55%), hsl(8 45% 73%) 52%, hsl(39 22% 76%));
        }
        .monthly-history-preview .timeline-run {
          position: relative;
          min-width: 0;
          padding: 0;
          overflow: visible;
        }
        .monthly-history-preview .timeline-node {
          position: absolute;
          z-index: 1;
          top: 1.25rem;
          left: calc(-1.6rem - 7px);
          width: 15px;
          height: 15px;
          border: 3px solid hsl(0 0% 100%);
          border-radius: 50%;
          box-shadow: 0 0 0 1px hsl(214 25% 80%);
        }
        .monthly-history-preview .timeline-node--active { background: hsl(170 38% 38%); }
        .monthly-history-preview .timeline-node--inactive { background: hsl(8 58% 43%); }
        .monthly-history-preview .timeline-node--unknown { background: hsl(39 22% 55%); }
        .monthly-history-preview .timeline-run-toggle {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem;
          border: 0;
          border-radius: inherit;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .monthly-history-preview .timeline-run-toggle:hover { background: hsl(0 0% 100% / .42); }
        .monthly-history-preview .timeline-run-toggle:focus-visible,
        .monthly-history-preview .timeline-month-button:focus-visible {
          outline: 3px solid hsl(221 70% 45%);
          outline-offset: 3px;
        }
        .monthly-history-preview .timeline-run-copy { display: grid; justify-items: start; gap: .55rem; min-width: 0; }
        .monthly-history-preview .timeline-run-range { font-size: 1.12rem; line-height: 1.35; }
        .monthly-history-preview .timeline-boundary-note { font-size: .78rem; font-weight: 500; color: hsl(215 16% 40%); }
        .monthly-history-preview .timeline-run-summary { font-size: .8rem; color: hsl(215 16% 42%); }
        .monthly-history-preview .timeline-summary-separator { padding: 0 .2rem; color: hsl(215 16% 63%); }
        .monthly-history-preview .timeline-chevron { flex: 0 0 auto; transition: transform 160ms ease; }
        .monthly-history-preview .timeline-chevron.is-open { transform: rotate(180deg); }
        .monthly-history-preview .timeline-run-content { padding: 0 1rem 1rem; }
        .monthly-history-preview .timeline-month-nav {
          display: flex;
          gap: .45rem;
          overflow-x: auto;
          padding: .15rem .1rem .8rem;
          scrollbar-width: thin;
        }
        .monthly-history-preview .timeline-month-button {
          flex: 0 0 auto;
          border: 1px solid hsl(214 26% 79%);
          border-radius: 999px;
          background: hsl(0 0% 100% / .66);
          padding: .42rem .7rem;
          color: hsl(215 20% 32%);
          font-size: .76rem;
          cursor: pointer;
        }
        .monthly-history-preview .timeline-month-button.is-selected {
          border-color: hsl(170 34% 50%);
          background: hsl(165 31% 88%);
          color: hsl(170 40% 25%);
          font-weight: 700;
        }
        .monthly-history-preview .timeline-month-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 1px solid hsl(214 25% 86%);
          padding: .1rem 0 .8rem;
        }
        .monthly-history-preview .timeline-month-evidence { padding-top: .3rem; }
        @media (max-width: 640px) {
          .monthly-history-preview .timeline-rail { --rail-x: .35rem; padding-left: 1.2rem; gap: .8rem; }
          .monthly-history-preview .timeline-node { left: calc(-.85rem - 7px); }
          .monthly-history-preview .timeline-run-toggle { padding: .85rem; gap: .5rem; }
          .monthly-history-preview .timeline-run-content { padding: 0 .75rem .75rem; }
          .monthly-history-preview .timeline-run-range { font-size: 1rem; }
          .monthly-history-preview .timeline-run-summary { line-height: 1.5; }
          .monthly-history-preview .timeline-month-heading { align-items: flex-start; }
        }
      `}</style>
      <section id="monthly-coverage-history" tabIndex={-1} aria-label="Monthly coverage history" className="mt-6 scroll-mt-4" data-testid="worker-monthly-coverage-history">
        <Card>
          <CardHeader>
            <CardTitle>Monthly coverage history</CardTitle>
            <p className="text-sm text-muted-foreground">
              Coverage months are based on work three months earlier. Only recorded benefits and confirmed scan decisions are shown as known.
            </p>
          </CardHeader>
          <CardContent>
            {MONTHLY_COVERAGE_PAGE.partial && (
              <p role="status" className="mb-5 rounded-lg border p-3 text-sm text-muted-foreground">
                Some coverage details are unavailable. Months without a confirmed decision are shown as not confirmed. The oldest visible month is a loaded boundary, not necessarily the actual start of coverage history.
              </p>
            )}
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No monthly coverage, hours, scan, or charge history has been recorded for this worker.</p>
            ) : (
              <div className="timeline-rail" aria-label="Coverage periods, newest first">
                {groups.map(({ status, rows }, index) => {
                  const key = groupKey(rows);
                  const expanded = openGroups[key] ?? (index < 3);
                  const selectedKey = selectedMonths[key] ?? monthKey(rows[0]);
                  const selected = rows.find((row) => monthKey(row) === selectedKey) ?? rows[0];
                  const oldestBoundary = index === groups.length - 1 && MONTHLY_COVERAGE_PAGE.partial && hasOlder;
                  const range = rows.length === 1
                    ? rows[0].coverageMonth.label
                    : `${rows[rows.length - 1].coverageMonth.label} – ${rows[0].coverageMonth.label}`;
                  const controlId = `timeline-details-${key}`;

                  return (
                    <article
                      key={key}
                      className={`timeline-run coverage-first-decision${status === "inactive" ? " coverage-first-decision--not-covered" : status === "unknown" ? " coverage-first-decision--quiet" : ""}`}
                      data-testid="monthly-coverage-run"
                    >
                      <span className={`timeline-node timeline-node--${status}`} aria-hidden="true" />
                      <button
                        type="button"
                        className="timeline-run-toggle"
                        aria-expanded={expanded}
                        aria-controls={controlId}
                        onClick={() => toggleGroup(key)}
                      >
                        <span className="timeline-run-copy">
                          <span className={`coverage-first-status coverage-first-status--${status === "active" ? "covered" : status === "inactive" ? "not-covered" : "quiet"}`} role="status">
                            {statusName(status)}
                          </span>
                          <span className="timeline-run-range">
                            <strong>{range}</strong>
                            {oldestBoundary && <span className="timeline-boundary-note"> · oldest loaded month</span>}
                          </span>
                          <span className="timeline-run-summary">
                            {rows.length} {rows.length === 1 ? "month" : "months"} in this status run
                            <span className="timeline-summary-separator"> / </span>
                            {status === "unknown" ? "Decision not confirmed" : status === "inactive" ? "Confirmed inactive period" : "Confirmed active period"}
                          </span>
                        </span>
                        <ChevronDown className={`timeline-chevron${expanded ? " is-open" : ""}`} size={19} aria-hidden="true" />
                      </button>
                      {expanded && (
                        <div className="timeline-run-content" id={controlId}>
                          {rows.length > 1 && (
                            <div className="timeline-month-nav" aria-label={`Choose a month in ${range}`}>
                              {rows.map((row) => {
                                const selectedMonth = monthKey(row) === monthKey(selected);
                                return (
                                  <button
                                    type="button"
                                    key={monthKey(row)}
                                    className={`timeline-month-button${selectedMonth ? " is-selected" : ""}`}
                                    aria-pressed={selectedMonth}
                                    onClick={() => selectMonth(key, monthKey(row))}
                                  >
                                    {row.coverageMonth.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <MonthEvidence row={selected} showCharges={showCharges} />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            {hasOlder && (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" onClick={() => setVisibleCount(MONTHLY_COVERAGE_ROWS.length)}>
                  Load older months
                </Button>
              </div>
            )}
            {visibleRows.length > 0 && (
              <p className="mt-4 text-center text-xs text-muted-foreground" aria-live="polite">
                Showing {visibleRows.length} of {MONTHLY_COVERAGE_PAGE.total} months.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}