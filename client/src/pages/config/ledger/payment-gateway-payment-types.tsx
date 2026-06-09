import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, Info, Save, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
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

interface PaymentTypeOption {
  id: string;
  name: string;
  description?: string;
}

interface PaymentTypesResponse {
  available: PaymentTypeOption[];
  selected: string[];
}

export default function PaymentGatewayPaymentTypesPage() {
  usePageTitle("Payment Types");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: gateways, isLoading: gatewaysLoading } = useQuery<GatewayConfigOption[]>({
    queryKey: ["/api/ledger/payment-gateways"],
  });

  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!selectedId && gateways && gateways.length > 0) {
      setSelectedId(gateways[0].id);
    }
  }, [gateways, selectedId]);

  const { data, isLoading, isFetching } = useQuery<PaymentTypesResponse>({
    queryKey: ["/api/ledger/payment-gateways", selectedId, "payment-types"],
    enabled: !!selectedId,
  });

  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const loadedFor = useRef<string | null>(null);

  // Clear the checkbox state the instant the gateway changes so stale selections
  // from the previous config can never be saved into the new one before its own
  // data loads.
  useEffect(() => {
    if (loadedFor.current !== selectedId) {
      setSelectedTypes([]);
    }
  }, [selectedId]);

  // Seed the checkbox state once the selected config's own data arrives.
  useEffect(() => {
    if (data && loadedFor.current !== selectedId) {
      setSelectedTypes(data.selected);
      loadedFor.current = selectedId;
    }
  }, [data, selectedId]);

  // True until this gateway's own data has loaded into the checkboxes.
  const isHydrated = loadedFor.current === selectedId && !isFetching;

  const updateMutation = useMutation({
    mutationFn: async (paymentTypes: string[]) => {
      return apiRequest(
        "PUT",
        `/api/ledger/payment-gateways/${selectedId}/payment-types`,
        { paymentTypes },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/ledger/payment-gateways", selectedId, "payment-types"],
      });
      toast({
        title: "Payment Types Updated",
        description: "Accepted payment types have been saved for this gateway.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update payment types.",
        variant: "destructive",
      });
    },
  });

  const handleToggle = (typeId: string, checked: boolean) => {
    setSelectedTypes((prev) =>
      checked ? [...prev, typeId] : prev.filter((t) => t !== typeId),
    );
  };

  const handleSave = () => {
    if (selectedTypes.length === 0) {
      toast({
        title: "Selection Required",
        description: "Please select at least one payment type.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(selectedTypes);
  };

  const available = data?.available ?? [];
  const hasChanges =
    isHydrated &&
    JSON.stringify([...selectedTypes].sort()) !==
      JSON.stringify([...(data?.selected ?? [])].sort());

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
            Payment Types
          </h1>
          <p className="text-muted-foreground mt-2">
            Choose which payment types each gateway configuration accepts.
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
            onClick={handleSave}
            disabled={!selectedId || !isHydrated || !hasChanges || updateMutation.isPending}
            data-testid="button-save-payment-types"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      {!gatewaysLoading && (!gateways || gateways.length === 0) && (
        <Alert>
          <XCircle className="h-4 w-4" />
          <AlertDescription data-testid="text-no-gateways">
            No payment gateways are configured. Add one before editing payment types.
          </AlertDescription>
        </Alert>
      )}

      {selectedId && (
        <>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Not all payment types are available in every country or for every account.
              Some may require additional setup in the provider's dashboard.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <CreditCard className="h-5 w-5 mr-2" />
                Available Payment Types
              </CardTitle>
              <CardDescription>
                Select the payment types this gateway configuration should accept.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground py-4" data-testid="text-loading">
                  Loading...
                </p>
              ) : available.length === 0 ? (
                <p className="text-muted-foreground py-4" data-testid="text-no-types">
                  This provider does not declare any selectable payment types.
                </p>
              ) : (
                <div className="space-y-4">
                  {available.map((type) => (
                    <div
                      key={type.id}
                      className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
                    >
                      <Checkbox
                        id={type.id}
                        checked={selectedTypes.includes(type.id)}
                        onCheckedChange={(checked) => handleToggle(type.id, checked as boolean)}
                        data-testid={`checkbox-payment-type-${type.id}`}
                      />
                      <div className="flex-1">
                        <Label htmlFor={type.id} className="font-medium cursor-pointer">
                          {type.name}
                        </Label>
                        {type.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {type.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {hasChanges && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                You have unsaved changes. Click "Save Changes" to apply your selections.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
