import { useEffect, useState } from "react";
import {
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
  type MonthlyCoveragePage,
  type MonthlyCoverageRow,
} from "./_data";
import "./_group.css";

export type { BenefitIcon, MonthlyCoveragePage, MonthlyCoverageRow } from "./_data";
export { MONTHLY_COVERAGE_ROWS } from "./_data";

const localIcons: Record<string, LucideIcon> = {
  Eye,
  HeartPulse,
  Pill,
  Smile,
  Wallet,
};

function renderIcon(iconName: string | null | undefined, className: string) {
  const Icon = iconName ? localIcons[iconName] : undefined;
  return Icon ? <Icon className={className} /> : null;
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

export function Current() {
  const [visibleCount, setVisibleCount] = useState(12);
  useEffect(() => {
    if (window.location.hash !== "#monthly-coverage-history") return;
    const target = document.getElementById("monthly-coverage-history");
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }, []);

  const rows = MONTHLY_COVERAGE_ROWS.slice(0, visibleCount);
  const first = MONTHLY_COVERAGE_PAGE;
  const hasNextPage = rows.length < first.total;
  const loadOlderMonths = () => setVisibleCount(MONTHLY_COVERAGE_ROWS.length);

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
            {first.partial && <p role="status" className="rounded-lg border p-3 text-sm">Some coverage details are unavailable. Months without a confirmed decision are shown as unknown.</p>}
            {first.total === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No monthly coverage, hours, scan, or charge history has been recorded for this worker.</p>}
            {rows.map((row) => (
              <article
                key={`${row.coverageMonth.year}-${row.coverageMonth.month}`}
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
                    {row.status === "active" ? "Active" : row.status === "inactive" ? "Inactive" : "Not confirmed"}
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
                                      className="inline-flex h-8 w-8 cursor-help items-center justify-center rounded-full bg-muted/20 text-muted-foreground"
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
                {first.showCharges && (
                  <p className="mt-3 border-t pt-3">
                    Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong>
                  </p>
                )}
              </article>
            ))}
            {hasNextPage && (
              <Button variant="outline" onClick={loadOlderMonths}>
                Load older months
              </Button>
            )}
            {rows.length > 0 && <p className="text-xs text-muted-foreground" aria-live="polite">Showing {rows.length} of {first.total} months.</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}