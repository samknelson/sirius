import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renderIcon } from "@/components/ui/icon-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "@/plugins/dashboard/bao-worker-coverage/bao-worker-coverage.css";
import { coverageRunLabel, groupCoverageRuns, type CoverageRunStatus } from "./monthly-coverage-runs";

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

const unenrolledBadgeStyle: CSSProperties = {
  borderColor: "hsl(37 35% 68%)",
  backgroundColor: "hsl(39 42% 93%)",
  color: "hsl(32 38% 33%)",
};
const unenrolledRunStyle: CSSProperties = {
  borderColor: "hsl(37 35% 78%)",
  borderLeftColor: "hsl(32 38% 43%)",
  backgroundColor: "hsl(39 42% 96%)",
};
const monthKey = (row: MonthlyCoverageRow) => `${row.coverageMonth.year}-${row.coverageMonth.month}`;
const runClass = (status: CoverageRunStatus) =>
  `coverage-first-decision${status === "inactive" ? " coverage-first-decision--not-covered" : status === "unknown" || status === "unenrolled" ? " coverage-first-decision--quiet" : ""}`;
const badgeClass = (status: CoverageRunStatus) =>
  `coverage-first-status ${status === "active" ? "coverage-first-status--covered" : status === "inactive" ? "coverage-first-status--not-covered" : "coverage-first-status--quiet"}`;

export function WorkerMonthlyCoverageHistory({ workerId }: { workerId: string }) {
  const [openRuns, setOpenRuns] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<Record<string, string>>({});
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

  const pages = query.data?.pages;
  const rows = useMemo(() => pages?.flatMap((page) => page.months) ?? [], [pages]);
  const runs = useMemo(() => groupCoverageRuns(rows), [rows]);
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
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-[hsl(170_40%_38%)]" /> Active
            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[hsl(8_58%_43%)]" /> Inactive · scan decision
            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[hsl(32_38%_43%)]" /> Unenrolled · no election recorded
            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[hsl(39_22%_55%)]" /> Not confirmed
          </div>
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
          {runs.map((run, index) => {
            const latest = run.rows[0].coverageMonth;
            const id = `coverage-run-${latest.year}-${latest.month}`;
            const isOpen = openRuns.includes(id);
            const newest = latest.label;
            const oldest = run.rows[run.rows.length - 1].coverageMonth.label;
            const range = run.rows.length === 1 ? newest : `${oldest} – ${newest}`;
            const row = run.rows.find((item) => monthKey(item) === selectedMonths[id]) ?? run.rows[0];
            const reasons = [...new Set(run.rows.flatMap((item) => item.reasons))].filter(Boolean).join(" · ");
            return (
              <section
                key={id}
                className={`${runClass(run.status)} p-0`}
                style={run.status === "unenrolled" ? unenrolledRunStyle : undefined}
                aria-label={`${coverageRunLabel(run.status)} coverage ${range}`}
              >
                <h3>
                  <button
                    type="button"
                    id={`${id}-button`}
                    aria-expanded={isOpen}
                    aria-controls={`${id}-panel`}
                    onClick={() => setOpenRuns((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
                    className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className={badgeClass(run.status)} style={run.status === "unenrolled" ? unenrolledBadgeStyle : undefined}>
                      {coverageRunLabel(run.status)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{range}</span>
                      {run.status === "inactive" && (
                        <span className="mt-1 block text-xs font-normal text-muted-foreground">
                          Reason: {reasons || "No scan reason recorded."}
                        </span>
                      )}
                      {index === runs.length - 1 && query.hasNextPage && (
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
                      <div role="group" aria-label={`Coverage months for ${coverageRunLabel(run.status)} ${range}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {run.rows.map((monthRow) => (
                          <button
                            key={monthKey(monthRow)}
                            type="button"
                            aria-pressed={monthKey(monthRow) === monthKey(row)}
                            aria-controls={`${id}-selected-month`}
                            onClick={() => setSelectedMonths((current) => ({ ...current, [id]: monthKey(monthRow) }))}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                              monthKey(monthRow) === monthKey(row) ? "border-current bg-background font-semibold" : "border-border bg-background/70 hover:border-current hover:bg-background"
                            }`}
                          >
                            <span className="block">{monthRow.coverageMonth.label}</span>
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              Work: {monthRow.workMonth.label} · {formatHours(monthRow.hours?.reported)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div id={`${id}-selected-month`}>
                      <p className="mb-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                        Showing {row.coverageMonth.label} coverage, based on {row.workMonth.label} work.
                      </p>
            <article
              className={`${runClass(run.status)} text-sm`}
              style={run.status === "unenrolled" ? unenrolledRunStyle : undefined}
              aria-label={`Coverage for ${row.coverageMonth.label}`}
              data-testid="monthly-coverage-card"
            >
              <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-testid="monthly-coverage-card-header">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
                  <h4 className="text-base font-semibold">{row.coverageMonth.label}</h4>
                </div>
                <span className={`${badgeClass(run.status)} order-3 col-span-2 justify-self-center text-center sm:order-2 sm:col-span-1`} style={run.status === "unenrolled" ? unenrolledBadgeStyle : undefined} role="status">
                  {coverageRunLabel(run.status)}
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
                  {run.status === "inactive" && (
                    <p className="mt-3 border-t pt-3 text-muted-foreground">
                      <span className="font-medium text-foreground">Scan reason: </span>
                      {row.reasons.length ? row.reasons.join(" · ") : "No specific reason confirmed by the scan."}
                    </p>
                  )}
                  {run.status === "unenrolled" && (
                    <p className="mt-3 border-t pt-3 text-muted-foreground">
                      <span className="font-medium text-foreground">Election record: </span>No Election
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
              {first?.showCharges && (
                <p className="mt-3 border-t pt-3">
                  Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong>
                </p>
              )}
            </article>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
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