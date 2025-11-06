import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";

interface StripeCustomer {
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    created: number;
    currency: string | null;
    balance: number;
    delinquent: boolean;
  };
  stripeUrl: string;
}

function StripeCustomerContent() {
  const { employer } = useEmployerLayout();

  const { data, isLoading, error } = useQuery<StripeCustomer>({
    queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'customer'],
    enabled: !!employer.id,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stripe Customer</CardTitle>
          <CardDescription>Loading customer information...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stripe Customer</CardTitle>
          <CardDescription>Error loading customer information</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load Stripe customer information. Please try again later.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const { customer, stripeUrl } = data;
  const createdDate = new Date(customer.created * 1000);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Stripe Customer</CardTitle>
            <CardDescription>View and manage Stripe customer details</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
            data-testid="button-view-in-stripe"
          >
            <a href={stripeUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              View in Stripe
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Customer ID</label>
            <p className="text-foreground font-mono text-sm" data-testid="text-customer-id">
              {customer.id}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Customer Name</label>
            <p className="text-foreground" data-testid="text-customer-name">
              {customer.name || '—'}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Email</label>
            <p className="text-foreground" data-testid="text-customer-email">
              {customer.email || '—'}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Created</label>
            <p className="text-foreground" data-testid="text-customer-created">
              {createdDate.toLocaleDateString()}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Currency</label>
            <p className="text-foreground uppercase" data-testid="text-customer-currency">
              {customer.currency || '—'}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Balance</label>
            <p className="text-foreground" data-testid="text-customer-balance">
              {customer.balance !== null ? (customer.balance / 100).toFixed(2) : '—'}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Status</label>
            <p className="text-foreground" data-testid="text-customer-status">
              {customer.delinquent ? (
                <span className="text-destructive font-medium">Delinquent</span>
              ) : (
                <span className="text-green-600 dark:text-green-400 font-medium">Good Standing</span>
              )}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StripeCustomerPage() {
  return (
    <EmployerLayout activeTab="customer">
      <StripeCustomerContent />
    </EmployerLayout>
  );
}
