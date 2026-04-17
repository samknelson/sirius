import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

function BatchPaymentsContent() {
  const { batch } = usePaymentBatchLayout();

  return (
    <div className="space-y-6">
      <Card data-testid="card-batch-payments">
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <CreditCard className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-payments-stub">
            Payments Coming Soon
          </h3>
          <p className="text-muted-foreground text-center">
            Payment assignments for this batch will be managed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentBatchPaymentsPage() {
  return (
    <PaymentBatchLayout activeTab="payments">
      <BatchPaymentsContent />
    </PaymentBatchLayout>
  );
}
