import { ArrowRight, Check, Clock3, ShieldCheck, WalletCards, X } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import "./bao-worker-coverage.css";

export interface BaoCoverageSummary {
  workerId: string;
  state: "available" | "unlinked" | "unavailable";
  current: {
    coverageMonth: { year: number; month: number; label: string };
    workMonth: { year: number; month: number; label: string };
    hours: { reported: number; required: number; thresholdMet: boolean } | null;
    coverage: "covered" | "not-covered" | "stale" | "unavailable";
    causes: { hours: boolean | null; balance: boolean | null };
  };
  balance: {
    available: boolean;
    totals: Array<{ currency: string; amount: string; formatted: string }>;
  };
  future: Array<{
    workMonth: { year: number; month: number; label: string };
    coverageMonth: { year: number; month: number; label: string };
    hours: { reported: number; required: number; thresholdMet: boolean };
    status: "met" | "below" | "pending";
    deadline: string;
  }>;
}

function exactHours(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : `${String(value)} hrs`;
}

const currentStatus = {
  covered: { label: "Coverage confirmed", Icon: Check, tone: "coverage-first-status--covered" },
  "not-covered": { label: "Not covered", Icon: X, tone: "coverage-first-status--not-covered" },
  stale: { label: "Coverage needs updating", Icon: Clock3, tone: "coverage-first-status--quiet" },
  unavailable: { label: "Coverage unavailable", Icon: Clock3, tone: "coverage-first-status--quiet" },
} as const;

const futureStatus = {
  met: { label: "Threshold met", accessibleLabel: "Hours threshold met", Icon: Check, tone: "coverage-first-future--met" },
  below: { label: "Below threshold", accessibleLabel: "Hours threshold not met", Icon: X, tone: "coverage-first-future--below" },
  pending: { label: "Pending", accessibleLabel: "Hours threshold pending", Icon: Clock3, tone: "coverage-first-future--pending" },
} as const;

function CoverageShell({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Card className="bao-worker-coverage-card coverage-first-card w-full min-w-0 overflow-hidden rounded-xl shadow-sm" aria-label={label} data-testid="card-dashboard-bao-worker-coverage">
      {children}
    </Card>
  );
}

function CoverageHeading() {
  return (
    <CardHeader className="coverage-first-header">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[hsl(170_38%_38%)]" aria-hidden="true" />
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Coverage at a glance</CardTitle>
      </div>
    </CardHeader>
  );
}

