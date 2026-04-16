import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download } from "lucide-react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface MonthColumn {
  month: number;
  year: number;
  charges: string;
  chargeDetail: string;
  adjustments: string;
  adjustmentDetail: string;
  interestPenalties: string;
  interestPenaltyDetail: string;
  paymentsCredited: string;
  paymentDetail: string;
  unpaidStatementAmount: string;
  statementBalance: string;
  incomingBalance: string;
}

interface AccountSummaryData {
  currencyCode: string;
  incomingBalance: string;
  currentBalance: string;
  months: MonthColumn[];
  current: MonthColumn;
}

const SHORT_MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function createAmountFormatter(currencyCode: string) {
  return (amount: string): string => {
    const num = parseFloat(amount);
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
      }).format(num);
    } catch {
      return `${currencyCode} ${num.toFixed(2)}`;
    }
  };
}

function isZero(amount: string): boolean {
  return parseFloat(amount) === 0;
}

interface ColDef {
  key: string;
  label: string;
  field: keyof MonthColumn;
  isSummary?: boolean;
}

const COL_DEFS: ColDef[] = [
  { key: "charges", label: "Charges", field: "charges" },
  { key: "adjustments", label: "Adjustments", field: "adjustments" },
  { key: "interestPenalties", label: "Interest & Penalties", field: "interestPenalties" },
  { key: "paymentsCredited", label: "Payments Credited", field: "paymentsCredited" },
  { key: "unpaidStatementAmount", label: "Unpaid Statement", field: "unpaidStatementAmount", isSummary: true },
  { key: "statementBalance", label: "Statement Balance", field: "statementBalance", isSummary: true },
];

function exportCsv(data: AccountSummaryData) {
  const months = data.months;
  const headers = ["Period", ...COL_DEFS.map((c) => c.label)];
  const rows: string[][] = [];

  rows.push(["Incoming", ...COL_DEFS.map((c) =>
    c.key === "statementBalance" ? data.incomingBalance : ""
  )]);

  for (const m of months) {
    rows.push([
      `${SHORT_MONTH_NAMES[m.month]} ${m.year}`,
      ...COL_DEFS.map((c) => m[c.field] as string),
    ]);
  }

  rows.push(["Current", ...COL_DEFS.map((c) =>
    c.key === "statementBalance" ? data.currentBalance : (data.current[c.field] as string)
  )]);

  const csvContent = [
    headers.join(","),
    ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "account-summary.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function EASummaryContent() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery<AccountSummaryData>({
    queryKey: [`/api/ledger/ea/${id}/account-summary`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.months.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No financial data available for this account.
          </p>
        </CardContent>
      </Card>
    );
  }

  const months = data.months;
  const current = data.current;
  const formatAmount = createAmountFormatter(data.currencyCode);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Account Summary</CardTitle>
        <Button variant="outline" size="sm" onClick={() => exportCsv(data)}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-muted/50 min-w-[140px]">
                  Period
                </th>
                {COL_DEFS.map((col) => (
                  <th
                    key={col.key}
                    className="text-right py-3 px-4 font-medium text-muted-foreground min-w-[130px]"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2.5 px-4 sticky left-0 bg-background font-medium">
                  Incoming
                </td>
                {COL_DEFS.map((col) => (
                  <td key={col.key} className="py-2.5 px-4 text-right">
                    {col.key === "statementBalance"
                      ? <span className="font-semibold">{formatAmount(data.incomingBalance)}</span>
                      : ""}
                  </td>
                ))}
              </tr>

              {months.map((m) => (
                <tr key={`${m.year}-${m.month}`} className="border-b border-border/50">
                  <td className="py-2.5 px-4 sticky left-0 bg-background font-medium">
                    {SHORT_MONTH_NAMES[m.month]} {m.year}
                  </td>
                  {COL_DEFS.map((col) => {
                    const value = m[col.field] as string;
                    const zero = isZero(value);
                    return (
                      <td
                        key={col.key}
                        className={`py-2.5 px-4 text-right ${col.isSummary ? "font-semibold" : ""} ${zero && !col.isSummary ? "text-muted-foreground" : ""}`}
                      >
                        {formatAmount(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}

              <tr className="border-t-2 border-border bg-muted/30">
                <td className="py-2.5 px-4 sticky left-0 bg-muted/30 font-semibold">
                  Current
                </td>
                {COL_DEFS.map((col) => {
                  const value = col.key === "statementBalance"
                    ? data.currentBalance
                    : (current[col.field] as string);
                  return (
                    <td key={col.key} className="py-2.5 px-4 text-right font-semibold">
                      {formatAmount(value)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EASummaryPage() {
  return (
    <EALayout activeTab="summary">
      <EASummaryContent />
    </EALayout>
  );
}
