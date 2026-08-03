import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save, X } from "lucide-react";
import TrustProviderLayout, { useTrustProviderLayout } from "@/components/layouts/TrustProviderLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";

const NO_ACCOUNT = "__none__";

interface AccountOption {
  id: string;
  name: string;
}

function TrustProviderEditContent() {
  const { id } = useParams<{ id: string }>();
  const { provider } = useTrustProviderLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editName, setEditName] = useState(provider?.name || "");
  const linkedAccountId =
    (provider?.data as { ledgerAccountId?: string } | null)?.ledgerAccountId ?? "";
  const [editAccountId, setEditAccountId] = useState<string>(
    linkedAccountId || NO_ACCOUNT,
  );

  const { data: accounts = [] } = useQuery<AccountOption[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; accountId: string | null }) => {
      await apiRequest("PATCH", `/api/trust/provider/${id}/ledger-account`, {
        name: data.name,
        accountId: data.accountId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trust/provider", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust/providers"] });
      toast({
        title: "Success",
        description: "Trust provider updated successfully!",
      });
      setLocation(`/trust/provider/${id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to update trust provider."),
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!editName.trim()) {
      toast({
        title: "Validation Error",
        description: "Provider name is required.",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      name: editName.trim(),
      accountId: editAccountId === NO_ACCOUNT ? null : editAccountId,
    });
  };

  const handleCancel = () => {
    setLocation(`/trust/provider/${id}`);
  };

  if (!provider) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Provider</CardTitle>
        <CardDescription>Update trust provider information</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Basic Information</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Provider ID</label>
                <p className="text-sm text-muted-foreground mt-1" data-testid="text-provider-id">
                  {provider.id}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                  data-testid="input-edit-name"
                  placeholder="Enter provider name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Ledger Account</label>
                <Select value={editAccountId} onValueChange={setEditAccountId}>
                  <SelectTrigger className="mt-1" data-testid="select-ledger-account">
                    <SelectValue placeholder="Select a ledger account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>None</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Premium files generated for this provider will post to this account.
                </p>
              </div>
            </div>
          </div>

          {!!provider.data && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Additional Data</h3>
              <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-provider-data">
                {JSON.stringify(provider.data, null, 2) as string}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                Note: Additional data cannot be edited from this interface.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={updateMutation.isPending}
              data-testid="button-cancel"
            >
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              data-testid="button-save"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TrustProviderEditPage() {
  return (
    <TrustProviderLayout activeTab="edit">
      <TrustProviderEditContent />
    </TrustProviderLayout>
  );
}
