import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployerLayout } from "@/components/layouts/EmployerLayout";
import { Clock } from "lucide-react";

function PaymentMethodsContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Methods</CardTitle>
        <CardDescription>Manage customer payment methods</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
          <Clock className="text-muted-foreground" size={32} />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">Coming Soon</h3>
        <p className="text-muted-foreground text-center max-w-md" data-testid="text-coming-soon">
          Payment methods management is currently under development. 
          This feature will allow you to view and manage saved payment methods for this customer.
        </p>
      </CardContent>
    </Card>
  );
}

export default function StripePaymentMethodsPage() {
  return (
    <EmployerLayout activeTab="accounting-payment-methods">
      <PaymentMethodsContent />
    </EmployerLayout>
  );
}
