import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DollarSign, Info, CheckCircle2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ConfigureStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface LedgerAccount {
  id: string;
  name: string;
  description?: string;
  currencyCode: string;
  isActive: boolean;
}

export function ConfigureStep({ wizardId, wizardType, data, onDataChange }: ConfigureStepProps) {
  const { toast } = useToast();
  
  const [accountId, setAccountId] = useState<string>(data?.accountId || "");
  const [isSaving, setIsSaving] = useState(false);

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const activeAccounts = accounts.filter(a => a.isActive);

  useEffect(() => {
    if (data?.accountId) {
      setAccountId(data.accountId);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (config: { accountId: string }) => {
      return await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          accountId: config.accountId,
          progress: {
            configure: {
              status: "completed",
              completedAt: new Date().toISOString(),
            },
          },
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Configuration Saved",
        description: "Ledger account has been selected.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync({ accountId });
    } finally {
      setIsSaving(false);
    }
  };

  const isConfigComplete = !!data?.accountId;
  const selectedAccount = accounts.find(a => a.id === data?.accountId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Dues Allocation Configuration
          </CardTitle>
          <CardDescription>
            Select the ledger account for dues allocation entries
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="accountId">Ledger Account</Label>
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={accountsLoading}
              >
                <SelectTrigger data-testid="select-ledger-account">
                  <SelectValue placeholder="Select a ledger account" />
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.currencyCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Dues deductions will be allocated to this ledger account. Make sure the BTU Dues Allocation charge plugin is configured for this account.
              </p>
            </div>
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>About Dues Allocation</AlertTitle>
            <AlertDescription>
              Each row in the import file will create a ledger entry for the corresponding worker.
              Workers are matched by their BPS Employee ID. The transaction date will be taken from the file.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSave}
              disabled={isSaving || !accountId}
              data-testid="button-save-config"
            >
              {isSaving ? "Saving..." : "Save Configuration"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isConfigComplete && selectedAccount && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-lg">Configuration saved successfully</span>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              <p>Ledger Account: <strong>{selectedAccount.name}</strong></p>
              <p>Currency: <strong>{selectedAccount.currencyCode}</strong></p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
