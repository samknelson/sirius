import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save } from "lucide-react";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";

function AccountEditContent() {
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(account.name);
  const [editDescription, setEditDescription] = useState(account.description || "");
  const [editIsActive, setEditIsActive] = useState(account.isActive);

  const updateAccountMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; isActive: boolean }) => {
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
        isActive: editIsActive 
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
