import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

function EAPaymentsContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>Manage payments for this account entry</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground" data-testid="text-coming-soon">
            Payment management coming soon
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EAPayments() {
  return (
    <EALayout activeTab="payments">
      <EAPaymentsContent />
    </EALayout>
  );
}
