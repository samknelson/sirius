import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { HeartHandshake, Info, CreditCard } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DpMonthStatus = "paid" | "partial" | "unpaid";

type DpMonth = {
  month: string;
  electionId: string;
  dpRelationshipId: string;
  dpWorkerId: string | null;
  netCharge: string;
  paidAmount: string;
  status: DpMonthStatus;
};

type DpState = {
  accountId: string;
  configId: string;
  balance: string;
  totalCharges: string;
  totalPaid: string;
  months: DpMonth[];
};

type WorkerDpResponse = {
  configured: boolean;
  state: DpState | null;
  dependents: Record<string, string>;
  eaId: string | null;
};

const STATUS_LABELS: Record<DpMonthStatus, string> = {
  paid: "Paid",
  partial: "Partially paid",
  unpaid: "Unpaid",
};

const STATUS_CLASSES: Record<DpMonthStatus, string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent",
  partial:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-transparent",
  unpaid: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-transparent",
};

function formatCurrency(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString("default", {
    month: "long",
    timeZone: "UTC",
  })} ${y}`;
}

function WorkerDpContent() {
  const { worker } = useWorkerLayout();

  const { data, isLoading, isError } = useQuery<WorkerDpResponse>({
    queryKey: ["/api/workers", worker.id, "sitespecific/bao/dp"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground" data-testid="text-dp-error">
            Could not load domestic partner information. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data?.configured || !data.state) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground" data-testid="text-dp-not-configured">
            Domestic partner billing is not configured. Please contact the office for
            details.
          </p>
        </CardContent>
      </Card>
    );
  }

  const state = data.state;
  const balanceNum = Number(state.balance);
  const owesMoney = Number.isFinite(balanceNum) && balanceNum > 0.005;

  const dependentName = (m: DpMonth): string => {
    return data.dependents[m.dpRelationshipId] ?? "Domestic partner";
  };

  return (
    <div className="space-y-6">
      <Alert data-testid="alert-dp-coverage-note">
        <Info className="h-4 w-4" />
        <AlertTitle>About domestic partner member charges</AlertTitle>
        <AlertDescription>
          The monthly member charge is the amount collected from you for domestic partner
          coverage. Unpaid member charges affect only the domestic partner's coverage —
          they do not affect your own benefits. A coverage month with a charge must be
          paid before it begins for the domestic partner to be covered that month; months
          confirmed as no charge are not billed and need no payment.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <HeartHandshake className="h-5 w-5 text-primary" />
              <CardTitle>Domestic Partner Member Charges</CardTitle>
            </div>
            {data.eaId && owesMoney && (
              <Button asChild data-testid="button-dp-pay">
                <Link href={`/ea/${data.eaId}/payments/new`}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Make a Payment
                </Link>
              </Button>
            )}
          </div>
          <CardDescription>
            Monthly member charges billed to the domestic partner account, and their
            payment status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total charged</p>
              <p className="text-lg font-semibold" data-testid="text-dp-total-charges">
                {formatCurrency(state.totalCharges)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Total paid</p>
              <p className="text-lg font-semibold" data-testid="text-dp-total-paid">
                {formatCurrency(state.totalPaid)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Amount due</p>
              <p
                className={`text-lg font-semibold ${owesMoney ? "text-destructive" : ""}`}
                data-testid="text-dp-balance"
              >
                {owesMoney ? formatCurrency(state.balance) : "No amount owed"}
              </p>
            </div>
          </div>

          {state.months.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-dp-no-charges">
              No domestic partner member charges have been billed yet.
            </p>
          ) : (
            <Table data-testid="table-dp-months">
              <TableHeader>
                <TableRow>
                  <TableHead>Coverage month</TableHead>
                  <TableHead>Domestic partner</TableHead>
                  <TableHead className="text-right">Member charge</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.months.map((m) => {
                  const rowKey = `${m.electionId}-${m.dpRelationshipId}-${m.month}`;
                  return (
                    <TableRow key={rowKey} data-testid={`row-dp-month-${rowKey}`}>
                      <TableCell className="font-medium" data-testid={`text-dp-month-${rowKey}`}>
                        {formatMonth(m.month)}
                      </TableCell>
                      <TableCell data-testid={`text-dp-dependent-${rowKey}`}>
                        {dependentName(m)}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-dp-charge-${rowKey}`}>
                        {formatCurrency(m.netCharge)}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-dp-paid-${rowKey}`}>
                        {formatCurrency(m.paidAmount)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_CLASSES[m.status]}
                          data-testid={`status-dp-month-${rowKey}`}
                        >
                          {STATUS_LABELS[m.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerDpPage() {
  return (
    <WorkerLayout activeTab="sitespecific-bao-dp">
      <WorkerDpContent />
    </WorkerLayout>
  );
}
