import { Check, Clock3, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BaoCoverageSummary } from "./_data";
import { baoCoverageSummary } from "./_data";
import "./_group.css";
import "./_CurrentCard.css";

function exactHours(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${String(value)} hrs`;
}

const currentStatus = {
  covered: { label: "Coverage confirmed", Icon: Check, tone: "border-accent/50 bg-accent/10 text-foreground", iconTone: "text-accent" },
  "not-covered": { label: "Not covered", Icon: X, tone: "border-destructive/40 bg-destructive/10 text-destructive", iconTone: "text-destructive" },
  stale: { label: "Coverage needs updating", Icon: Clock3, tone: "border-border bg-muted text-foreground", iconTone: "text-muted-foreground" },
  unavailable: { label: "Coverage unavailable", Icon: Clock3, tone: "border-border bg-muted text-foreground", iconTone: "text-muted-foreground" },
} as const;

const futureStatus = {
  met: { label: "Hours threshold met", Icon: Check, tone: "text-foreground", iconTone: "text-accent" },
  below: { label: "Hours threshold not met", Icon: X, tone: "text-destructive", iconTone: "text-destructive" },
  pending: { label: "Hours threshold pending", Icon: Clock3, tone: "text-muted-foreground", iconTone: "text-muted-foreground" },
} as const;

function useDashboardContent() {
  return { data: baoCoverageSummary, isLoading: false, isError: false };
}

function CoverageShell({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Card className="bao-worker-coverage-card w-full min-w-0 rounded-lg shadow-sm" aria-label={label} data-testid="card-dashboard-bao-worker-coverage">
      {children}
    </Card>
  );
}

function CoverageHeading() {
  return (
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Coverage</CardTitle>
      <CardDescription>Current coverage and upcoming work-month hours</CardDescription>
    </CardHeader>
  );
}

export function Current() {
  const { data, isLoading, isError } = useDashboardContent();

  if (isLoading) {
    return (
      <CoverageShell label="Coverage loading">
        <CoverageHeading />
        <CardContent className="space-y-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </CoverageShell>
    );
  }

  let message: { title: string; detail: string } | null = null;
  if (isError) message = { title: "Coverage information is temporarily unavailable.", detail: "Please try again later." };
  else if (!data || data.state === "unlinked") message = { title: "Coverage information is not available.", detail: "Your worker account is not linked to benefits coverage yet." };
  else if (data.state === "unavailable") message = { title: "Coverage information is unavailable.", detail: "Please try again later." };

  if (message) {
    return (
      <CoverageShell>
        <CoverageHeading />
        <CardContent role={isError ? "alert" : undefined} className="space-y-1 text-sm">
          <p className="font-medium">{message.title}</p>
          <p className="text-muted-foreground">{message.detail}</p>
        </CardContent>
      </CoverageShell>
    );
  }

  return <BaoWorkerCoverageView data={data!} />;
}

/** Shared presentation for the member dashboard and admin worker record. */
function BaoWorkerCoverageView({ data }: { data: BaoCoverageSummary }) {
  if (data.state !== "available") return null;
  const monthlyHoursHref = `/workers/${encodeURIComponent(data.workerId)}/employment/monthly`;
  const currentNotCovered = data.current.coverage === "not-covered";
  const hoursHighlight = currentNotCovered && data.current.causes.hours === true;
  const balanceHighlight = currentNotCovered && data.current.causes.balance === true;
  const balanceText = data.balance.available && data.balance.totals.length
    ? data.balance.totals.map((entry) =>
        entry.currency === "USD" ? entry.formatted : `${entry.currency} ${entry.formatted}`
      ).join(", ")
    : "—";
  const status = currentStatus[data.current.coverage];

  return (
    <CoverageShell>
      <CoverageHeading />
      <CardContent className="space-y-6 text-sm">
        <section aria-label="Current coverage" className="rounded-lg border p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-muted-foreground">Current coverage</h3>
              <p className="mt-1 text-base font-semibold">{data.current.coverageMonth.label}</p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${status.tone}`} role="status" aria-label={status.label}>
              <status.Icon className={`h-4 w-4 shrink-0 ${status.iconTone}`} aria-hidden="true" />
              {status.label}
            </span>
          </div>
          <div className="bao-coverage-metrics mt-5 grid gap-3">
            <div className="min-w-0 rounded-md bg-muted/50 p-3">
              <span className="block text-xs text-muted-foreground">Work month</span>
              <strong className="mt-1 block font-medium">{data.current.workMonth.label}</strong>
            </div>
            <div className={`min-w-0 rounded-md p-3 ${hoursHighlight ? "border border-destructive/40 bg-destructive/10" : "bg-muted/50"}`} data-blocking={hoursHighlight ? "hours" : undefined} aria-label={hoursHighlight ? "Hours are blocking current coverage" : undefined}>
              <span className="block text-xs text-muted-foreground">Work hours</span>
              <div className="mt-1 tabular-nums"><span className="text-muted-foreground">Reported:</span> <strong className="font-medium">{exactHours(data.current.hours?.reported)}</strong></div>
              <div className="tabular-nums"><span className="text-muted-foreground">Required:</span> <strong className="font-medium">{exactHours(data.current.hours?.required)}</strong></div>
              {hoursHighlight && <span className="mt-1 block text-xs font-medium text-destructive">Blocking coverage</span>}
            </div>
            <div className={`min-w-0 rounded-md p-3 ${balanceHighlight ? "border border-destructive/40 bg-destructive/10" : "bg-muted/50"}`} data-blocking={balanceHighlight ? "balance" : undefined} aria-label={balanceHighlight ? "Balance is blocking current coverage" : undefined}>
              <span className="block text-xs text-muted-foreground">Balance</span>
              <strong className="mt-1 block break-words font-medium">{balanceText}</strong>
              {balanceHighlight && <span className="mt-1 block text-xs font-medium text-destructive">Blocking coverage</span>}
            </div>
          </div>
        </section>

        <section aria-label="Future coverage">
          <div className="mb-3">
            <h3 className="font-semibold">Upcoming work months</h3>
            <p className="text-sm text-muted-foreground">Hours thresholds for future coverage months, not a current coverage decision.</p>
          </div>
          {data.future.length === 0 ? (
            <p className="rounded-md border p-4 text-muted-foreground">No future coverage periods to show.</p>
          ) : (
            <div className="bao-coverage-periods grid gap-3">
              {data.future.map((period) => {
                const threshold = futureStatus[period.status];
                return (
                  <article className="min-w-0 rounded-md border p-4" key={`${period.workMonth.year}-${period.workMonth.month}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <span className="block text-xs text-muted-foreground">Work month</span>
                        <strong className="font-medium">{period.workMonth.label}</strong>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${threshold.tone}`} aria-label={threshold.label}>
                        <threshold.Icon className={`h-4 w-4 shrink-0 ${threshold.iconTone}`} aria-hidden="true" />
                        {threshold.label}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3">
                      <div className="min-w-0">
                        <span className="block text-xs text-muted-foreground">Reported / required</span>
                        <span className="tabular-nums">{exactHours(period.hours.reported)} / {exactHours(period.hours.required)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="block text-xs text-muted-foreground">Coverage month</span>
                        <span>{period.coverageMonth.label}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-2 border-t pt-4 text-sm">
          <a href="#" onClick={(event) => event.preventDefault()} data-href={monthlyHoursHref} className="font-medium text-primary underline underline-offset-4 hover:no-underline" data-testid="link-bao-worker-coverage-monthly-hours">View your full monthly hours breakdown</a>
          <span className="text-muted-foreground">Contact the fund with any questions or concerns.</span>
        </div>
      </CardContent>
    </CoverageShell>
  );
}