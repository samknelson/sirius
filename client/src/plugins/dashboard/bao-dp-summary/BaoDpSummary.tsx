import { Link } from "wouter";
import { HeartHandshake } from "lucide-react";
import { useDashboardContent } from "../useDashboardContent";
import type { DashboardPluginProps } from "../registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type DpStatus =
  | "paid_covered"
  | "partially_paid"
  | "unpaid_not_covered"
  | "confirmed_no_charge"
  | "unavailable_not_covered";

interface DpSummary {
  asOfYmd: string;
  currentMonth: string;
  totalActiveWorkers: number;
  totalCharges: string | number;
  totalPaid: string | number;
  totalBalance: string | number;
  statusCounts: Record<DpStatus, number>;
}

const STATUS_LABELS: Record<DpStatus, string> = {
  paid_covered: "Paid / covered",
  partially_paid: "Partially paid",
  unpaid_not_covered: "Unpaid / not covered",
  confirmed_no_charge: "Confirmed no charge",
  unavailable_not_covered: "Unavailable / not covered",
};

function money(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

function reportLink(status?: DpStatus) {
  return status ? `/bao/dp/workers?status=${encodeURIComponent(status)}` : "/bao/dp/workers";
}

export function BaoDpSummary(_props: DashboardPluginProps) {
  const { data, isLoading, isError } = useDashboardContent<DpSummary>("bao-dp-summary");

  if (isLoading) {
    return (
      <Card data-testid="card-dashboard-bao-dp-summary">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-4 w-4" /> Domestic Partner</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card data-testid="card-dashboard-bao-dp-summary">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-4 w-4" /> Domestic Partner</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-destructive" data-testid="text-bao-dp-summary-error">Domestic Partner monitoring is temporarily unavailable. Please try again later.</p></CardContent>
      </Card>
    );
  }

  const statuses = Object.keys(STATUS_LABELS) as DpStatus[];
  return (
    <Card data-testid="card-dashboard-bao-dp-summary">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-4 w-4" /> Domestic Partner</CardTitle>
        <CardDescription>Current-month coverage and member-charge monitoring ({data.currentMonth}).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data.totalActiveWorkers === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="text-bao-dp-summary-empty">No active Domestic Partner workers for this month.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Active workers" value={data.totalActiveWorkers} href={reportLink()} testId="active-workers" />
              <Metric label="Total charge" value={money(data.totalCharges)} href={reportLink()} testId="total-charge" />
              <Metric label="Total paid" value={money(data.totalPaid)} href={reportLink()} testId="total-paid" />
              <Metric label="Total balance" value={money(data.totalBalance)} href={reportLink()} testId="total-balance" />
            </div>
            <div className="space-y-2">
              {statuses.map((status) => (
                <Link key={status} href={reportLink(status)} className="flex items-center justify-between rounded border p-2 hover:bg-muted" data-testid={`link-bao-dp-status-${status}`}>
                  <span>{STATUS_LABELS[status]}</span>
                  <span className="font-semibold">{data.statusCounts?.[status] ?? 0}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        <Link href={reportLink()} className="text-sm text-primary hover:underline" data-testid="link-bao-dp-open-report">Open active worker report</Link>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, href, testId }: { label: string; value: string | number; href: string; testId: string }) {
  return (
    <Link href={href} className="rounded border p-3 hover:bg-muted" data-testid={`link-bao-dp-${testId}`}>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </Link>
  );
}
