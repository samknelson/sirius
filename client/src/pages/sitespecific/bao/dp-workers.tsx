import { useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, HeartHandshake } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/queryClient";

type Status = "paid_covered" | "partially_paid" | "unpaid_not_covered" | "confirmed_no_charge" | "unavailable_not_covered";

type BillingWarning = "posted_charge_inputs_unavailable" | "posted_charge_amount_mismatch";
type UnavailableReason = "missing_benefit_presence" | "missing_effective_rate" | "ambiguous_coverage_basis";
type Row = {
  workerId: string;
  workerName: string;
  partnerWorkerId: string;
  partnerName: string;
  electionId: string;
  relationshipId: string;
  coverageMonth: string;
  charge: string | number;
  paidAmount: string | number;
  balance: string | number;
  status: Status;
  unavailableReason: UnavailableReason | null;
  billingWarning: BillingWarning | null;
};
type Response = {
  asOfYmd: string;
  currentMonth: string;
  data: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const STATUS_LABELS: Record<Status, string> = {
  paid_covered: "Paid / covered",
  partially_paid: "Partially paid",
  unpaid_not_covered: "Unpaid / not covered",
  confirmed_no_charge: "Confirmed no charge",
  unavailable_not_covered: "Unavailable / not covered",
};

const BILLING_WARNING_LABELS: Record<BillingWarning, string> = {
  posted_charge_inputs_unavailable: "Posted charge kept; current coverage inputs or rate are unavailable",
  posted_charge_amount_mismatch: "Posted charge kept; current coverage inputs calculate a different amount",
};

const UNAVAILABLE_REASON_LABELS: Record<UnavailableReason, string> = {
  missing_benefit_presence: "No elected benefit is present for this coverage month",
  missing_effective_rate: "No confirmed effective rate is available",
  ambiguous_coverage_basis: "More than one benefit could determine the coverage rate",
};

function money(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";
}

export default function BaoDpWorkersPage() {
  const [location, navigate] = useLocation();
  const initialStatus = new URLSearchParams(location.split("?")[1] ?? "").get("status");
  const [status, setStatus] = useState<Status | "all">(
    initialStatus && initialStatus in STATUS_LABELS ? (initialStatus as Status) : "all",
  );
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: "25" });
  if (status !== "all") params.set("status", status);
  const updateStatus = (value: Status | "all") => {
    setStatus(value);
    setPage(1);
    navigate(value === "all" ? "/bao/dp/workers" : `/bao/dp/workers?status=${encodeURIComponent(value)}`);
  };
  const { data, isLoading, error } = useQuery<Response>({
    queryKey: ["/api/sitespecific/bao/dp-report/workers", status, page],
    queryFn: async () => {
      const response = await fetch(`/api/sitespecific/bao/dp-report/workers?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      return response.json();
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Domestic Partner workers" icon={<HeartHandshake className="text-primary-foreground" size={16} />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>
              Active Domestic Partner coverage
              {data?.currentMonth ? ` — ${data.currentMonth}` : ""}
            </CardTitle>
            <Select value={status} onValueChange={(value) => updateStatus(value as Status | "all")}>
              <SelectTrigger className="w-[220px]" data-testid="select-bao-dp-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-48 w-full" /> : error ? (
              <p className="text-sm text-destructive" data-testid="text-bao-dp-workers-error">{getApiErrorMessage(error, "Could not load Domestic Partner workers.")}</p>
            ) : !data || data.data.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-bao-dp-workers-empty">No active Domestic Partner workers match this filter.</p>
            ) : (
              <>
                <Table data-testid="table-bao-dp-workers">
                  <TableHeader><TableRow><TableHead>Subscriber</TableHead><TableHead>Domestic partner</TableHead><TableHead>Coverage month</TableHead><TableHead>Charge</TableHead><TableHead>Paid</TableHead><TableHead>Balance</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                  <TableBody>{data.data.map((row) => (
                    <TableRow key={`${row.electionId}-${row.relationshipId}`} data-testid={`row-bao-dp-worker-${row.workerId}`}>
                      <TableCell><Link className="text-primary hover:underline" href={`/workers/${row.workerId}/sitespecific/bao/dp`}>{row.workerName}</Link></TableCell>
                      <TableCell><Link className="text-primary hover:underline" href={`/workers/${row.partnerWorkerId}/sitespecific/bao/dp`}>{row.partnerName}</Link></TableCell>
                      <TableCell>{row.coverageMonth}</TableCell>
                      <TableCell>{money(row.charge)}</TableCell><TableCell>{money(row.paidAmount)}</TableCell><TableCell>{money(row.balance)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge variant="outline">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                          {row.billingWarning ? (
                            <span className="flex max-w-xs items-start gap-1 text-xs text-amber-700 dark:text-amber-400" data-testid={`warning-bao-dp-worker-${row.workerId}`}>
                              <AlertTriangle className="mt-0.5 shrink-0" size={13} aria-hidden="true" />
                              {BILLING_WARNING_LABELS[row.billingWarning]}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {row.unavailableReason ? UNAVAILABLE_REASON_LABELS[row.unavailableReason] : "—"}
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Showing page {data.page} of {data.totalPages} ({data.total} total)</span>
                  <span className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button></span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
