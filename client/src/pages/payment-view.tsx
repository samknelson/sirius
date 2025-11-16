import { PaymentLayout } from "@/components/layouts/PaymentLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import type { LedgerPayment } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

function PaymentViewContent() {
  const { id } = useParams<{ id: string }>();

  const { data: payment, isLoading } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

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
              ${parseFloat(payment.amount).toFixed(2)}
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

          <div>
            <label className="text-sm font-medium text-muted-foreground">Ledger EA ID</label>
            <p className="mt-1 font-mono text-sm" data-testid="text-ledger-ea-id">{payment.ledgerEaId}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Date Created</label>
            <p className="mt-1" data-testid="text-date-created">
              {payment.dateCreated ? new Date(payment.dateCreated).toLocaleDateString() : 'N/A'}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Date Received</label>
            <p className="mt-1" data-testid="text-date-received">
              {payment.dateReceived ? new Date(payment.dateReceived).toLocaleDateString() : 'N/A'}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">Date Cleared</label>
            <p className="mt-1" data-testid="text-date-cleared">
              {payment.dateCleared ? new Date(payment.dateCleared).toLocaleDateString() : 'N/A'}
            </p>
          </div>
        </div>

        {payment.memo && (
          <div>
            <label className="text-sm font-medium text-muted-foreground">Memo</label>
            <p className="mt-1 whitespace-pre-wrap" data-testid="text-memo">{payment.memo}</p>
          </div>
        )}

        {payment.details ? (
          <div>
            <label className="text-sm font-medium text-muted-foreground">Details</label>
            <pre className="mt-1 bg-muted p-4 rounded-md overflow-auto text-sm" data-testid="text-details">
              {JSON.stringify(payment.details, null, 2)}
            </pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PaymentView() {
  return (
    <PaymentLayout activeTab="view">
      <PaymentViewContent />
    </PaymentLayout>
  );
}
