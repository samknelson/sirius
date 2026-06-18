import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";

const ENTITY_TYPE = "employer";
const PM_BASE = "/api/ledger/payment-methods";

interface GatewayOption {
  id: string;
  pluginId: string;
  name: string;
}

interface GatewayCustomer {
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    created: number | null;
    currency: string | null;
    balance: number | null;
    delinquent: boolean | null;
  };
  providerUrl?: string;
}

function CustomerContent() {
  const { employer } = useEmployerLayout();
  const entityId = employer.id;

  const { data: gateways, isLoading: gatewaysLoading } = useQuery<GatewayOption[]>({
    queryKey: [PM_BASE, ENTITY_TYPE, entityId, "gateways"],
    enabled: !!entityId,
  });

  const [selectedGatewayId, setSelectedGatewayId] = useState<string>("");

  useEffect(() => {
    if (!selectedGatewayId && gateways && gateways.length > 0) {
      setSelectedGatewayId(gateways[0].id);
    }
  }, [gateways, selectedGatewayId]);

  const { data, isLoading, error } = useQuery<GatewayCustomer>({
    queryKey: [PM_BASE, ENTITY_TYPE, entityId, "customer", selectedGatewayId],
    enabled: !!entityId && !!selectedGatewayId,
  });

  const hasGateways = !!gateways && gateways.length > 0;
  const showPicker = hasGateways && gateways!.length > 1;

  if (gatewaysLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
          <CardDescription>Loading payment gateways...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!hasGateways) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
          <CardDescription>No payment gateway is configured</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription data-testid="text-no-gateways">
              No enabled payment gateway is available for this employer.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Customer</CardTitle>
            <CardDescription>View the payment gateway customer for this employer</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {showPicker && (
              <Select value={selectedGatewayId} onValueChange={setSelectedGatewayId}>
                <SelectTrigger className="w-[200px]" data-testid="select-gateway">
                  <SelectValue placeholder="Select a gateway" />
                </SelectTrigger>
                <SelectContent>
                  {gateways!.map((g) => (
                    <SelectItem key={g.id} value={g.id} data-testid={`option-gateway-${g.id}`}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {data?.providerUrl && (
              <Button variant="outline" size="sm" asChild data-testid="button-view-in-provider">
                <a href={data.providerUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View in Provider
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription data-testid="text-customer-error">
              {error instanceof Error ? error.message : "Failed to load customer information."}
            </AlertDescription>
          </Alert>
        ) : !data ? null : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Customer ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-customer-id">
                {data.customer.id}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Customer Name</label>
              <p className="text-foreground" data-testid="text-customer-name">
                {data.customer.name || "—"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <p className="text-foreground" data-testid="text-customer-email">
                {data.customer.email || "—"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Created</label>
              <p className="text-foreground" data-testid="text-customer-created">
                {data.customer.created
                  ? new Date(data.customer.created * 1000).toLocaleDateString()
                  : "—"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Currency</label>
              <p className="text-foreground uppercase" data-testid="text-customer-currency">
                {data.customer.currency || "—"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Balance</label>
              <p className="text-foreground" data-testid="text-customer-balance">
                {data.customer.balance !== null && data.customer.balance !== undefined
                  ? (data.customer.balance / 100).toFixed(2)
                  : "—"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <p className="text-foreground" data-testid="text-customer-status">
                {data.customer.delinquent ? (
                  <span className="text-destructive font-medium">Delinquent</span>
                ) : (
                  <span className="text-green-600 dark:text-green-400 font-medium">Good Standing</span>
                )}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CustomerPage() {
  return (
    <EmployerLayout activeTab="customer">
      <CustomerContent />
    </EmployerLayout>
  );
}
