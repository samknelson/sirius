import { PaymentLayout, usePaymentLayout } from "@/components/layouts/PaymentLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import type { LedgerPayment } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { formatAmount } from "@shared/currency";

function PaymentViewContent() {
  const { id } = useParams<{ id: string }>();
  const { payment: layoutPayment, paymentType } = usePaymentLayout();

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });
  
  const currencyCode = paymentType?.currencyCode || 'USD';

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "cleared":
        return "default";
      case "draft":
        return "secondary";
      case "canceled":
        return "outline";
      case "error":
        return "destructive";
      default:
        return "secondary";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!payment) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center">Payment not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Payment Details</CardTitle>
          <CardDescription>View payment information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Payment ID</label>
              <p className="mt-1 font-mono text-sm" data-testid="text-payment-id">{payment.id}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Amount</label>
              <p className="mt-1 font-mono text-lg font-semibold" data-testid="text-amount">
                {formatAmount(parseFloat(payment.amount), currencyCode)}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div className="mt-1">
                <Badge variant={getStatusBadgeVariant(payment.status)} data-testid="badge-payment-status">
                  {payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}
                </Badge>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Allocated</label>
              <p className="mt-1" data-testid="text-allocated">
                {payment.allocated ? "Yes" : "No"}
              </p>
            </div>

            {payment.details && (payment.details as any).merchant && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Merchant</label>
                <p className="mt-1" data-testid="text-merchant">{(payment.details as any).merchant}</p>
              </div>
            )}

            {payment.details && (payment.details as any).checkTransactionNumber && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Check or Transaction Number</label>
                <p className="mt-1" data-testid="text-check-transaction-number">{(payment.details as any).checkTransactionNumber}</p>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Dates</label>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="mt-1" data-testid="text-date-created">
                  {payment.dateCreated ? new Date(payment.dateCreated).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Received</p>
                <p className="mt-1" data-testid="text-date-received">
                  {payment.dateReceived ? new Date(payment.dateReceived).toLocaleDateString() : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cleared</p>
                <p className="mt-1" data-testid="text-date-cleared">
                  {payment.dateCleared ? new Date(payment.dateCleared).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          {payment.memo && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">Memo</label>
              <p className="mt-1 whitespace-pre-wrap" data-testid="text-memo">{payment.memo}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <LedgerTransactionsView
        queryKey={[`/api/ledger/payments/${id}/transactions`]}
        title="Associated Transactions"
        csvFilename={`payment-${id}-transactions`}
        showEntityType={true}
        showEntityName={true}
        showEaAccount={true}
        showEaLink={true}
        currencyCode={currencyCode}
      />
    </div>
  );
}

export default function PaymentView() {
  return (
    <PaymentLayout activeTab="view">
      <PaymentViewContent />
    </PaymentLayout>
  );
}
