import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StripeBalance {
  currency: string;
  amount: number;
}

interface StripeTestResponse {
  connected: boolean;
  account?: {
    id: string;
    email: string | null;
    country: string;
    defaultCurrency: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    type: string;
  };
  balance?: {
    available: StripeBalance[];
    pending: StripeBalance[];
  };
  testMode?: boolean;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

export default function StripeTestPage() {
  usePageTitle("Stripe Test");
  const { data, isLoading, error, refetch, isFetching } = useQuery<StripeTestResponse>({
    queryKey: ["/api/ledger/stripe/test"],
    retry: false,
  });

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Stripe Connection Test
          </h1>
          <p className="text-muted-foreground mt-2">
            Test your Stripe API connection and view account details
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-stripe"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Testing Stripe connection...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to connect to Stripe API. Please check your configuration.
          </AlertDescription>
        </Alert>
      )}

      {data && !data.connected && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            <div className="font-semibold">Connection Failed</div>
            <div className="mt-2">{data.error?.message}</div>
            {data.error?.type && (
              <div className="mt-1 text-sm opacity-80">
                Type: {data.error.type}
                {data.error.code && ` | Code: ${data.error.code}`}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {data?.connected && data.account && (
        <>
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <div className="font-semibold">Successfully connected to Stripe!</div>
              <div className="mt-1">Your Stripe account is properly configured and accessible.</div>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Details about your connected Stripe account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Account ID</div>
                  <div className="text-sm font-mono mt-1" data-testid="text-account-id">
                    {data.account.id}
                  </div>
                </div>

                {data.account.email && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Email</div>
                    <div className="text-sm mt-1" data-testid="text-account-email">
                      {data.account.email}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium text-muted-foreground">Country</div>
                  <div className="text-sm mt-1" data-testid="text-account-country">
                    {data.account.country}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">Default Currency</div>
                  <div className="text-sm mt-1 uppercase" data-testid="text-account-currency">
                    {data.account.defaultCurrency}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">Account Type</div>
                  <div className="text-sm mt-1 capitalize" data-testid="text-account-type">
                    {data.account.type}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground">Mode</div>
                  <div className="mt-1">
                    <Badge variant={data.testMode ? "secondary" : "default"} data-testid="badge-account-mode">
                      {data.testMode ? "Test Mode" : "Live Mode"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="text-sm font-medium text-muted-foreground mb-3">Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={data.account.chargesEnabled ? "default" : "secondary"}
                    data-testid="badge-charges-enabled"
                  >
                    {data.account.chargesEnabled ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    Charges {data.account.chargesEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge
                    variant={data.account.payoutsEnabled ? "default" : "secondary"}
                    data-testid="badge-payouts-enabled"
                  >
                    {data.account.payoutsEnabled ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    Payouts {data.account.payoutsEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                  <Badge
                    variant={data.account.detailsSubmitted ? "default" : "secondary"}
                    data-testid="badge-details-submitted"
                  >
                    {data.account.detailsSubmitted ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
                    Details {data.account.detailsSubmitted ? "Submitted" : "Pending"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {data.balance && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Account Balance
                </CardTitle>
                <CardDescription>Available and pending balances in your Stripe account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Available Balance</div>
                  {data.balance.available.length > 0 ? (
                    <div className="space-y-1">
                      {data.balance.available.map((bal, idx) => (
                        <div key={idx} className="text-lg font-semibold" data-testid={`text-balance-available-${bal.currency}`}>
                          {formatCurrency(bal.amount, bal.currency)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No available balance</div>
                  )}
                </div>

                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Pending Balance</div>
                  {data.balance.pending.length > 0 ? (
                    <div className="space-y-1">
                      {data.balance.pending.map((bal, idx) => (
                        <div key={idx} className="text-lg" data-testid={`text-balance-pending-${bal.currency}`}>
                          {formatCurrency(bal.amount, bal.currency)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">No pending balance</div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
