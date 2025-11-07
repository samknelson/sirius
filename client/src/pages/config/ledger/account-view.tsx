import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Trash2, Loader2 } from "lucide-react";
import { LedgerAccountLayout, useLedgerAccountLayout } from "@/components/layouts/LedgerAccountLayout";

function AccountDetailsContent() {
  const { account } = useLedgerAccountLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/ledger/accounts/${account.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts"] });
      toast({
        title: "Success",
        description: "Ledger account deleted successfully.",
      });
      setLocation("/config/ledger/accounts");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete ledger account.",
        variant: "destructive",
      });
      setShowDeleteDialog(false);
    },
  });

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Account Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Account Name</label>
              <p className="text-foreground" data-testid="text-account-name-field">
                {account.name}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Account ID</label>
              <p className="text-foreground font-mono text-sm" data-testid="text-account-id">
                {account.id}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div>
                <Badge 
                  variant={account.isActive ? "default" : "secondary"}
                  data-testid="badge-account-status"
                >
                  {account.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </div>
            {account.description && (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <p className="text-foreground" data-testid="text-account-description">
                  {account.description}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center justify-between">
            <Link href="/config/ledger/accounts">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
            <Button 
              variant="destructive" 
              onClick={() => setShowDeleteDialog(true)}
              data-testid="button-delete-account"
            >
              <Trash2 className="mr-2" size={16} />
              Delete Account
            </Button>
          </div>
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent data-testid="dialog-delete-account">
          <DialogHeader>
            <DialogTitle>Delete Ledger Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{account.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={deleteMutation.isPending}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function LedgerAccountView() {
  return (
    <LedgerAccountLayout activeTab="view">
      <AccountDetailsContent />
    </LedgerAccountLayout>
  );
}
