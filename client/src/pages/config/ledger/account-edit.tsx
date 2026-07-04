import { useState } from "react";
import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save } from "lucide-react";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";
import { pluginSearch, pluginConfigsQueryKey } from "@/plugins/_core/manifest";

const NO_GATEWAY = "none";

interface PaymentGatewayConfig {
  id: string;
  name: string;
}

function AccountEditContent() {
  usePageTitle("Edit Account");
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(account.name);
  const [editDescription, setEditDescription] = useState(account.description || "");
  const [editIsActive, setEditIsActive] = useState(account.isActive);
  const [editGatewayConfigId, setEditGatewayConfigId] = useState(
    account.gatewayConfigId ?? NO_GATEWAY
  );

  const { data: gatewayConfigs = [], isLoading: gatewaysLoading } = useQuery<PaymentGatewayConfig[]>({
    queryKey: [...pluginConfigsQueryKey("payment-gateway"), "search"],
    queryFn: () => pluginSearch<"payment-gateway", PaymentGatewayConfig>("payment-gateway"),
  });

  const updateAccountMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      isActive: boolean;
      gatewayConfigId: string | null;
    }) => {
      return await apiRequest("PUT", `/api/ledger/accounts/${account.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts", account.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts"] });
      toast({
        title: "Success",
        description: "Account updated successfully!",
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update account. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (editName.trim()) {
      updateAccountMutation.mutate({ 
        name: editName.trim(), 
        description: editDescription.trim() || undefined,
        isActive: editIsActive,
        gatewayConfigId: editGatewayConfigId === NO_GATEWAY ? null : editGatewayConfigId,
      });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Account</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-account-name" className="text-sm font-medium text-foreground">
                Account Name
              </Label>
              <Input
                id="edit-account-name"
                type="text"
                placeholder="Enter account name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-account-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                Currency
              </Label>
              <div>
                <Badge variant="outline" data-testid="text-account-currency">
                  {account.currencyCode}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  Currency cannot be changed after account creation
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-account-description" className="text-sm font-medium text-foreground">
                Description (Optional)
              </Label>
              <Textarea
                id="edit-account-description"
                placeholder="Enter account description..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full min-h-[100px]"
                data-testid="input-edit-account-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-account-gateway" className="text-sm font-medium text-foreground">
                Payment Gateway
              </Label>
              <Select
                value={editGatewayConfigId}
                onValueChange={setEditGatewayConfigId}
                disabled={gatewaysLoading}
              >
                <SelectTrigger
                  id="edit-account-gateway"
                  className="w-full"
                  data-testid="select-account-gateway"
                >
                  <SelectValue
                    placeholder={gatewaysLoading ? "Loading gateways..." : "Select a payment gateway"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GATEWAY} data-testid="select-gateway-option-none">
                    None
                  </SelectItem>
                  {gatewayConfigs.map((gateway) => (
                    <SelectItem
                      key={gateway.id}
                      value={gateway.id}
                      data-testid={`select-gateway-option-${gateway.id}`}
                    >
                      {gateway.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose which payment gateway processes payments for this account.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-account-active"
                checked={editIsActive}
                onCheckedChange={(checked) => setEditIsActive(checked === true)}
                data-testid="checkbox-edit-account-active"
              />
              <Label
                htmlFor="edit-account-active"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Active
              </Label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Button
              onClick={handleSaveEdit}
              disabled={updateAccountMutation.isPending || !editName.trim()}
              data-testid="button-save-account"
            >
              <Save className="mr-2" size={16} />
              {updateAccountMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Link href="/ledger/accounts">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LedgerAccountEdit() {
  return (
    <LedgerAccountLayout activeTab="edit">
      <AccountEditContent />
    </LedgerAccountLayout>
  );
}
