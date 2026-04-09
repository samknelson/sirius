import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
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
  incomingBalance: string;
  months: MonthColumn[];
}

const SHORT_MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(num);
}

function isZero(amount: string): boolean {
  return parseFloat(amount) === 0;
}

const ROW_DEFS = [
  { key: "incomingBalance", label: "Incoming Balance", isBold: true },
  { key: "charges", label: "Charges", detailKey: "chargeDetail" },
  { key: "adjustments", label: "Adjustments", detailKey: "adjustmentDetail" },
  { key: "interestPenalties", label: "Interest & Penalties", detailKey: "interestPenaltyDetail" },
  { key: "paymentsCredited", label: "Payments Credited", detailKey: "paymentDetail" },
  { key: "unpaidStatementAmount", label: "Unpaid Amount", isBold: true },
  { key: "statementBalance", label: "Statement Balance", isBold: true },
] as const;

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account Summary</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-muted/50 min-w-[180px]">
                </th>
                {months.map((m) => (
                  <th
                    key={`${m.year}-${m.month}`}
                    className="text-right py-3 px-4 font-medium text-muted-foreground min-w-[130px]"
                  >
                    {SHORT_MONTH_NAMES[m.month]} {m.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_DEFS.map((row, rowIdx) => {
                const isTopBorder = row.key === "unpaidStatementAmount";
                const isBottomRow = row.key === "statementBalance";

                return (
                  <tr
                    key={row.key}
                    className={`
                      ${isTopBorder ? "border-t-2 border-border" : "border-b border-border/50"}
                      ${isBottomRow ? "bg-muted/30" : ""}
                      ${rowIdx === 0 ? "bg-muted/30" : ""}
                    `}
                  >
                    <td className={`py-2.5 px-4 sticky left-0 bg-background ${row.isBold ? "font-semibold" : ""} ${isBottomRow || rowIdx === 0 ? "bg-muted/30" : ""}`}>
                      {row.label}
                    </td>
                    {months.map((m) => {
                      const value = m[row.key as keyof MonthColumn] as string;
                      const detailKey = "detailKey" in row ? row.detailKey : undefined;
                      const detail = detailKey ? (m[detailKey as keyof MonthColumn] as string) : "";
                      const zero = isZero(value);

                      return (
                        <td
                          key={`${m.year}-${m.month}`}
                          className={`py-2.5 px-4 text-right ${row.isBold ? "font-semibold" : ""} ${zero && !row.isBold ? "text-muted-foreground" : ""}`}
                        >
                          <div>{formatAmount(value)}</div>
                          {detail && (
                            <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
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
