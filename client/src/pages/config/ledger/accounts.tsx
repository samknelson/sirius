import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LedgerAccount {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export default function LedgerAccountsPage() {
  console.log("[LedgerAccountsPage] Component rendering");
  
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  
  const { data: accounts = [], isLoading } = useQuery<LedgerAccount[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; isActive: boolean }) => {
      return apiRequest("POST", "/api/ledger/accounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Ledger account created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create ledger account.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description?: string; isActive: boolean }) => {
      return apiRequest("PUT", `/api/ledger/accounts/${data.id}`, {
        name: data.name,
        description: data.description,
        isActive: data.isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Ledger account updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update ledger account.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/ledger/accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger/accounts"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Ledger account deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete ledger account.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormIsActive(true);
  };

  const handleEdit = (account: LedgerAccount) => {
    setEditingId(account.id);
    setFormName(account.name);
    setFormDescription(account.description || "");
    setFormIsActive(account.isActive);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    resetForm();
  };

  const handleSaveEdit = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      isActive: formIsActive,
    });
  };

  const handleCreate = () => {
    if (!formName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      isActive: formIsActive,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Ledger Accounts
          </h1>
          <p className="text-muted-foreground mt-2">
            Manage ledger account types for financial tracking
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-account">
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Configure ledger accounts for categorizing financial transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No ledger accounts found. Click "Add Account" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((account) => (
                  <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                    {editingId === account.id ? (
                      <>
                        <TableCell>
                          <Input
                            value={formName}
                            onChange={(e) => setFormName(e.target.value)}
                            placeholder="Account name"
                            data-testid="input-edit-name"
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            placeholder="Description (optional)"
                            rows={2}
                            data-testid="input-edit-description"
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="edit-isActive"
                              checked={formIsActive}
                              onCheckedChange={(checked) => setFormIsActive(checked as boolean)}
                              data-testid="checkbox-edit-active"
                            />
                            <Label htmlFor="edit-isActive">Active</Label>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleSaveEdit}
                              disabled={updateMutation.isPending}
                              data-testid="button-save-edit"
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={handleCancelEdit}
                              disabled={updateMutation.isPending}
                              data-testid="button-cancel-edit"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="font-medium">{account.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {account.description || <span className="italic">No description</span>}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              account.isActive
                                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                : "bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400"
                            }`}
                          >
                            {account.isActive ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end space-x-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEdit(account)}
                              data-testid={`button-edit-${account.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteId(account.id)}
                              data-testid={`button-delete-${account.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="dialog-add-account">
          <DialogHeader>
            <DialogTitle>Add Ledger Account</DialogTitle>
            <DialogDescription>
              Create a new ledger account for financial tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Cash, Accounts Receivable"
                data-testid="input-name"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={3}
                data-testid="input-description"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={formIsActive}
                onCheckedChange={(checked) => setFormIsActive(checked as boolean)}
                data-testid="checkbox-active"
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                resetForm();
              }}
              data-testid="button-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              data-testid="button-create"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-account">
          <DialogHeader>
            <DialogTitle>Delete Ledger Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this ledger account? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
              disabled={deleteMutation.isPending}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
