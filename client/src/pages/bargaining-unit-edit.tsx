import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BargainingUnitLayout, useBargainingUnitLayout } from "@/components/layouts/BargainingUnitLayout";
import { IconPicker } from "@/components/ui/icon-picker";
import { LedgerAccountBase } from "@/lib/ledger-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Pencil, Check, X } from "lucide-react";

interface NamedRate {
  name: string;
  rate: number;
}

type AccountRatesMap = Record<string, NamedRate[]>;

function AccountRatesSection({ bargainingUnitId }: { bargainingUnitId: string }) {
  const { toast } = useToast();
  const [newAccountId, setNewAccountId] = useState<string>("");
  const [newRateName, setNewRateName] = useState<string>("");
  const [newRate, setNewRate] = useState<string>("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [editingRate, setEditingRate] = useState<string>("");

  const { data: rates = {}, isLoading: isLoadingRates } = useQuery<AccountRatesMap>({
    queryKey: [`/api/bargaining-units/${bargainingUnitId}/rates`],
  });

  const { data: accounts = [], isLoading: isLoadingAccounts } = useQuery<LedgerAccountBase[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const addRateMutation = useMutation({
    mutationFn: async ({ accountId, name, rate }: { accountId: string; name: string; rate: number }) => {
      return apiRequest("POST", `/api/bargaining-units/${bargainingUnitId}/rates/${accountId}`, { name, rate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId, "rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId] });
      toast({ title: "Success", description: "Rate added successfully." });
      setNewAccountId("");
      setNewRateName("");
      setNewRate("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add rate.", variant: "destructive" });
    },
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ accountId, rateIndex, name, rate }: { accountId: string; rateIndex: number; name: string; rate: number }) => {
      return apiRequest("PUT", `/api/bargaining-units/${bargainingUnitId}/rates/${accountId}/${rateIndex}`, { name, rate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId, "rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId] });
      toast({ title: "Success", description: "Rate updated successfully." });
      setEditingKey(null);
      setEditingName("");
      setEditingRate("");
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update rate.", variant: "destructive" });
    },
  });

  const removeRateMutation = useMutation({
    mutationFn: async ({ accountId, rateIndex }: { accountId: string; rateIndex: number }) => {
      return apiRequest("DELETE", `/api/bargaining-units/${bargainingUnitId}/rates/${accountId}/${rateIndex}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId, "rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnitId] });
      toast({ title: "Success", description: "Rate removed successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to remove rate.", variant: "destructive" });
    },
  });

  const handleAddRate = () => {
    if (!newAccountId) {
      toast({ title: "Validation Error", description: "Please select an account.", variant: "destructive" });
      return;
    }
    const rateName = newRateName.trim() || "Default";
    const rateValue = parseFloat(newRate);
    if (isNaN(rateValue) || rateValue < 0) {
      toast({ title: "Validation Error", description: "Please enter a valid rate (0 or greater).", variant: "destructive" });
      return;
    }
    addRateMutation.mutate({ accountId: newAccountId, name: rateName, rate: rateValue });
  };

  const startEditing = (accountId: string, rateIndex: number, entry: NamedRate) => {
    setEditingKey(`${accountId}:${rateIndex}`);
    setEditingName(entry.name);
    setEditingRate(entry.rate.toString());
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditingName("");
    setEditingRate("");
  };

  const saveEdited = (accountId: string, rateIndex: number) => {
    const rateValue = parseFloat(editingRate);
    const name = editingName.trim();
    if (!name) {
      toast({ title: "Validation Error", description: "Rate name is required.", variant: "destructive" });
      return;
    }
    if (isNaN(rateValue) || rateValue < 0) {
      toast({ title: "Validation Error", description: "Please enter a valid rate (0 or greater).", variant: "destructive" });
      return;
    }
    updateRateMutation.mutate({ accountId, rateIndex, name, rate: rateValue });
  };

  const accountsById = accounts.reduce((acc, a) => ({ ...acc, [a.id]: a }), {} as Record<string, LedgerAccountBase>);

  const flatEntries: Array<{ accountId: string; rateIndex: number; entry: NamedRate }> = [];
  for (const [accountId, entries] of Object.entries(rates)) {
    entries.forEach((entry, rateIndex) => {
      flatEntries.push({ accountId, rateIndex, entry });
    });
  }

  const usedAccountIds = new Set(Object.keys(rates));
  const availableAccounts = accounts.filter(a => a.isActive);

  if (isLoadingRates || isLoadingAccounts) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Account Dues Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Account Dues Rates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {flatEntries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Rate Name</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatEntries.map(({ accountId, rateIndex, entry }) => {
                const account = accountsById[accountId];
                const key = `${accountId}:${rateIndex}`;
                const isEditing = editingKey === key;
                return (
                  <TableRow key={key} data-testid={`row-rate-${accountId}-${rateIndex}`}>
                    <TableCell data-testid={`text-account-name-${accountId}-${rateIndex}`}>{account?.name || accountId}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-32"
                          autoFocus
                          data-testid={`input-edit-rate-name-${accountId}-${rateIndex}`}
                        />
                      ) : (
                        <span data-testid={`text-rate-name-${accountId}-${rateIndex}`}>{entry.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editingRate}
                          onChange={(e) => setEditingRate(e.target.value)}
                          className="w-24 text-right ml-auto"
                          data-testid={`input-edit-rate-${accountId}-${rateIndex}`}
                        />
                      ) : (
                        <span data-testid={`text-rate-${accountId}-${rateIndex}`}>${entry.rate.toFixed(2)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => saveEdited(accountId, rateIndex)}
                              disabled={updateRateMutation.isPending}
                              data-testid={`button-save-rate-${accountId}-${rateIndex}`}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={cancelEditing}
                              disabled={updateRateMutation.isPending}
                              data-testid={`button-cancel-edit-rate-${accountId}-${rateIndex}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEditing(accountId, rateIndex, entry)}
                              data-testid={`button-edit-rate-${accountId}-${rateIndex}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={removeRateMutation.isPending}
                                  data-testid={`button-remove-rate-${accountId}-${rateIndex}`}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove Rate</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to remove the "{entry.name}" rate (${entry.rate.toFixed(2)}) for "{account?.name || accountId}"?
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel data-testid="button-cancel-remove-rate">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => removeRateMutation.mutate({ accountId, rateIndex })}
                                    data-testid="button-confirm-remove-rate"
                                  >
                                    Remove
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No account rates configured.</p>
        )}

        {availableAccounts.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t">
            <div className="flex-1 min-w-[180px] space-y-1">
              <Label htmlFor="new-account" className="text-sm">Account</Label>
              <Select value={newAccountId} onValueChange={setNewAccountId}>
                <SelectTrigger id="new-account" data-testid="select-new-account">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.map(account => (
                    <SelectItem key={account.id} value={account.id} data-testid={`option-account-${account.id}`}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[140px] space-y-1">
              <Label htmlFor="new-rate-name" className="text-sm">Rate Name</Label>
              <Input
                id="new-rate-name"
                type="text"
                placeholder="e.g. Biweekly"
                value={newRateName}
                onChange={(e) => setNewRateName(e.target.value)}
                data-testid="input-new-rate-name"
              />
            </div>
            <div className="w-[120px] space-y-1">
              <Label htmlFor="new-rate" className="text-sm">Rate ($)</Label>
              <Input
                id="new-rate"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={newRate}
                onChange={(e) => setNewRate(e.target.value)}
                data-testid="input-new-rate"
              />
            </div>
            <Button
              onClick={handleAddRate}
              disabled={addRateMutation.isPending}
              data-testid="button-add-rate"
            >
              {addRateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Add
            </Button>
          </div>
        )}

        {availableAccounts.length === 0 && flatEntries.length > 0 && (
          <p className="text-sm text-muted-foreground pt-2 border-t">All available accounts have rates configured.</p>
        )}
      </CardContent>
    </Card>
  );
}

function BargainingUnitEditContent() {
  const { bargainingUnit } = useBargainingUnitLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [editName, setEditName] = useState(bargainingUnit.name);
  const [editSiriusId, setEditSiriusId] = useState(bargainingUnit.siriusId);
  const [editIcon, setEditIcon] = useState<string | undefined>(
    (bargainingUnit.data as { icon?: string } | null)?.icon
  );
  const [editDelinquentDays, setEditDelinquentDays] = useState<number>(
    (bargainingUnit.data as { memberStatusDelinquentDays?: number } | null)?.memberStatusDelinquentDays || 60
  );

  const updateMutation = useMutation({
    mutationFn: async (data: { name: string; siriusId: string; data?: Record<string, unknown> | null }) => {
      return await apiRequest("PUT", `/api/bargaining-units/${bargainingUnit.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units", bargainingUnit.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bargaining-units"] });
      toast({
        title: "Success",
        description: "Bargaining unit updated successfully!",
      });
      setLocation(`/bargaining-units/${bargainingUnit.id}`);
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update bargaining unit. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (!editName.trim()) {
      toast({
        title: "Validation Error",
        description: "Name is required.",
        variant: "destructive",
      });
      return;
    }

    if (!editSiriusId.trim()) {
      toast({
        title: "Validation Error",
        description: "Sirius ID is required.",
        variant: "destructive",
      });
      return;
    }

    const existingData = (bargainingUnit.data as Record<string, unknown>) || {};
    const newData: Record<string, unknown> = { ...existingData, memberStatusDelinquentDays: editDelinquentDays };
    if (editIcon) {
      newData.icon = editIcon;
    } else {
      delete newData.icon;
    }

    updateMutation.mutate({
      name: editName.trim(),
      siriusId: editSiriusId.trim(),
      data: newData,
    });
  };

  return (
    <>
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Bargaining Unit</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name" className="text-sm font-medium text-foreground">
                Name *
              </Label>
              <Input
                id="edit-name"
                type="text"
                placeholder="Enter bargaining unit name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-sirius-id" className="text-sm font-medium text-foreground">
                Sirius ID *
              </Label>
              <Input
                id="edit-sirius-id"
                type="text"
                placeholder="Enter Sirius ID..."
                value={editSiriusId}
                onChange={(e) => setEditSiriusId(e.target.value)}
                className="w-full"
                data-testid="input-edit-sirius-id"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                Icon
              </Label>
              <IconPicker
                value={editIcon}
                onChange={setEditIcon}
                data-testid="icon-picker-edit"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-delinquent-days" className="text-sm font-medium text-foreground">
                Member Status: Delinquent After (days)
              </Label>
              <p className="text-xs text-muted-foreground">
                Number of days since the last dues payment before a member's status changes to Delinquent.
              </p>
              <Input
                id="edit-delinquent-days"
                type="number"
                min={1}
                max={365}
                value={editDelinquentDays}
                onChange={(e) => setEditDelinquentDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 60)))}
                className="w-32"
                data-testid="input-edit-delinquent-days"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-4">
          <Button
            onClick={handleSaveEdit}
            disabled={updateMutation.isPending}
            data-testid="button-save-edit"
          >
            {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation(`/bargaining-units/${bargainingUnit.id}`)}
            data-testid="button-cancel-edit"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>

    <AccountRatesSection bargainingUnitId={bargainingUnit.id} />
    </>
  );
}

export default function BargainingUnitEditPage() {
  return (
    <BargainingUnitLayout activeTab="edit">
      <BargainingUnitEditContent />
    </BargainingUnitLayout>
  );
}
