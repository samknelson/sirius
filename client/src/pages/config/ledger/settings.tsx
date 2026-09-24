import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
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
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseVariableJson, useSetVariable, useVariableValue } from "@/lib/use-variable";
import {
  ONLINE_PAYMENT_AUTHORIZATION_VARIABLE,
  onlinePaymentAuthorizationTextsSchema,
  type OnlinePaymentAuthorizationTexts,
} from "@shared/ledger/online-payments";

const emptyAuthorization: OnlinePaymentAuthorizationTexts = {
  consumer: { version: "", text: "" },
  business: { version: "", text: "" },
};

function PaymentAuthorizationEditor() {
  const { toast } = useToast();
  const variable = useVariableValue(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE);
  const stored = variable.data === null ? null
    : onlinePaymentAuthorizationTextsSchema.safeParse(parseVariableJson(variable.data));
  const current = stored && stored.success ? stored.data : null;
  const [draft, setDraft] = useState<OnlinePaymentAuthorizationTexts>(emptyAuthorization);

  useEffect(() => {
    if (variable.data === null) setDraft(emptyAuthorization);
    else if (current) setDraft(current);
  }, [variable.data]);

  const save = useSetVariable(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE, {
    onSuccess: () => toast({
      title: "Payment authorization saved",
      description: "The shared consumer and business authorization configuration was updated.",
    }),
    onError: (error) => toast({
      title: "Unable to save payment authorization",
      description: getApiErrorMessage(error, "The authorization configuration was not changed."),
      variant: "destructive",
    }),
  });
  const validation = onlinePaymentAuthorizationTextsSchema.safeParse(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(current ?? emptyAuthorization);
  const canEdit = !variable.isLoading && !variable.isError && (variable.data === null || !!current);

  function update(payer: "consumer" | "business", field: "version" | "text", value: string) {
    setDraft((previous) => ({
      ...previous,
      [payer]: { ...previous[payer], [field]: value },
    }));
  }

  return (
    <Card id="payment-authorization" data-testid="payment-authorization-editor">
      <CardHeader>
        <CardTitle>Online payment authorization</CardTitle>
        <CardDescription>
          Shared across all ledger accounts and both worker and employer checkout. Enter only
          approved authorization language and its corresponding version for each payer type.
          Changes affect future consents; existing consent snapshots retain the wording accepted at payment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {variable.isLoading ? (
          <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading authorization configuration…</p>
        ) : variable.isError ? (
          <Alert variant="destructive" data-testid="authorization-load-error">
            <AlertTitle>Unable to load authorization configuration</AlertTitle>
            <AlertDescription>
              {getApiErrorMessage(variable.error, "Check your access or retry the request.")}
              <Button variant="outline" size="sm" className="ml-3" onClick={() => variable.refetch()}>Retry</Button>
            </AlertDescription>
          </Alert>
        ) : variable.data !== null && !current ? (
          <Alert variant="destructive">
            <AlertTitle>Stored authorization needs review</AlertTitle>
            <AlertDescription>The stored configuration does not match the required consumer and business format. No changes can be saved here until the existing value is reviewed; it has not been replaced.</AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert variant={current ? "default" : "destructive"} data-testid="authorization-readiness">
              <AlertTitle>{current ? "Authorization configured" : "Authorization not configured"}</AlertTitle>
              <AlertDescription>
                {current
                  ? `Consumer version ${current.consumer.version} and business version ${current.business.version} are available for checkout.`
                  : "Checkout cannot collect payment authorization until an administrator enters approved consumer and business text with versions. No legal wording is supplied automatically."}
              </AlertDescription>
            </Alert>
            {(["consumer", "business"] as const).map((payer) => (
              <fieldset key={payer} className="space-y-3 rounded-md border p-4">
                <legend className="px-1 font-semibold capitalize">{payer} authorization</legend>
                <div className="space-y-2">
                  <Label htmlFor={`${payer}-authorization-version`}>Version</Label>
                  <Input
                    id={`${payer}-authorization-version`}
                    data-testid={`${payer}-authorization-version`}
                    value={draft[payer].version}
                    onChange={(event) => update(payer, "version", event.target.value)}
                    disabled={!canEdit || save.isPending}
                    aria-required="true"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${payer}-authorization-text`}>Approved authorization text</Label>
                  <Textarea
                    id={`${payer}-authorization-text`}
                    data-testid={`${payer}-authorization-text`}
                    rows={6}
                    value={draft[payer].text}
                    onChange={(event) => update(payer, "text", event.target.value)}
                    disabled={!canEdit || save.isPending}
                    aria-required="true"
                  />
                </div>
              </fieldset>
            ))}
            {!validation.success && changed && (
              <p role="alert" className="text-sm text-destructive">
                Consumer and business versions and authorization text are all required. Blank or whitespace-only values cannot be saved.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!changed || save.isPending} onClick={() => setDraft(current ?? emptyAuthorization)}>
                Reset
              </Button>
              <Button
                data-testid="save-payment-authorization"
                disabled={!canEdit || !changed || !validation.success || save.isPending}
                onClick={() => { if (validation.success) save.mutate(validation.data); }}
              >
                {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save authorization
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface LedgerPaymentType {
  id: string;
  name: string;
  description: string | null;
  sequence: number;
}

export default function LedgerSettingsPage() {
  usePageTitle("Ledger Settings");
  const { toast } = useToast();
  const [selectedPaymentTypeId, setSelectedPaymentTypeId] = useState<string>("");

  // Share the canonical ledger payment-type cache with other ledger screens.
  const paymentTypeQuery = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });
  const paymentTypes = paymentTypeQuery.data ?? [];

  // Fetch current setting
  const { data: currentSetting, isLoading: isLoadingSettings } = useQuery<{ id: string; value: { paymentTypeId: string } | null } | null>({
    queryKey: ["/api/variables/by-name/ledger_payment_type"],
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
        const variableId = currentSetting.id || "ledger_payment_type";
        return apiRequest("PUT", `/api/variables/${variableId}`, {
          value: { paymentTypeId },
        });
      } else {
        // Create new variable
        return apiRequest("POST", "/api/variables", {
          name: "ledger_payment_type",
          value: { paymentTypeId },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name/ledger_payment_type"] });
      toast({
        title: "Success",
        description: "Default payment type saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to save setting."),
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

  if (paymentTypeQuery.isLoading || isLoadingSettings) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold mb-6" data-testid="heading-ledger-settings">
        Ledger Settings
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Default Payment Type</CardTitle>
          <CardDescription>
            Select the default payment type to use for ledger payment transactions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {paymentTypeQuery.isError && (
            <Alert variant="destructive" data-testid="payment-types-load-error">
              <AlertTitle>Unable to load payment types</AlertTitle>
              <AlertDescription>
                {getApiErrorMessage(paymentTypeQuery.error, "Check your access or try again.")}
                <Button variant="outline" size="sm" className="ml-3" onClick={() => paymentTypeQuery.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="payment-type">Payment Type</Label>
            <Select
              value={selectedPaymentTypeId}
              onValueChange={setSelectedPaymentTypeId}
              disabled={!paymentTypeQuery.isSuccess || paymentTypes.length === 0}
            >
              <SelectTrigger id="payment-type" data-testid="select-payment-type">
                <SelectValue placeholder="Select a payment type" />
              </SelectTrigger>
              <SelectContent>
                {paymentTypeQuery.isSuccess && paymentTypes.length === 0 ? (
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
            {paymentTypeQuery.isSuccess && paymentTypes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No payment types configured. Please add payment types first.
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !paymentTypeQuery.isSuccess || !paymentTypes.some((type) => type.id === selectedPaymentTypeId)}
              data-testid="button-save-settings"
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
      <PaymentAuthorizationEditor />
    </div>
  );
}
