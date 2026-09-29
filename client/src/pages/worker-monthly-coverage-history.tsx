import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renderIcon } from "@/components/ui/icon-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Month {
  year: number;
  month: number;
  label: string;
}

interface BenefitIcon {
  name: string;
  icon: string | null;
  color: string | null;
}

export interface MonthlyCoverageRow {
  coverageMonth: Month;
  workMonth: Month;
  employerHours?: Array<{ employerId: string | null; employerName: string; reported: number | null }> | null;
  hours: { reported: number | null; required: number | null } | null;
  status: "active" | "inactive" | "unknown";
  reasons: string[];
  medical: string[];
  dental: string[];
  other: string[];
  medicalBenefitIcons?: BenefitIcon[];
  dentalBenefitIcons?: BenefitIcon[];
  otherBenefitIcons?: BenefitIcon[];
  charge: string | null;
}

export interface MonthlyCoveragePage {
  months: MonthlyCoverageRow[];
  total: number;
  showCharges: boolean;
  partial: boolean;
}

const PAGE_SIZE = 12;

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

export function WorkerMonthlyCoverageHistory({ workerId }: { workerId: string }) {
  const query = useInfiniteQuery<MonthlyCoveragePage>({
    queryKey: ["/api/workers", workerId, "benefits", "monthly-history"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/workers/${encodeURIComponent(workerId)}/benefits/monthly-history?offset=${pageParam}&limit=${PAGE_SIZE}`,
      );
      if (!response.ok) throw new Error("Monthly coverage history could not be loaded");
      return response.json();
    },
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((count, page) => count + page.months.length, 0);
      return loaded < lastPage.total && lastPage.months.length > 0 ? loaded : undefined;
    },
  });
  useEffect(() => {
    if (window.location.hash !== "#monthly-coverage-history") return;
    const target = document.getElementById("monthly-coverage-history");
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }, []);

  const rows = query.data?.pages.flatMap((page) => page.months) ?? [];
  const first = query.data?.pages[0];

  return (
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
          {query.isPending && <div aria-busy="true" className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /><span className="sr-only">Loading monthly coverage history</span></div>}
          {query.isError && !rows.length && (
            <div role="alert" className="rounded-lg border p-4">
              Monthly coverage history is unavailable. Please try again.
              <Button variant="outline" size="sm" className="ml-3" onClick={() => query.refetch()}>Retry</Button>
            </div>
          )}
          {first?.partial && <p role="status" className="rounded-lg border p-3 text-sm">Some coverage details are unavailable. Months without a confirmed decision are shown as unknown.</p>}
          {first && first.total === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No monthly coverage, hours, scan, or charge history has been recorded for this worker.</p>}
          {rows.map((row) => (
            <article
              key={`${row.coverageMonth.year}-${row.coverageMonth.month}`}
              className={`rounded-lg border p-4 text-sm ${row.status === "active" ? "bg-green-50" : row.status === "inactive" ? "bg-red-50" : "bg-background"}`}
              aria-label={`Coverage for ${row.coverageMonth.label}`}
              data-testid="monthly-coverage-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
                  <h3 className="text-base font-semibold">{row.coverageMonth.label}</h3>
                </div>
                <span className="rounded-full border px-3 py-1 font-medium" role="status">
                  {row.status === "active" ? "Active" : row.status === "inactive" ? "Inactive" : "Not confirmed"}
                </span>
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
                  <h4 className="font-semibold">Work month — {row.workMonth.label}</h4>
                  <p className="mt-3 font-medium">Hours by employer</p>
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
                    {row.hours?.reported !== null && row.hours?.reported !== undefined &&
                      row.hours.required !== null && row.hours.required !== undefined && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          The total {row.hours.reported >= row.hours.required ? "meets or exceeds" : "is below"} the hours threshold; this is evidence for the review, not the coverage decision.
                        </p>
                      )}
                    {(row.hours?.reported === null || row.hours?.reported === undefined ||
                      row.hours.required === null || row.hours.required === undefined) && (
                        <p className="mt-2 text-xs text-muted-foreground">Hours are evidence for the review; they do not by themselves determine coverage.</p>
                      )}
                  </div>
                </section>
              </div>
              {row.status === "unknown" && <p className="mt-3 rounded-md bg-muted/40 p-3 text-muted-foreground">A reliable coverage decision is not available for this month.</p>}
              {first?.showCharges && (
                <p className="mt-3 border-t pt-3">
                  Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong>
                </p>
              )}
            </article>
          ))}
          {query.isError && rows.length > 0 && <p role="alert">Older months could not be loaded. <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()}>Retry</Button></p>}
          {query.hasNextPage && !query.isError && (
            <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? "Loading older months…" : "Load older months"}
            </Button>
          )}
          {rows.length > 0 && <p className="text-xs text-muted-foreground" aria-live="polite">Showing {rows.length} of {first?.total ?? rows.length} months.</p>}
        </CardContent>
      </Card>
    </section>
  );
}