export function BaoWorkerCoverage(_props: DashboardPluginProps) {
  const { data, isLoading, isError } =
    useDashboardContent<BaoCoverageSummary>("bao-worker-coverage");

  if (isLoading) {
    return (
      <CoverageShell label="Coverage loading">
        <CoverageHeading />
        <CardContent className="space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-full" />
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
export function BaoWorkerCoverageView({ data }: { data: BaoCoverageSummary }) {
  if (data.state !== "available") return null;
  const monthlyHoursHref = `/workers/${encodeURIComponent(data.workerId)}/employment/monthly`;
  const paymentHref = `/workers/${encodeURIComponent(data.workerId)}/ledger/pay`;
  const currentNotCovered = data.current.coverage === "not-covered";
  const hoursHighlight = currentNotCovered && data.current.causes.hours === true;
  const balanceHighlight = currentNotCovered && data.current.causes.balance === true;
  const balanceText = data.balance.available && data.balance.totals.length
    ? data.balance.totals.map((entry) =>
        entry.currency === "USD" ? entry.formatted : `${entry.currency} ${entry.formatted}`
      ).join(", ")
    : "Not available";
  const balanceNonZero = data.balance.available && data.balance.totals.some(
    (entry) => Number.isFinite(Number(entry.amount)) && Number(entry.amount) !== 0,
  );
  const status = currentStatus[data.current.coverage];
  const StatusIcon = status.Icon;
  const hoursMet = data.current.hours?.thresholdMet;

  return (
    <CoverageShell>
      <CoverageHeading />
      <CardContent className="space-y-5 text-sm">
        <section className="coverage-first-decision" aria-label="Current coverage">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">Current coverage</p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.025em]">{data.current.coverageMonth.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Based on work month: {data.current.workMonth.label}</p>
            </div>
            <div className={`coverage-first-status ${status.tone}`} role="status" aria-label={status.label}>
              <StatusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{status.label}</span>
            </div>
          </div>
          <p className="coverage-first-explanation mt-4">
            {data.current.coverage === "covered"
              ? "Your current coverage decision is confirmed."
              : currentNotCovered
                ? "The items below show what is affecting this coverage decision."
                : "The current coverage decision needs attention before it can be confirmed."}
          </p>
        </section>

        <section aria-label="Current coverage supporting details">
          <div className="coverage-first-details">
            <div className={`coverage-first-detail ${hoursHighlight ? "coverage-first-detail--attention" : ""}`} data-blocking={hoursHighlight ? "hours" : undefined} aria-label={hoursHighlight ? "Hours are blocking current coverage" : undefined}>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock3 className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs font-medium uppercase tracking-[0.08em]">Work hours</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5 tabular-nums">
                {hoursMet !== undefined && (hoursMet
                  ? <Check className="h-4 w-4 shrink-0 text-[hsl(145_52%_37%)]" aria-label="Hours met" />
                  : <X className="h-4 w-4 shrink-0 text-[hsl(0_62%_50%)]" aria-label="Hours not met" />)}
                <strong className="text-lg font-semibold">{exactHours(data.current.hours?.reported)}</strong>
                <span className="text-xs text-muted-foreground">of {exactHours(data.current.hours?.required)} required</span>
              </div>
              {hoursHighlight && <p className="mt-1 text-xs font-medium text-[hsl(8_58%_43%)]">Blocking coverage</p>}
            </div>
            <div
              className={`coverage-first-detail ${balanceHighlight || balanceNonZero ? "coverage-first-detail--attention" : ""}`}
              data-blocking={balanceHighlight ? "balance" : undefined}
              aria-label={balanceHighlight ? "Balance is blocking current coverage" : balanceNonZero ? "Account balance is non-zero" : undefined}
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <WalletCards className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs font-medium uppercase tracking-[0.08em]">Account balance</span>
              </div>
              <strong className="mt-3 block break-words text-lg font-semibold tabular-nums">{balanceText}</strong>
              {balanceHighlight && <p className="mt-1 text-xs font-medium text-[hsl(8_58%_43%)]">Blocking coverage</p>}
              <Button asChild variant="outline" size="sm" className="mt-3">
                <Link href={paymentHref} data-testid="link-bao-worker-coverage-pay-balance">Pay Balance</Link>
              </Button>
            </div>
          </div>
        </section>

        <section className="coverage-first-upcoming" aria-label="Future coverage">
          <div className="mb-3">
            <h3 className="font-semibold">Looking ahead</h3>
            <p className="mt-[2px] w-full max-w-none text-xs leading-relaxed text-muted-foreground">
              Future work months help track upcoming thresholds. They are not current coverage decisions, and “pending” is not a denial.
            </p>
          </div>
          {data.future.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No future coverage periods to show.</p>
          ) : (
            <div className="space-y-2">
              {data.future.map((period) => {
                const threshold = futureStatus[period.status];
                const ThresholdIcon = threshold.Icon;
                return (
                  <article className="coverage-first-period" key={`${period.workMonth.year}-${period.workMonth.month}`}>
                    <div className="coverage-first-flow">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Hours worked in</p>
                        <h4 className="mt-0.5 font-medium">{period.workMonth.label}</h4>
                        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                          {exactHours(period.hours.reported)} / {exactHours(period.hours.required)} required
                        </p>
                      </div>
                      <ArrowRight className="coverage-first-flow-arrow" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Hours grant coverage in</p>
                        <h4 className="mt-0.5 font-medium">{period.coverageMonth.label}</h4>
                      </div>
                    </div>
                    <div className="coverage-first-period-status">
                      <span className={`coverage-first-future-status ${threshold.tone}`} aria-label={threshold.accessibleLabel}>
                        <ThresholdIcon className="h-3.5 w-3.5" aria-hidden="true" />
                        {threshold.label}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <div className="coverage-first-footer">
          <Link href={monthlyHoursHref} className="coverage-first-link rounded-sm font-medium underline decoration-[hsl(170_38%_38%)] underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(170_38%_38%)] focus-visible:ring-offset-2" data-testid="link-bao-worker-coverage-monthly-hours">View full monthly hours breakdown</Link>
          <span className="text-xs text-muted-foreground">Questions? Contact the fund.</span>
        </div>
      </CardContent>
    </CoverageShell>
  );
}