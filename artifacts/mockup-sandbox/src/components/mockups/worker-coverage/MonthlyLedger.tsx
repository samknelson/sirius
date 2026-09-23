import { Check, Clock3, ExternalLink, Info, X } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { BaoCoverageSummary } from "./_data";
import { baoCoverageSummary } from "./_data";
import "./_group.css";

function exactHours(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${String(value)} hrs`;
}

function displayDeadline(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

const currentStatus = {
  covered: { label: "Coverage confirmed", Icon: Check, tone: "border-emerald-200 bg-emerald-50 text-emerald-900", iconTone: "text-emerald-700" },
  "not-covered": { label: "Not covered", Icon: X, tone: "border-rose-200 bg-rose-50 text-rose-900", iconTone: "text-rose-700" },
  stale: { label: "Coverage needs updating", Icon: Clock3, tone: "border-amber-200 bg-amber-50 text-amber-950", iconTone: "text-amber-700" },
  unavailable: { label: "Coverage unavailable", Icon: Clock3, tone: "border-slate-200 bg-slate-50 text-slate-700", iconTone: "text-slate-600" },
} as const;

const futureStatus = {
  met: { label: "Threshold met", Icon: Check, tone: "text-emerald-800", iconTone: "text-emerald-700" },
  below: { label: "Below threshold", Icon: X, tone: "text-rose-800", iconTone: "text-rose-700" },
  pending: { label: "Pending", Icon: Clock3, tone: "text-slate-700", iconTone: "text-slate-500" },
} as const;

function useDashboardContent() {
  return { data: baoCoverageSummary, isLoading: false, isError: false };
}

function CoverageShell({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <Card className="bao-worker-coverage-card w-full min-w-0 overflow-hidden rounded-lg border-slate-200 bg-[#fbfcfb] shadow-sm" aria-label={label} data-testid="card-dashboard-bao-worker-coverage">
      {children}
    </Card>
  );
}

function CoverageHeading() {
  return (
    <CardHeader className="border-b border-slate-200 bg-[#f4f7f5] px-5 py-4 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle className="text-[17px] font-semibold tracking-[-0.01em] text-slate-950">Coverage ledger</CardTitle>
          <CardDescription className="mt-1 text-[13px] leading-5 text-slate-600">A month-by-month view of coverage and reported work hours</CardDescription>
        </div>
        <span className="hidden rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-slate-600 sm:inline-flex">BAO health coverage</span>
      </div>
    </CardHeader>
  );
}

function LedgerKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3 text-[11px] text-slate-600" aria-label="Ledger key">
      <span className="font-semibold uppercase tracking-[0.08em] text-slate-500">How to read this</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-700" aria-hidden="true" />Confirmed decision</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />Future signal</span>
    </div>
  );
}

export function MonthlyLedger() {
  const { data, isLoading, isError } = useDashboardContent();

  if (isLoading) {
    return (
      <CoverageShell label="Coverage loading">
        <CoverageHeading />
        <CardContent className="space-y-3 p-5 sm:p-6" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
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
        <CardContent role={isError ? "alert" : undefined} className="space-y-1 p-5 text-sm sm:p-6">
          <p className="font-medium text-slate-900">{message.title}</p>
          <p className="text-slate-600">{message.detail}</p>
        </CardContent>
      </CoverageShell>
    );
  }
  return <BaoWorkerCoverageView data={data!} />;
}

function BaoWorkerCoverageView({ data }: { data: BaoCoverageSummary }) {
  if (data.state !== "available") return null;
  const monthlyHoursHref = `/workers/${encodeURIComponent(data.workerId)}/employment/monthly`;
  const status = currentStatus[data.current.coverage];
  const currentNotCovered = data.current.coverage === "not-covered";
  const decisionPanel = data.current.coverage === "covered"
    ? "border-emerald-200 bg-[#f0f7f3]"
    : data.current.coverage === "not-covered"
      ? "border-rose-200 bg-rose-50"
      : "border-slate-200 bg-slate-50";
  const decisionBar = data.current.coverage === "covered"
    ? "bg-emerald-700"
    : data.current.coverage === "not-covered"
      ? "bg-rose-700"
      : "bg-slate-500";
  const balanceText = data.balance.available && data.balance.totals.length
    ? data.balance.totals.map((entry) => entry.currency === "USD" ? entry.formatted : `${entry.currency} ${entry.formatted}`).join(", ")
    : "Not available";

  return (
    <CoverageShell>
      <CoverageHeading />
      <CardContent className="space-y-5 p-5 text-sm sm:p-6">
        <LedgerKey />

        <section aria-labelledby="ledger-current-heading" className={`relative rounded-md border p-4 sm:p-5 ${decisionPanel}`}>
          <div className={`absolute bottom-0 left-0 top-0 w-1 rounded-l-md ${decisionBar}`} aria-hidden="true" />
          <div className="flex flex-col gap-3 pl-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-700">Current decision</p>
              <h3 id="ledger-current-heading" className="mt-1 text-lg font-semibold tracking-[-0.015em] text-slate-950">{data.current.coverageMonth.label}</h3>
              <p className="mt-1 text-xs text-slate-600">Based on work completed in {data.current.workMonth.label}</p>
            </div>
            <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${status.tone}`} role="status" aria-label={status.label}>
              <status.Icon className={`h-4 w-4 shrink-0 ${status.iconTone}`} aria-hidden="true" />
              {status.label}
            </span>
          </div>

          <dl className="mt-5 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_1.15fr_1fr]">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Work month</dt>
              <dd className="mt-1 font-medium text-slate-900">{data.current.workMonth.label}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Hours reported / required</dt>
              <dd className="mt-1 tabular-nums font-medium text-slate-900">{exactHours(data.current.hours?.reported)} <span className="text-slate-400">/</span> {exactHours(data.current.hours?.required)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Reported balance</dt>
              <dd className="mt-1 break-words font-medium text-slate-900">{balanceText}</dd>
            </div>
          </dl>
          <p className="mt-4 flex items-start gap-1.5 text-xs leading-5 text-slate-600"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />Hours and balance are supporting details; neither alone guarantees coverage.</p>
          {currentNotCovered && (data.current.causes.hours === true || data.current.causes.balance === true) && (
            <p className="mt-2 text-xs font-medium text-rose-800">One or more eligibility requirements may be affecting this decision.</p>
          )}
        </section>

        <section aria-labelledby="ledger-future-heading">
          <div className="mb-3">
            <h3 id="ledger-future-heading" className="text-sm font-semibold text-slate-950">Next coverage months</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">These rows show work-hour thresholds only. They are not coverage decisions.</p>
          </div>
          {data.future.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">No future coverage periods to show.</p>
          ) : (
            <div className="relative ml-2 border-l border-slate-300">
              {data.future.map((period, index) => {
                const threshold = futureStatus[period.status];
                return (
                  <article className="relative pb-4 pl-6 last:pb-0" key={`${period.workMonth.year}-${period.workMonth.month}`}>
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-slate-400 ring-4 ring-[#fbfcfb]" aria-hidden="true" />
                    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <strong className="text-sm font-semibold text-slate-900">{period.coverageMonth.label}</strong>
                          <span className="text-xs text-slate-500">from {period.workMonth.label}</span>
                        </div>
                         <p className="mt-1 text-xs text-slate-600">Hours: <span className="tabular-nums font-medium text-slate-800">{exactHours(period.hours.reported)} / {exactHours(period.hours.required)}</span><span className="mx-1.5 text-slate-300">·</span>Deadline {displayDeadline(period.deadline)}</p>
                      </div>
                      <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 text-xs font-semibold ${threshold.tone}`} aria-label={`${threshold.label} for ${period.coverageMonth.label}`}>
                        <threshold.Icon className={`h-3.5 w-3.5 ${threshold.iconTone}`} aria-hidden="true" />
                        {threshold.label}{period.status === "pending" ? " — not a denial" : ""}
                      </span>
                    </div>
                    {index < data.future.length - 1 && <span className="sr-only">Then</span>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-2 border-t border-slate-200 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
          <a href="#" onClick={(event) => event.preventDefault()} data-href={monthlyHoursHref} className="inline-flex w-fit items-center gap-1 font-semibold text-slate-800 underline decoration-slate-400 underline-offset-4 transition-colors hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2" data-testid="link-bao-worker-coverage-monthly-hours">
            View full monthly hours breakdown <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <span className="text-slate-500">Questions? Contact the fund.</span>
        </div>
      </CardContent>
    </CoverageShell>
  );
}