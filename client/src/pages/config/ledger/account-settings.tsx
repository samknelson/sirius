import { useState } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useMutation } from "@tanstack/react-query";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import {
  ONLINE_PAYMENT_METHOD_TYPES,
  ONLINE_PAYMENT_PAYER_TYPES,
  onlinePaymentSettingsSchema,
  type OnlinePaymentSettings,
} from "@shared/ledger/online-payments";

interface AccountData extends Partial<OnlinePaymentAccountData> {
  invoicesEnabled?: boolean;
  invoiceHeader?: string;
  invoiceFooter?: string;
}

interface OnlinePaymentAccountData {
  onlinePayments?: OnlinePaymentSettings;
}

function AccountSettingsContent() {
  usePageTitle("Account Settings");
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();

  const accountData = (account.data || {}) as AccountData;
  const onlinePaymentsResult = onlinePaymentSettingsSchema.safeParse(accountData.onlinePayments || {});
  const currentOnlinePayments: OnlinePaymentSettings = onlinePaymentsResult.success
    ? onlinePaymentsResult.data
    : onlinePaymentSettingsSchema.parse({});
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(currentOnlinePayments.enabled);
  const [payerTypes, setPayerTypes] = useState<OnlinePaymentSettings["payerTypes"]>([...currentOnlinePayments.payerTypes]);
  const [allowPartial, setAllowPartial] = useState(currentOnlinePayments.allowPartial);
  const [minAmount, setMinAmount] = useState(String(currentOnlinePayments.minAmount));
  const [paymentTypes, setPaymentTypes] = useState<OnlinePaymentSettings["paymentTypes"]>(
    currentOnlinePayments.paymentTypes || [...ONLINE_PAYMENT_METHOD_TYPES],
  );
  const [invoicesEnabled, setInvoicesEnabled] = useState(accountData.invoicesEnabled !== false);
  const [invoiceHeader, setInvoiceHeader] = useState(accountData.invoiceHeader || "");
  const [invoiceFooter, setInvoiceFooter] = useState(accountData.invoiceFooter || "");

  const updateMutation = useMutation({
    mutationFn: async (data: AccountData) => {
      return await apiRequest("PATCH", `/api/ledger/accounts/${account.id}`, { data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts", account.id] });
      toast({
        title: "Settings saved",
        description: "Account settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to save settings"),
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (onlinePaymentsEnabled && !account.gatewayConfigId) {
      toast({ title: "Payment gateway required", description: "Configure a payment gateway before enabling online checkout.", variant: "destructive" });
      return;
    }
    const parsedOnlinePayments = onlinePaymentSettingsSchema.safeParse({
      enabled: onlinePaymentsEnabled,
      payerTypes,
      allowPartial,
      minAmount: Number(minAmount),
      paymentTypes,
    });
    if (!parsedOnlinePayments.success) {
      toast({
        title: "Invalid online payment settings",
        description: "Enter a minimum amount of at least $1.00 and select a payer and payment method.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      onlinePayments: parsedOnlinePayments.data,
      invoicesEnabled,
      invoiceHeader: invoiceHeader || undefined,
      invoiceFooter: invoiceFooter || undefined,
    });
  };

  const hasChanges = 
    onlinePaymentsEnabled !== currentOnlinePayments.enabled ||
    JSON.stringify(payerTypes) !== JSON.stringify(currentOnlinePayments.payerTypes) ||
    allowPartial !== currentOnlinePayments.allowPartial ||
    minAmount !== String(currentOnlinePayments.minAmount) ||
    JSON.stringify(paymentTypes) !== JSON.stringify(currentOnlinePayments.paymentTypes || ONLINE_PAYMENT_METHOD_TYPES) ||
    invoicesEnabled !== (accountData.invoicesEnabled !== false) ||
    invoiceHeader !== (accountData.invoiceHeader || "") ||
    invoiceFooter !== (accountData.invoiceFooter || "");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invoice Settings</CardTitle>
          <CardDescription>
            Configure header and footer content for invoices related to this account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label className="text-sm font-medium text-foreground">
                Invoices
              </label>
              <p className="text-sm text-muted-foreground">
                Enable or disable invoices for this account.
              </p>
            </div>
            <Switch
              checked={invoicesEnabled}
              onCheckedChange={setInvoicesEnabled}
              data-testid="switch-invoices-enabled"
            />
          </div>

          {invoicesEnabled && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Invoice Header
                </label>
                <p className="text-sm text-muted-foreground">
                  Content to display at the top of invoices for this account.
                </p>
                <SimpleHtmlEditor
                  value={invoiceHeader}
                  onChange={setInvoiceHeader}
                  placeholder="Enter invoice header content..."
                  data-testid="input-invoice-header"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Invoice Footer
                </label>
                <p className="text-sm text-muted-foreground">
                  Content to display at the bottom of invoices for this account.
                </p>
                <SimpleHtmlEditor
                  value={invoiceFooter}
                  onChange={setInvoiceFooter}
                  placeholder="Enter invoice footer content..."
                  data-testid="input-invoice-footer"
                />
              </div>
            </>
          )}

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => {
                setOnlinePaymentsEnabled(currentOnlinePayments.enabled);
                setPayerTypes([...currentOnlinePayments.payerTypes]);
                setAllowPartial(currentOnlinePayments.allowPartial);
                setMinAmount(String(currentOnlinePayments.minAmount));
                setPaymentTypes(currentOnlinePayments.paymentTypes || [...ONLINE_PAYMENT_METHOD_TYPES]);
                setInvoicesEnabled(accountData.invoicesEnabled !== false);
                setInvoiceHeader(accountData.invoiceHeader || "");
                setInvoiceFooter(accountData.invoiceFooter || "");
              }}
              disabled={!hasChanges || updateMutation.isPending}
              data-testid="button-reset"
            >
              Reset
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateMutation.isPending}
              data-testid="button-save"
            >
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Online Payments</CardTitle>
          <CardDescription>
            Configure who may pay this account online and which payment methods are offered.
            Online checkout remains disabled until an administrator explicitly enables it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertTitle>Before enabling online payments</AlertTitle>
            <AlertDescription>
              Confirm that this account has a payment gateway configured, the gateway is ready
              to accept charges and webhooks, and the current payment authorization text is
              configured. Saving these settings does not enable checkout automatically.
            </AlertDescription>
          </Alert>
          {!account.gatewayConfigId && (
            <Alert variant="destructive">
              <AlertTitle>Payment gateway required</AlertTitle>
              <AlertDescription>
                Select a payment gateway for this account before enabling online payments.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="switch-online-payments-enabled">Online checkout</Label>
              <p className="text-sm text-muted-foreground">
                Allow eligible workers and employers to pay balances online.
              </p>
            </div>
            <Switch
              id="switch-online-payments-enabled"
              checked={onlinePaymentsEnabled}
              onCheckedChange={setOnlinePaymentsEnabled}
              data-testid="switch-online-payments-enabled"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Label>Payers</Label>
              {ONLINE_PAYMENT_PAYER_TYPES.map((payer) => (
                <label key={payer} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={payerTypes.includes(payer)}
                    onCheckedChange={(checked) =>
                      setPayerTypes((current) =>
                        checked ? Array.from(new Set([...current, payer])) : current.filter((item) => item !== payer),
                      )
                    }
                    data-testid={`checkbox-online-payer-${payer}`}
                  />
                  {payer === "worker" ? "Workers" : "Employers"}
                </label>
              ))}
            </div>
            <div className="space-y-3">
              <Label>Payment methods</Label>
              {ONLINE_PAYMENT_METHOD_TYPES.map((method) => (
                <label key={method} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={paymentTypes?.includes(method) || false}
                    onCheckedChange={(checked) =>
                      setPaymentTypes((current) => {
                        const methods = current || [];
                        return checked ? Array.from(new Set([...methods, method])) : methods.filter((item) => item !== method);
                      })
                    }
                    data-testid={`checkbox-online-method-${method}`}
                  />
                  {method === "card" ? "Card" : "US bank account (ACH)"}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="switch-online-allow-partial">Allow partial payments</Label>
              <Switch
                id="switch-online-allow-partial"
                checked={allowPartial}
                onCheckedChange={setAllowPartial}
                data-testid="switch-online-allow-partial"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="input-online-min-amount">Minimum payment amount</Label>
              <Input
                id="input-online-min-amount"
                type="number"
                min="1"
                step="0.01"
                value={minAmount}
                onChange={(event) => setMinAmount(event.target.value)}
                data-testid="input-online-min-amount"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AccountSettingsPage() {
  return (
    <LedgerAccountLayout activeTab="settings">
      <AccountSettingsContent />
    </LedgerAccountLayout>
  );
}
