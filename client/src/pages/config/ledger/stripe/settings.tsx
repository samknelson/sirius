import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Save } from "lucide-react";
import { useState, useEffect } from "react";

interface LedgerPaymentType {
  id: string;
  name: string;
  description: string | null;
  sequence: number;
}

export default function StripeSettingsPage() {
  const { toast } = useToast();
  const [selectedPaymentTypeId, setSelectedPaymentTypeId] = useState<string>("");

  // Fetch all ledger payment types
  const { data: paymentTypes = [], isLoading: isLoadingPaymentTypes } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger-payment-types"],
  });

  // Fetch current setting
  const { data: currentSetting, isLoading: isLoadingSettings } = useQuery<{ id: string; value: { paymentTypeId: string } | null } | null>({
    queryKey: ["/api/variables/by-name/ledger_stripe_payment_type"],
  });

  // Update selected value when currentSetting loads
  useEffect(() => {
    if (currentSetting?.value?.paymentTypeId) {
      setSelectedPaymentTypeId(currentSetting.value.paymentTypeId);
    }
  }, [currentSetting]);

  const saveMutation = useMutation({
    mutationFn: async (paymentTypeId: string) => {
      // Check if variable already exists
      if (currentSetting) {
        // Update existing variable
        const variableId = currentSetting.id || "ledger_stripe_payment_type";
        return apiRequest("PUT", `/api/variables/${variableId}`, {
          value: { paymentTypeId },
        });
      } else {
        // Create new variable
        return apiRequest("POST", "/api/variables", {
          name: "ledger_stripe_payment_type",
          value: { paymentTypeId },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name/ledger_stripe_payment_type"] });
      toast({
        title: "Success",
        description: "Default payment type saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save setting.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!selectedPaymentTypeId) {
      toast({
        title: "Validation Error",
        description: "Please select a payment type.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(selectedPaymentTypeId);
  };

  if (isLoadingPaymentTypes || isLoadingSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6" data-testid="heading-stripe-settings">
        Stripe Settings
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Default Payment Type</CardTitle>
          <CardDescription>
            Select the default payment type to use for Stripe transactions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="payment-type">Payment Type</Label>
            <Select
              value={selectedPaymentTypeId}
              onValueChange={setSelectedPaymentTypeId}
            >
              <SelectTrigger id="payment-type" data-testid="select-payment-type">
                <SelectValue placeholder="Select a payment type" />
              </SelectTrigger>
              <SelectContent>
                {paymentTypes.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No payment types available
                  </SelectItem>
                ) : (
                  paymentTypes.map((type) => (
                    <SelectItem 
                      key={type.id} 
                      value={type.id}
                      data-testid={`option-payment-type-${type.id}`}
                    >
                      {type.name}
                      {type.description && (
                        <span className="text-xs text-muted-foreground ml-2">
                          - {type.description}
                        </span>
                      )}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {paymentTypes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No payment types configured. Please add payment types first.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !selectedPaymentTypeId}
              data-testid="button-save-settings"
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
