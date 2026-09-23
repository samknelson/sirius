import { ArrowRight, Check, Minus, X } from "lucide-react";
import { Link } from "wouter";
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

function StatusIcon({ kind, label }: { kind: "good" | "bad" | "pending"; label: string }) {
  const Icon = kind === "good" ? Check : kind === "bad" ? X : Minus;
  return (
    <span className={`bao-worker-coverage-status bao-worker-coverage-status--${kind}`} title={label}>
      <Icon aria-hidden="true" strokeWidth={3} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CurrentStatus({ coverage }: { coverage: BaoCoverageSummary["current"]["coverage"] }) {
  if (coverage === "covered") return <StatusIcon kind="good" label="Coverage confirmed" />;
  if (coverage === "not-covered") return <StatusIcon kind="bad" label="Not covered" />;
  return <StatusIcon kind="pending" label={coverage === "stale" ? "Coverage needs updating" : "Coverage unavailable"} />;
}

function FutureStatus({ status }: { status: BaoCoverageSummary["future"][number]["status"] }) {
  if (status === "met") return <StatusIcon kind="good" label="Hours threshold met" />;
  if (status === "below") return <StatusIcon kind="bad" label="Hours threshold not met" />;
  return <StatusIcon kind="pending" label="Hours threshold pending" />;
}

export function BaoWorkerCoverage(_props: DashboardPluginProps) {
  const { data, isLoading, isError } =
    useDashboardContent<BaoCoverageSummary>("bao-worker-coverage");

  if (isLoading) {
    return (
      <section className="bao-worker-coverage-card" aria-label="Coverage loading" data-testid="card-dashboard-bao-worker-coverage">
        <div className="bao-worker-coverage-loading">
          <Skeleton className="h-5 w-52" /><Skeleton className="h-20 w-full" />
          <Skeleton className="h-5 w-64" /><Skeleton className="h-20 w-full" />
        </div>
      </section>
    );
  }

  if (isError) {
    return <section className="bao-worker-coverage-card" role="alert" data-testid="card-dashboard-bao-worker-coverage">
      <div className="bao-worker-coverage-message"><strong>Coverage information is temporarily unavailable.</strong><span>Please try again later.</span></div>
    </section>;
  }

  if (!data || data.state === "unlinked") {
    return <section className="bao-worker-coverage-card" data-testid="card-dashboard-bao-worker-coverage">
      <div className="bao-worker-coverage-message"><strong>Coverage information is not available.</strong><span>Your worker account is not linked to benefits coverage yet.</span></div>
    </section>;
  }

  if (data.state === "unavailable") {
    return <section className="bao-worker-coverage-card" data-testid="card-dashboard-bao-worker-coverage">
      <div className="bao-worker-coverage-message"><strong>Coverage information is unavailable.</strong><span>Please try again later.</span></div>
    </section>;
  }

  return <BaoWorkerCoverageView data={data} />;
}

/** Shared presentation for the member dashboard and admin worker record. */
export function BaoWorkerCoverageView({ data }: { data: BaoCoverageSummary }) {
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

  return (
    <section className="bao-worker-coverage-card" data-testid="card-dashboard-bao-worker-coverage">
      <header className="bao-worker-coverage-title">Am I Covered Now?</header>
      <div className="bao-worker-coverage-current" aria-label="Current coverage">
        <div className="bao-worker-coverage-field"><span className="bao-worker-coverage-label">Work Hours</span><strong>{data.current.workMonth.label}</strong></div>
        <div className={`bao-worker-coverage-field bao-worker-coverage-hours ${hoursHighlight ? "is-highlighted" : ""}`}>
          <span><b>Reported:</b> {exactHours(data.current.hours?.reported)}</span>
          <span><b>Required:</b> {exactHours(data.current.hours?.required)}</span>
        </div>
        <div className={`bao-worker-coverage-field bao-worker-coverage-balance ${balanceHighlight ? "is-highlighted" : ""}`}>
          <span className="bao-worker-coverage-label">Balance</span><strong>{balanceText}</strong>
        </div>
        <div className="bao-worker-coverage-field"><span className="bao-worker-coverage-label">Current Coverage</span><strong>{data.current.coverageMonth.label}</strong></div>
        <div className="bao-worker-coverage-current-status"><CurrentStatus coverage={data.current.coverage} /></div>
      </div>

      <header className="bao-worker-coverage-title bao-worker-coverage-title--future">Have I Met My Hours for Future Coverage?</header>
      <div className="bao-worker-coverage-future" aria-label="Future coverage">
        <div className="bao-worker-coverage-table-head"><span>Work Month</span><span>Reported Hours</span><span>Coverage Month</span><span>Hours Threshold Met</span></div>
        {data.future.length === 0 ? <div className="bao-worker-coverage-empty">No future coverage periods to show.</div> : data.future.map((period) => (
          <div className={`bao-worker-coverage-table-row bao-worker-coverage-row--${period.status}`} key={`${period.workMonth.year}-${period.workMonth.month}`}>
            <span>{period.workMonth.label}</span>
            <span>{exactHours(period.hours.reported)} <ArrowRight className="bao-worker-coverage-arrow" aria-hidden="true" /></span>
            <span>{period.coverageMonth.label}</span>
            <span><FutureStatus status={period.status} /></span>
          </div>
        ))}
      </div>
      <footer className="bao-worker-coverage-footer">
        <Link href={monthlyHoursHref} data-testid="link-bao-worker-coverage-monthly-hours">View your full monthly hours breakdown</Link>
        <span>Contact the fund with any questions or concerns.</span>
      </footer>
    </section>
  );
}