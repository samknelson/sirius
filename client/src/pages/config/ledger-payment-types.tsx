import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useOptionsListName } from "@/hooks/useConfigNavigation";
import { BackToOptions } from "@/components/shared/BackToOptions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Loader2, Plus, Edit, Trash2, Save, X, ArrowUp, ArrowDown } from "lucide-react";
import { getAllCurrencies } from "@shared/currency";
import type { PaymentTypeCorrectionPreview } from "@shared/payment-type-correction";
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
  direction?: "charge" | "credit";
  sequence: number;
}

const paymentCategories = [
  { value: "financial", label: "Financial" },
  { value: "adjustment", label: "Adjustment" },
] as const;

const paymentDirections = [
  { value: "charge", label: "Charge" },
  { value: "credit", label: "Credit" },
] as const;

const currencies = getAllCurrencies();

export default function LedgerPaymentTypesPage() {
  // The options registry names this list; this page does not name it again.
  const { pluralName: listName } = useOptionsListName("ledger-payment-type");
  usePageTitle(listName ?? "Options");
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [correctionType, setCorrectionType] = useState<LedgerPaymentType | null>(null);
  const [correctionPreview, setCorrectionPreview] = useState<PaymentTypeCorrectionPreview | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const previewGeneration = useRef(0);
  
  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCurrencyCode, setFormCurrencyCode] = useState("USD");
  const [formCategory, setFormCategory] = useState<"financial" | "adjustment">("financial");
  const [formDirection, setFormDirection] = useState<"charge" | "credit">("credit");
  
  const { data: paymentTypes = [], isLoading } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/options/ledger-payment-type"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string | null; currencyCode: string; category: "financial" | "adjustment"; direction: "charge" | "credit" }) => {
      // Find the highest sequence number
      const maxSequence = paymentTypes.reduce((max, type) => Math.max(max, type.sequence), -1);
      return apiRequest("POST", "/api/options/ledger-payment-type", { 
        ...data, 
        sequence: maxSequence + 1 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/ledger-payment-type"] });
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
        description: getApiErrorMessage(error, "Failed to create ledger payment type."),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string | null; currencyCode: string; category: "financial" | "adjustment"; direction: "charge" | "credit" }) => {
      return apiRequest("PUT", `/api/options/ledger-payment-type/${data.id}`, {
        name: data.name,
        description: data.description,
        currencyCode: data.currencyCode,
        category: data.category,
        direction: data.direction,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/ledger-payment-type"] });
      setEditingId(null);
      setSaveError(null);
      resetForm();
      toast({
        title: "Success",
        description: "Ledger payment type updated successfully.",
      });
    },
    onError: (error: any) => {
      setSaveError(getApiErrorMessage(error, "Failed to update ledger payment type."));
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to update ledger payment type."),
        variant: "destructive",
      });
    },
  });

  const previewCorrectionMutation = useMutation({
    mutationFn: async ({ id }: { id: string; generation: number }): Promise<PaymentTypeCorrectionPreview> =>
      apiRequest("POST", `/api/options/ledger-payment-type/${id}/charge-correction/preview`),
    onSuccess: (preview, { generation }) => {
      if (generation !== previewGeneration.current) return;
      setCorrectionPreview(preview);
      setCorrectionError(null);
    },
    onError: (error: unknown, { generation }) => {
      if (generation !== previewGeneration.current) return;
      setCorrectionPreview(null);
      setCorrectionError(getApiErrorMessage(error, "Could not preview the historical correction."));
    },
  });

  const confirmCorrectionMutation = useMutation({
    mutationFn: async ({ id, snapshot }: { id: string; snapshot: string }) =>
      apiRequest("POST", `/api/options/ledger-payment-type/${id}/charge-correction/confirm`, {
        snapshot,
        confirmed: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/ledger-payment-type"] });
      setCorrectionType(null);
      setCorrectionPreview(null);
      setCorrectionError(null);
      setEditingId(null);
      setSaveError(null);
      resetForm();
      toast({ title: "Correction complete", description: "Payment type and historical allocations have been updated." });
    },
    onError: (error: unknown) => {
      // A failed confirmation must never re-use the old snapshot.
      setCorrectionPreview(null);
      setCorrectionError(`${getApiErrorMessage(error, "Could not apply the historical correction.")} Review a fresh preview before retrying.`);
    },
  });

  const openCorrection = (type: LedgerPaymentType) => {
    setCorrectionType(type);
    setCorrectionPreview(null);
    setCorrectionError(null);
    previewCorrectionMutation.mutate({ id: type.id, generation: ++previewGeneration.current });
  };

  const closeCorrection = () => {
    if (confirmCorrectionMutation.isPending) return;
    ++previewGeneration.current;
    setCorrectionType(null);
    setCorrectionPreview(null);
    setCorrectionError(null);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/options/ledger-payment-type/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/ledger-payment-type"] });
      setDeleteId(null);
      toast({
        title: "Success",
        description: "Ledger payment type deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(error, "Failed to delete ledger payment type."),
        variant: "destructive",
      });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: { id: string; sequence: number }) => {
      return apiRequest("PUT", `/api/options/ledger-payment-type/${data.id}`, {
        sequence: data.sequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/options/ledger-payment-type"] });
    },
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormCurrencyCode("USD");
    setFormCategory("financial");
    setFormDirection("credit");
  };

  const handleEdit = (type: LedgerPaymentType) => {
    setSaveError(null);
    setEditingId(type.id);
    setFormName(type.name);
    setFormDescription(type.description || "");
    setFormCurrencyCode(type.currencyCode || "USD");
    setFormCategory(type.category || "financial");
    setFormDirection(type.direction || "credit");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setSaveError(null);
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
    setSaveError(null);
    updateMutation.mutate({
      id: editingId!,
      name: formName.trim(),
      description: formDescription.trim() || null,
      currencyCode: formCurrencyCode,
      category: formCategory,
      direction: formDirection,
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
      direction: formDirection,
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
      <div className="mb-4">
        <BackToOptions />
      </div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="heading-ledger-payment-types">
          {listName ?? "Options"}
        </h1>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-payment-type">
          <Plus className="mr-2 h-4 w-4" />
          Add Payment Type
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{listName ? `${listName} Management` : "Management"}</CardTitle>
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
                  <TableHead>Effect</TableHead>
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
                    <TableCell data-testid={`text-direction-${type.id}`}>
                      {editingId === type.id ? (
                         <div className="space-y-2">
                           <Select value={formDirection} onValueChange={(value) => setFormDirection(value as "charge" | "credit")}>
                             <SelectTrigger data-testid={`select-edit-direction-${type.id}`}>
                               <SelectValue />
                             </SelectTrigger>
                             <SelectContent>
                               {paymentDirections.map((direction) => (
                                 <SelectItem key={direction.value} value={direction.value}>
                                   {direction.label}
                                 </SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                           {type.direction === "credit" && formDirection === "charge" && (
                             <div className="text-xs space-y-2" data-testid={`effect-change-guidance-${type.id}`}>
                               <p>Normal save cannot change the effect if this type has cleared payments: their existing credits would retain the wrong sign.</p>
                               <p>Review and explicitly confirm a historical correction below, or add a new Charge payment type instead. Unsaved name, category, currency, and description edits are not included in a correction.</p>
                               <Button type="button" variant="outline" size="sm" onClick={() => openCorrection(type)}
                                 data-testid={`button-preview-correction-${type.id}`}>
                                 Preview historical correction
                               </Button>
                             </div>
                           )}
                           {type.direction === "charge" && formDirection === "credit" && (
                             <p className="text-xs text-muted-foreground">Changing Charge to Credit for cleared payments also requires a separately reviewed correction; this workflow only supports Credit to Charge.</p>
                           )}
                         </div>
                      ) : (
                        paymentDirections.find((direction) => direction.value === (type.direction || "credit"))?.label || "Credit"
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
                         <div className="space-y-2">
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
                         {saveError && (
                           <p role="alert" className="text-sm text-destructive text-left" data-testid={`error-edit-payment-type-${type.id}`}>
                             {saveError} {type.direction === "credit" && formDirection === "charge" &&
                               "Use Preview historical correction to review affected payments, or add a new Charge type."}
                           </p>
                         )}
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
              <Label htmlFor="add-direction">Effect</Label>
              <Select value={formDirection} onValueChange={(value) => setFormDirection(value as "charge" | "credit")}>
                <SelectTrigger id="add-direction" data-testid="select-add-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentDirections.map((direction) => (
                    <SelectItem key={direction.value} value={direction.value}>
                      {direction.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choose whether this payment type adds a charge or records a credit.
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

      {/* Historical corrections are deliberately separate from the ordinary edit form. */}
      <Dialog open={correctionType !== null} onOpenChange={(open) => !open && closeCorrection()}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-charge-correction">
          <DialogHeader>
            <DialogTitle>Review Credit to Charge correction</DialogTitle>
            <DialogDescription>
              {correctionType?.name}: changing the type alone would leave cleared payments as credits.
              This action changes the effect and reconciles the previewed historical allocations together.
              Unsaved edits in the payment type row will not be saved. You can instead add a new Charge type.
            </DialogDescription>
          </DialogHeader>
          {previewCorrectionMutation.isPending && !correctionPreview && (
            <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reviewing cleared payments…</p>
          )}
          {correctionError && <p role="alert" className="text-sm text-destructive" data-testid="error-charge-correction">{correctionError}</p>}
          {correctionPreview && (
            <div className="space-y-4" data-testid="charge-correction-preview">
              <p className="text-sm">
                {correctionPreview.paymentCount} cleared payment{correctionPreview.paymentCount === 1 ? "" : "s"} affected.
                Review the current simple-allocation entries before confirming.
              </p>
              {correctionPreview.blockers.length ? (
                <div role="alert" className="text-sm text-destructive" data-testid="charge-correction-unsupported">
                  <p>Correction cannot proceed until these problems are resolved:</p>
                  <ul className="list-disc pl-5">
                    {correctionPreview.blockers.map((reason, index) => <li key={index}>{reason}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="max-h-72 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Cleared payment</TableHead>
                    <TableHead>Payment amount</TableHead>
                    <TableHead>Existing allocation entries</TableHead>
                    <TableHead>Eligibility</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {correctionPreview.payments.map((payment) => (
                      <TableRow key={payment.id} data-testid={`correction-payment-${payment.id}`}>
                        <TableCell className="font-mono text-xs">{payment.id}</TableCell>
                        <TableCell>{payment.amount}</TableCell>
                        <TableCell>
                          {payment.entries.length === 0 ? "None" : payment.entries.map((entry) => (
                            <div key={entry.id} className="text-xs">
                              <span className="font-mono">{entry.id}</span> ({entry.plugin}; EA {entry.eaId}):
                              {" "}{entry.amount} → {entry.proposedAmount}
                              <span className="text-muted-foreground"> ({entry.key})</span>
                            </div>
                          ))}
                        </TableCell>
                        <TableCell>{payment.blockers.length
                          ? <span className="text-destructive">{payment.blockers.join("; ")}</span>
                          : "Eligible"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {correctionPreview.payments.length === 0 && (
                <p className="text-sm text-muted-foreground">No cleared payments currently use this type. A normal save can change its effect.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeCorrection} disabled={confirmCorrectionMutation.isPending}>Cancel</Button>
            {correctionError && (
              <Button variant="outline" onClick={() => correctionType && previewCorrectionMutation.mutate({
                id: correctionType.id, generation: ++previewGeneration.current,
              })}
                disabled={previewCorrectionMutation.isPending || confirmCorrectionMutation.isPending}
                data-testid="button-refresh-correction-preview">
                Refresh preview
              </Button>
            )}
            <Button variant="destructive"
              onClick={() => correctionType && correctionPreview && confirmCorrectionMutation.mutate({
                id: correctionType.id,
                snapshot: correctionPreview.snapshot,
              })}
              disabled={!correctionType || !correctionPreview || !correctionPreview.eligible
                || confirmCorrectionMutation.isPending || previewCorrectionMutation.isPending}
              data-testid="button-confirm-charge-correction">
              {confirmCorrectionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm historical correction
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
