import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { Switch } from "@/components/ui/switch";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface AccountData {
  invoicesEnabled?: boolean;
  invoiceHeader?: string;
  invoiceFooter?: string;
}

function AccountSettingsContent() {
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();

  const accountData = account.data || {};
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
        description: error.message || "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      invoicesEnabled,
      invoiceHeader: invoiceHeader || undefined,
      invoiceFooter: invoiceFooter || undefined,
    });
  };

  const hasChanges = 
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

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => {
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
