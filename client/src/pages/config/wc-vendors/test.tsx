import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, RefreshCw, DollarSign, Database, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VendorConfigOption {
  id: string;
  pluginId: string;
  name: string;
  /** The plugin declares a `test-connection` operation. */
  canTest: boolean;
  operations: Array<{
    id: string;
    description: string;
    needsWritableDatabase: boolean;
  }>;
  acceptsPaymentTypes: boolean;
}

interface VendorBalance {
  label: string;
  amount: number;
  currency: string;
}

interface VendorConnectionTest {
  connected: boolean;
  account?: {
    id: string;
    email?: string | null;
    country?: string | null;
    defaultCurrency?: string | null;
    type?: string | null;
    capabilities?: { label: string; enabled: boolean }[];
  };
  balances?: VendorBalance[];
  testMode?: boolean;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

export default function VendorTestPage() {
  usePageTitle("Vendor Connection Test");

  const {
    data: allVendors,
    isLoading: gatewaysLoading,
  } = useQuery<VendorConfigOption[]>({
    queryKey: ["/api/wc-vendors"],
  });

  // Every operation on a vendor plugin is optional, so only offer the vendors
  // that declare `test-connection`. Listing the rest would hand the user a
  // choice whose only outcome is a 501 from the operation lookup.
  const gateways = allVendors?.filter((v) => v.canTest);

  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!selectedId && gateways && gateways.length > 0) {
      setSelectedId(gateways[0].id);
    }
  }, [gateways, selectedId]);

  const { data, isLoading, error, refetch, isFetching } = useQuery<VendorConnectionTest>({
    queryKey: ["/api/wc-vendors", selectedId, "test"],
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
            Vendor Connection Test
          </h1>
          <p className="text-muted-foreground mt-2">
            Pick a configured webclient vendor and test its connection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedId}
            onValueChange={setSelectedId}
            disabled={gatewaysLoading || !gateways || gateways.length === 0}
          >
            <SelectTrigger className="w-[240px]" data-testid="select-gateway">
              <SelectValue placeholder="Select a vendor" />
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
            No webclient vendors are configured. Add one before running a connection test.
          </AlertDescription>
        </Alert>
      )}

      {!gatewaysLoading && allVendors && allVendors.length > 0 && (
        <Card data-testid="card-vendor-capabilities">
          <CardHeader>
            <CardTitle>Vendor capabilities</CardTitle>
            <CardDescription>
              Operations declared by each configured vendor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {allVendors.map((vendor) => (
              <div
                key={vendor.id}
                className="space-y-2 border-b pb-5 last:border-b-0 last:pb-0"
                data-testid={`vendor-capabilities-${vendor.id}`}
              >
                <div className="font-medium">{vendor.name}</div>
                {vendor.operations.length === 0 ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid={`text-no-operations-${vendor.id}`}
                  >
                    No operations declared.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {vendor.operations.map((operation) => (
                      <li
                        key={operation.id}
                        className="flex items-start justify-between gap-3 text-sm"
                        data-testid={`operation-${vendor.id}-${operation.id}`}
                      >
                        <span>{operation.description}</span>
                        <Badge
                          variant={operation.needsWritableDatabase ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          {operation.needsWritableDatabase ? (
                            <Database className="mr-1 h-3 w-3" />
                          ) : (
                            <Eye className="mr-1 h-3 w-3" />
                          )}
                          {operation.needsWritableDatabase ? "Writes data" : "Read-only"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
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
            Failed to connect to the vendor. Please check your configuration.
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

      {data?.connected && (
        <>
          <Alert className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              <div className="font-semibold">Successfully connected!</div>
              <div className="mt-1">This vendor is properly configured and accessible.</div>
            </AlertDescription>
          </Alert>

          {/* Account details are payment-gateway shaped and optional. A vendor
              can report a good connection with no account behind it, and that
              is a success worth showing, not a blank page. */}
          {data.account && (
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Details about the connected vendor account</CardDescription>
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
          )}

          {data.balances && data.balances.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Account Balance
                </CardTitle>
                <CardDescription>Balances reported by the vendor account</CardDescription>
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
