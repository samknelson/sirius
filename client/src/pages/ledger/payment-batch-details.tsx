import { useQuery } from "@tanstack/react-query";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LedgerAccount } from "@shared/schema";

function BatchDetailsContent() {
  const { batch } = usePaymentBatchLayout();

  const { data: account } = useQuery<LedgerAccount>({
    queryKey: ["/api/ledger/accounts", batch.accountId],
    enabled: !!batch.accountId,
  });

  return (
    <div className="space-y-6">
      <Card data-testid="card-batch-details">
        <CardHeader>
          <CardTitle>Batch Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-batch-name">{batch.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Account</dt>
              <dd className="mt-1 text-sm" data-testid="text-batch-account">
                {account ? account.name : <span className="text-muted-foreground italic">Loading...</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Batch ID</dt>
              <dd className="mt-1 text-sm font-mono text-muted-foreground" data-testid="text-batch-id">{batch.id}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentBatchDetailsPage() {
  return (
    <PaymentBatchLayout activeTab="details">
      <BatchDetailsContent />
    </PaymentBatchLayout>
  );
}
