import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GatewayConfigOption {
  id: string;
  pluginId: string;
  name: string;
}

interface GatewayBalance {
  label: string;
  amount: number;
  currency: string;
}

interface GatewayConnectionTest {
  connected: boolean;
  account?: {
    id: string;
    email?: string | null;
    country?: string | null;
    defaultCurrency?: string | null;
    type?: string | null;
    capabilities?: { label: string; enabled: boolean }[];
  };
  balances?: GatewayBalance[];
  testMode?: boolean;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

export default function GatewayTestPage() {
  usePageTitle("Payment Gateway Test");

  const {
    data: gateways,
    isLoading: gatewaysLoading,
  } = useQuery<GatewayConfigOption[]>({
    queryKey: ["/api/ledger/payment-gateways"],
  });

  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!selectedId && gateways && gateways.length > 0) {
      setSelectedId(gateways[0].id);
    }
  }, [gateways, selectedId]);

  const { data, isLoading, error, refetch, isFetching } = useQuery<GatewayConnectionTest>({
    queryKey: ["/api/ledger/payment-gateways", selectedId, "test"],
    enabled: !!selectedId,
    retry: false,
  });

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Payment Gateway Connection Test
          </h1>
          <p className="text-muted-foreground mt-2">
            Pick a configured payment gateway and test its connection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedId}
            onValueChange={setSelectedId}
            disabled={gatewaysLoading || !gateways || gateways.length === 0}
          >
            <SelectTrigger className="w-[240px]" data-testid="select-gateway">
              <SelectValue placeholder="Select a gateway" />
            </SelectTrigger>
            <SelectContent>
              {(gateways ?? []).map((gw) => (
                <SelectItem key={gw.id} value={gw.id} data-testid={`option-gateway-${gw.id}`}>
                  {gw.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => refetch()}
            disabled={!selectedId || isFetching}
            data-testid="button-refresh-gateway"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {!gatewaysLoading && (!gateways || gateways.length === 0) && (
        <Alert>
          <XCircle className="h-4 w-4" />
          <AlertDescription data-testid="text-no-gateways">
            No payment gateways are configured. Add one before running a connection test.
          </AlertDescription>
        </Alert>
      )}

      {isLoading && selectedId && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Testing connection...</span>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to connect to the payment gateway. Please check your configuration.
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
              <div className="font-semibold">Successfully connected!</div>
              <div className="mt-1">This gateway is properly configured and accessible.</div>
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Details about the connected gateway account</CardDescription>
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

                {data.account.country && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Country</div>
                    <div className="text-sm mt-1" data-testid="text-account-country">
                      {data.account.country}
                    </div>
                  </div>
                )}

                {data.account.defaultCurrency && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Default Currency</div>
                    <div className="text-sm mt-1 uppercase" data-testid="text-account-currency">
                      {data.account.defaultCurrency}
                    </div>
                  </div>
                )}

                {data.account.type && (
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Account Type</div>
                    <div className="text-sm mt-1 capitalize" data-testid="text-account-type">
                      {data.account.type}
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-sm font-medium text-muted-foreground">Mode</div>
                  <div className="mt-1">
                    <Badge variant={data.testMode ? "secondary" : "default"} data-testid="badge-account-mode">
                      {data.testMode ? "Test Mode" : "Live Mode"}
                    </Badge>
                  </div>
                </div>
              </div>

              {data.account.capabilities && data.account.capabilities.length > 0 && (
                <div className="pt-4 border-t">
                  <div className="text-sm font-medium text-muted-foreground mb-3">Capabilities</div>
                  <div className="flex flex-wrap gap-2">
                    {data.account.capabilities.map((cap) => (
                      <Badge
                        key={cap.label}
                        variant={cap.enabled ? "default" : "secondary"}
                        data-testid={`badge-capability-${cap.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        {cap.enabled ? (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        ) : (
                          <XCircle className="h-3 w-3 mr-1" />
                        )}
                        {cap.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {data.balances && data.balances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Account Balance
                </CardTitle>
                <CardDescription>Balances reported by the gateway account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.balances.map((bal, idx) => (
                  <div
                    key={`${bal.label}-${bal.currency}-${idx}`}
                    className="flex items-center justify-between"
                    data-testid={`row-balance-${bal.label.toLowerCase()}-${bal.currency}`}
                  >
                    <span className="text-sm text-muted-foreground">{bal.label}</span>
                    <span className="text-lg font-semibold">
                      {formatCurrency(bal.amount, bal.currency)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
