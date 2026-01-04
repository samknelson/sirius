import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ArrowUp, ArrowDown } from "lucide-react";
import { getAllCurrencies } from "@shared/currency";
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

interface LedgerPaymentType {
  id: string;
  name: string;
  description: string | null;
  currencyCode: string;
  category: "financial" | "adjustment";
  sequence: number;
}

const paymentCategories = [
  { value: "financial", label: "Financial" },
  { value: "adjustment", label: "Adjustment" },
] as const;

const currencies = getAllCurrencies();

export default function LedgerPaymentTypesPage() {
  usePageTitle("Payment Types");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCurrencyCode, setFormCurrencyCode] = useState("USD");
  const [formCategory, setFormCategory] = useState<"financial" | "adjustment">("financial");
  
  const { data: paymentTypes = [], isLoading } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger-payment-types"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null; currencyCode: string; category: "financial" | "adjustment" }) => {
      // Find the highest sequence number
      const maxSequence = paymentTypes.reduce((max, type) => Math.max(max, type.sequence), -1);
      return apiRequest("POST", "/api/ledger-payment-types", { 
        ...data, 
        sequence: maxSequence + 1 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-types"] });
      setIsAddDialogOpen(false);
      resetForm();
      toast({
        title: "Success",
        description: "Ledger payment type created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create ledger payment type.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string | null; currencyCode: string; category: "financial" | "adjustment" }) => {
      return apiRequest("PUT", `/api/ledger-payment-types/${data.id}`, {
        name: data.name,
        description: data.description,
        currencyCode: data.currencyCode,
        category: data.category,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-types"] });
      setEditingId(null);
      resetForm();
      toast({
        title: "Success",
        description: "Ledger payment type updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update ledger payment type.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/ledger-payment-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-types"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Ledger payment type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete ledger payment type.",
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/ledger-payment-types/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ledger-payment-types"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormCurrencyCode("USD");
    setFormCategory("financial");
  };

  const handleEdit = (type: LedgerPaymentType) => {
    setEditingId(type.id);
    setFormName(type.name);
    setFormDescription(type.description || "");
    setFormCurrencyCode(type.currencyCode || "USD");
    setFormCategory(type.category || "financial");
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
      description: formDescription.trim() || null,
      currencyCode: formCurrencyCode,
      category: formCategory,
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
      description: formDescription.trim() || null,
      currencyCode: formCurrencyCode,
      category: formCategory,
    });
  };

  const moveUp = (type: LedgerPaymentType) => {
    const currentIndex = paymentTypes.findIndex(t => t.id === type.id);
    if (currentIndex > 0) {
      const prevType = paymentTypes[currentIndex - 1];
      updateSequenceMutation.mutate({ id: type.id, sequence: prevType.sequence });
      updateSequenceMutation.mutate({ id: prevType.id, sequence: type.sequence });
    }
  };

  const moveDown = (type: LedgerPaymentType) => {
    const currentIndex = paymentTypes.findIndex(t => t.id === type.id);
    if (currentIndex < paymentTypes.length - 1) {
      const nextType = paymentTypes[currentIndex + 1];
      updateSequenceMutation.mutate({ id: type.id, sequence: nextType.sequence });
      updateSequenceMutation.mutate({ id: nextType.id, sequence: type.sequence });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold" data-testid="heading-ledger-payment-types">
          Ledger Payment Types
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-payment-type">
          <Plus className="mr-2 h-4 w-4" />
          Add Payment Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ledger Payment Types Management</CardTitle>
          <CardDescription>
            Manage the types of payments that can be recorded in the ledger. Use the arrows to reorder types.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-types">
              No payment types configured yet. Click "Add Payment Type" to create one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentTypes.map((type, index) => (
                  <TableRow key={type.id} data-testid={`row-payment-type-${type.id}`}>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveUp(type)}
                          disabled={index === 0}
                          data-testid={`button-move-up-${type.id}`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => moveDown(type)}
                          disabled={index === paymentTypes.length - 1}
                          data-testid={`button-move-down-${type.id}`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-name-${type.id}`}>
                      {editingId === type.id ? (
                        <Input
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                          placeholder="Name"
                          data-testid={`input-edit-name-${type.id}`}
                        />
                      ) : (
                        type.name
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-category-${type.id}`}>
                      {editingId === type.id ? (
                        <Select value={formCategory} onValueChange={(v) => setFormCategory(v as "financial" | "adjustment")}>
                          <SelectTrigger data-testid={`select-edit-category-${type.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentCategories.map((cat) => (
                              <SelectItem key={cat.value} value={cat.value}>
                                {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        paymentCategories.find(c => c.value === type.category)?.label || "Financial"
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-currency-${type.id}`}>
                      {editingId === type.id ? (
                        <Select value={formCurrencyCode} onValueChange={setFormCurrencyCode}>
                          <SelectTrigger data-testid={`select-edit-currency-${type.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {currencies.map((currency) => (
                              <SelectItem key={currency.code} value={currency.code}>
                                {currency.code} - {currency.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        type.currencyCode || "USD"
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-description-${type.id}`}>
                      {editingId === type.id ? (
                        <Input
                          value={formDescription}
                          onChange={(e) => setFormDescription(e.target.value)}
                          placeholder="Description (optional)"
                          data-testid={`input-edit-description-${type.id}`}
                        />
                      ) : (
                        type.description || <span className="text-muted-foreground italic">None</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === type.id ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending}
                            data-testid={`button-save-${type.id}`}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCancelEdit}
                            data-testid={`button-cancel-edit-${type.id}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(type)}
                            data-testid={`button-edit-${type.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteId(type.id)}
                            data-testid={`button-delete-${type.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent data-testid="dialog-add-payment-type">
          <DialogHeader>
            <DialogTitle>Add Ledger Payment Type</DialogTitle>
            <DialogDescription>
              Create a new payment type for the ledger with an optional description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Cash, Check, Wire Transfer"
                data-testid="input-add-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-category">Category</Label>
              <Select value={formCategory} onValueChange={(v) => setFormCategory(v as "financial" | "adjustment")}>
                <SelectTrigger data-testid="select-add-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentCategories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Financial: includes merchant, status, date received, check/transaction number.
                Adjustment: includes user, date entered, effective date (always cleared).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-currency">Currency</Label>
              <Select value={formCurrencyCode} onValueChange={setFormCurrencyCode}>
                <SelectTrigger data-testid="select-add-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((currency) => (
                    <SelectItem key={currency.code} value={currency.code}>
                      {currency.code} - {currency.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-description">Description</Label>
              <Textarea
                id="add-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description of this payment type"
                data-testid="input-add-description"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsAddDialogOpen(false);
                resetForm();
              }}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              data-testid="button-submit-add"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent data-testid="dialog-delete-confirm">
          <DialogHeader>
            <DialogTitle>Delete Ledger Payment Type</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this payment type? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteId(null)}
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
