import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface Month {
  year: number;
  month: number;
  label: string;
}

export interface MonthlyCoverageRow {
  coverageMonth: Month;
  workMonth: Month;
  hours: { reported: number; required: number } | null;
  status: "active" | "inactive" | "unknown";
  reasons: string[];
  medical: string[];
  dental: string[];
  other: string[];
  charge: string | null;
}

export interface MonthlyCoveragePage {
  months: MonthlyCoverageRow[];
  total: number;
  showCharges: boolean;
  partial: boolean;
}

const PAGE_SIZE = 12;

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
  const rows = query.data?.pages.flatMap((page) => page.months) ?? [];
  const first = query.data?.pages[0];

  return (
    <section aria-label="Monthly coverage history" className="mt-6" data-testid="worker-monthly-coverage-history">
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
            <article key={`${row.coverageMonth.year}-${row.coverageMonth.month}`} className="rounded-lg border p-4 text-sm" aria-label={`Coverage for ${row.coverageMonth.label}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Coverage month</p>
                  <h3 className="text-base font-semibold">{row.coverageMonth.label}</h3>
                  <p className="mt-1 text-muted-foreground">Source work month: {row.workMonth.label}</p>
                </div>
                <span className="rounded-full border px-3 py-1 font-medium" role="status">
                  {row.status === "active" ? "Active" : row.status === "inactive" ? "Inactive" : "Not confirmed"}
                </span>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <p>Reported hours: <strong className="tabular-nums">{row.hours ? `${row.hours.reported} of ${row.hours.required} required` : "Unavailable"}</strong></p>
                {first?.showCharges && <p>Posted EE-fund benefit charge: <strong className="tabular-nums">{row.charge === null ? "Unavailable" : `$${row.charge}`}</strong></p>}
                <p>Medical: {row.medical.length ? row.medical.join(", ") : "No recorded medical benefit"}</p>
                <p>Dental: {row.dental.length ? row.dental.join(", ") : "No recorded dental benefit"}</p>
                {row.other.length > 0 && <p>Other recorded benefits: {row.other.join(", ")}</p>}
              </div>
              {row.status === "inactive" && (
                <p className="mt-3 text-muted-foreground">{row.reasons.length ? row.reasons.join(" · ") : "No specific reason confirmed by the scan."}</p>
              )}
              {row.status === "unknown" && <p className="mt-3 text-muted-foreground">A reliable coverage decision is not available for this month.</p>}
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