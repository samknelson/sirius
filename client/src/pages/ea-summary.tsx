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
  currencyCode: string;
  incomingBalance: string;
  currentBalance: string;
  months: MonthColumn[];
}

const SHORT_MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function createAmountFormatter(currencyCode: string) {
  return (amount: string): string => {
    const num = parseFloat(amount);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
    }).format(num);
  };
}

function isZero(amount: string): boolean {
  return parseFloat(amount) === 0;
}

type RowType = "amount" | "detail" | "summary";

interface RowDef {
  key: string;
  label: string;
  type: RowType;
  amountField?: keyof MonthColumn;
  detailField?: keyof MonthColumn;
  incomingValue?: "incomingBalance";
  currentValue?: "currentBalance";
}

const ROW_DEFS: RowDef[] = [
  { key: "incomingBalance", label: "Incoming Balance", type: "summary", amountField: "incomingBalance", incomingValue: "incomingBalance" },
  { key: "charges", label: "Charges", type: "amount", amountField: "charges" },
  { key: "chargeDetail", label: "", type: "detail", detailField: "chargeDetail" },
  { key: "adjustments", label: "Adjustments", type: "amount", amountField: "adjustments" },
  { key: "adjustmentDetail", label: "", type: "detail", detailField: "adjustmentDetail" },
  { key: "interestPenalties", label: "Interest & Penalties", type: "amount", amountField: "interestPenalties" },
  { key: "interestPenaltyDetail", label: "", type: "detail", detailField: "interestPenaltyDetail" },
  { key: "paymentsCredited", label: "Payments Credited", type: "amount", amountField: "paymentsCredited" },
  { key: "paymentDetail", label: "", type: "detail", detailField: "paymentDetail" },
  { key: "unpaidStatementAmount", label: "Unpaid Amount", type: "summary", amountField: "unpaidStatementAmount" },
  { key: "statementBalance", label: "Statement Balance", type: "summary", amountField: "statementBalance", currentValue: "currentBalance" },
];

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
  const formatAmount = createAmountFormatter(data.currencyCode);

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
                <th className="text-right py-3 px-4 font-medium text-muted-foreground min-w-[120px]">
                  Incoming
                </th>
                {months.map((m) => (
                  <th
                    key={`${m.year}-${m.month}`}
                    className="text-right py-3 px-4 font-medium text-muted-foreground min-w-[130px]"
                  >
                    {SHORT_MONTH_NAMES[m.month]} {m.year}
                  </th>
                ))}
                <th className="text-right py-3 px-4 font-medium text-muted-foreground min-w-[120px]">
                  Current
                </th>
              </tr>
            </thead>
            <tbody>
              {ROW_DEFS.map((row) => {
                const isSummary = row.type === "summary";
                const isDetail = row.type === "detail";
                const isTopBorder = row.key === "unpaidStatementAmount";
                const isBottomRow = row.key === "statementBalance";
                const isFirstRow = row.key === "incomingBalance";

                if (isDetail) {
                  return (
                    <tr key={row.key} className="border-b border-border/30">
                      <td className="py-1 px-4 sticky left-0 bg-background text-xs text-muted-foreground italic">
                        {row.label}
                      </td>
                      <td className="py-1 px-4"></td>
                      {months.map((m) => {
                        const detail = row.detailField ? (m[row.detailField] as string) : "";
                        return (
                          <td key={`${m.year}-${m.month}`} className="py-1 px-4 text-right text-xs text-muted-foreground italic">
                            {detail}
                          </td>
                        );
                      })}
                      <td className="py-1 px-4"></td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={row.key}
                    className={`
                      ${isTopBorder ? "border-t-2 border-border" : "border-b border-border/50"}
                      ${isBottomRow || isFirstRow ? "bg-muted/30" : ""}
                    `}
                  >
                    <td className={`py-2.5 px-4 sticky left-0 ${isBottomRow || isFirstRow ? "bg-muted/30" : "bg-background"} ${isSummary ? "font-semibold" : ""}`}>
                      {row.label}
                    </td>
                    <td className={`py-2.5 px-4 text-right ${isSummary ? "font-semibold" : ""}`}>
                      {row.incomingValue ? formatAmount(data[row.incomingValue]) : ""}
                    </td>
                    {months.map((m) => {
                      const value = row.amountField ? (m[row.amountField] as string) : "0.00";
                      const zero = isZero(value);
                      return (
                        <td
                          key={`${m.year}-${m.month}`}
                          className={`py-2.5 px-4 text-right ${isSummary ? "font-semibold" : ""} ${zero && !isSummary ? "text-muted-foreground" : ""}`}
                        >
                          {formatAmount(value)}
                        </td>
                      );
                    })}
                    <td className={`py-2.5 px-4 text-right ${isSummary ? "font-semibold" : ""}`}>
                      {row.currentValue ? formatAmount(data[row.currentValue]) : ""}
                    </td>
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
