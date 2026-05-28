import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatAmount } from "@shared/currency";

type Basis = "cash" | "accrual";
type Months = 6 | 12;
type SideFilter = "both" | "charges" | "payments";
type DrillSide = "charges" | "payments";

interface SummaryRow {
  ym: string;
  charges: string;
  payments: string;
}

interface SummaryResponse {
  accountId: string;
  currencyCode: string;
  basis: Basis;
  months: Months;
  monthKeys: string[];
  rows: SummaryRow[];
}

interface DrilldownEntry {
  id: string;
  chargePlugin: string;
  chargePluginKey: string;
  amount: string;
  eaId: string;
  referenceType: string | null;
  referenceId: string | null;
  date: string | null;
  statementYmd: string;
  memo: string | null;
}

interface DrilldownResponse {
  accountId: string;
  currencyCode: string;
  basis: Basis;
  side: DrillSide;
  ym: string;
  entries: DrilldownEntry[];
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function sumStrings(values: string[]): string {
  const total = values.reduce((acc, v) => acc + Number(v || 0), 0);
  return total.toFixed(2);
}

function absAmount(amount: string): string {
  const n = Number(amount || 0);
  return Math.abs(n).toFixed(2);
}

function AccountSummaryContent() {
  usePageTitle("Account Summary");
  const { id } = useParams<{ id: string }>();
  const { account } = useLedgerAccountLayout();

  const [basis, setBasis] = useState<Basis>("accrual");
  const [months, setMonths] = useState<Months>(12);
  const [sideFilter, setSideFilter] = useState<SideFilter>("both");
  const [drill, setDrill] = useState<{ ym: string; side: DrillSide } | null>(null);

  const summaryQuery = useQuery<SummaryResponse>({
    queryKey: ["/api/ledger/accounts", id, "summary", basis, months],
    queryFn: async () => {
      const res = await fetch(
        `/api/ledger/accounts/${id}/summary?basis=${basis}&months=${months}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to fetch summary");
      }
      return res.json();
    },
  });

  const drillQuery = useQuery<DrilldownResponse>({
    queryKey: [
      "/api/ledger/accounts",
      id,
      "summary",
      "drilldown",
      basis,
      drill?.ym,
      drill?.side,
    ],
    enabled: !!drill,
    queryFn: async () => {
      const params = new URLSearchParams({
        basis,
        side: drill!.side,
        ym: drill!.ym,
      });
      const res = await fetch(
        `/api/ledger/accounts/${id}/summary/drilldown?${params.toString()}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to fetch drilldown");
      }
      return res.json();
    },
  });

  const currency = account.currencyCode;
  const showCharges = sideFilter !== "payments";
  const showPayments = sideFilter !== "charges";

  const renderCell = (value: string, side: DrillSide, ym: string) => {
    const n = Number(value || 0);
    if (n === 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    return (
      <button
        type="button"
        className="text-right tabular-nums hover:underline focus:underline focus:outline-none"
        onClick={() => setDrill({ ym, side })}
        data-testid={`button-summary-cell-${side}-${ym}`}
      >
        {formatAmount(Math.abs(n), currency)}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Basis:</span>
            <div className="flex gap-1">
              <Button
                variant={basis === "cash" ? "default" : "outline"}
                size="sm"
                onClick={() => setBasis("cash")}
                data-testid="button-basis-cash"
              >
                Cash
              </Button>
              <Button
                variant={basis === "accrual" ? "default" : "outline"}
                size="sm"
                onClick={() => setBasis("accrual")}
                data-testid="button-basis-accrual"
              >
                Accrual
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Window:</span>
            <div className="flex gap-1">
              <Button
                variant={months === 6 ? "default" : "outline"}
                size="sm"
                onClick={() => setMonths(6)}
                data-testid="button-months-6"
              >
                6 mo
              </Button>
              <Button
                variant={months === 12 ? "default" : "outline"}
                size="sm"
                onClick={() => setMonths(12)}
                data-testid="button-months-12"
              >
                12 mo
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Show:</span>
            <div className="flex gap-1">
              <Button
                variant={sideFilter === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => setSideFilter("both")}
                data-testid="button-side-both"
              >
                All
              </Button>
              <Button
                variant={sideFilter === "charges" ? "default" : "outline"}
                size="sm"
                onClick={() => setSideFilter("charges")}
                data-testid="button-side-charges"
              >
                Charges
              </Button>
              <Button
                variant={sideFilter === "payments" ? "default" : "outline"}
                size="sm"
                onClick={() => setSideFilter("payments")}
                data-testid="button-side-payments"
              >
                Payments
              </Button>
            </div>
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            Currency: <span className="font-medium">{currency}</span>
          </div>
        </CardContent>
      </Card>

      {/* Summary Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {summaryQuery.isError && (
            <div
              className="text-sm text-destructive p-3 border border-destructive/30 rounded"
              data-testid="text-summary-error"
            >
              {(summaryQuery.error as Error).message}
            </div>
          )}
          {summaryQuery.data && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-medium">Row</th>
                    {summaryQuery.data.monthKeys.map((ym) => (
                      <th
                        key={ym}
                        className="text-right py-2 px-2 font-medium whitespace-nowrap"
                      >
                        {formatMonthLabel(ym)}
                      </th>
                    ))}
                    <th className="text-right py-2 pl-4 font-semibold border-l border-border">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {showCharges && (
                    <tr
                      className="border-b border-border"
                      data-testid="row-summary-charges"
                    >
                      <td className="py-2 pr-4 font-medium">Charges</td>
                      {summaryQuery.data.rows.map((row) => (
                        <td key={row.ym} className="text-right py-2 px-2">
                          {renderCell(row.charges, "charges", row.ym)}
                        </td>
                      ))}
                      <td className="text-right py-2 pl-4 font-semibold tabular-nums border-l border-border">
                        {formatAmount(
                          Math.abs(
                            Number(
                              sumStrings(summaryQuery.data.rows.map((r) => r.charges)),
                            ),
                          ),
                          currency,
                        )}
                      </td>
                    </tr>
                  )}
                  {showPayments && (
                    <tr data-testid="row-summary-payments">
                      <td className="py-2 pr-4 font-medium">Payments</td>
                      {summaryQuery.data.rows.map((row) => (
                        <td key={row.ym} className="text-right py-2 px-2">
                          {renderCell(row.payments, "payments", row.ym)}
                        </td>
                      ))}
                      <td className="text-right py-2 pl-4 font-semibold tabular-nums border-l border-border">
                        {formatAmount(
                          Math.abs(
                            Number(
                              sumStrings(summaryQuery.data.rows.map((r) => r.payments)),
                            ),
                          ),
                          currency,
                        )}
                      </td>
                    </tr>
                  )}
                  {!showCharges && !showPayments && (
                    <tr>
                      <td
                        colSpan={summaryQuery.data.monthKeys.length + 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No rows selected.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {summaryQuery.data.rows.every(
                (r) => Number(r.charges) === 0 && Number(r.payments) === 0,
              ) && (
                <div
                  className="text-center text-muted-foreground py-6 text-sm"
                  data-testid="text-summary-empty"
                >
                  No ledger entries in this window.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drilldown Dialog */}
      <Dialog open={!!drill} onOpenChange={(open) => !open && setDrill(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {drill?.side === "payments" ? "Payments" : "Charges"} —{" "}
              {drill ? formatMonthLabel(drill.ym) : ""}
            </DialogTitle>
            <DialogDescription>
              {basis === "cash" ? "Bucketed by entry date." : "Bucketed by statement month."}
            </DialogDescription>
          </DialogHeader>

          {drillQuery.isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          )}
          {drillQuery.isError && (
            <div
              className="text-sm text-destructive p-3 border border-destructive/30 rounded"
              data-testid="text-drill-error"
            >
              {(drillQuery.error as Error).message}
            </div>
          )}
          {drillQuery.data && (
            <div className="overflow-x-auto max-h-[60vh]">
              {drillQuery.data.entries.length === 0 ? (
                <div className="text-center text-muted-foreground py-6 text-sm">
                  No entries in this month.
                </div>
              ) : (
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 font-medium">Date</th>
                      <th className="text-left py-2 pr-3 font-medium">Stmt YMD</th>
                      <th className="text-left py-2 pr-3 font-medium">Plugin</th>
                      <th className="text-left py-2 pr-3 font-medium">Reference</th>
                      <th className="text-left py-2 pr-3 font-medium">Memo</th>
                      <th className="text-right py-2 pl-3 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillQuery.data.entries.map((entry) => {
                      const isPayment =
                        entry.chargePlugin === "payment-simple-allocation";
                      return (
                        <tr
                          key={entry.id}
                          className="border-b border-border/50"
                          data-testid={`row-drill-${entry.id}`}
                        >
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {entry.date
                              ? new Date(entry.date).toLocaleDateString()
                              : "—"}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                            {entry.statementYmd}
                          </td>
                          <td className="py-2 pr-3">
                            {isPayment ? (
                              <Badge variant="secondary">payment</Badge>
                            ) : (
                              <span className="text-muted-foreground">
                                {entry.chargePlugin}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {entry.referenceType && entry.referenceId
                              ? `${entry.referenceType}:${entry.referenceId.substring(0, 8)}…`
                              : "—"}
                          </td>
                          <td className="py-2 pr-3 max-w-xs truncate" title={entry.memo || ""}>
                            {entry.memo || "—"}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums">
                            {formatAmount(Number(absAmount(entry.amount)), currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {drillQuery.data.entries.length === 1000 && (
                <div className="text-xs text-muted-foreground py-2 text-center">
                  Showing first 1,000 entries.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AccountSummaryPage() {
  return (
    <LedgerAccountLayout activeTab="summary">
      <AccountSummaryContent />
    </LedgerAccountLayout>
  );
}
