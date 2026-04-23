import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Plus, Trash2, AlertCircle, CheckCircle2, MinusCircle } from "lucide-react";
import { PaymentForm } from "@/components/ledger/PaymentForm";
import type { LedgerPayment, LedgerPaymentType, LedgerAccount } from "@shared/schema";

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
};

interface BatchPaymentAllocation {
  eaId: string;
  amount: string;
  statementYmd: string;
  ea?: EAListItem | null;
}

export type BatchPayment = LedgerPayment & {
  _assignmentId: string;
  allocatedEntities?: BatchPaymentAllocation[];
};

function formatCurrency(amount: string | number | null | undefined, currencyCode = "USD") {
  if (amount == null || amount === "") return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(num);
}

interface PaymentDetailHeaderProps {
  payment: BatchPayment;
  paymentType?: LedgerPaymentType;
  currencyCode: string;
  batchId: string;
  onRemoved: () => void;
}

function PaymentDetailHeader({
  payment,
  paymentType,
  currencyCode,
  batchId,
  onRemoved,
}: PaymentDetailHeaderProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState<null | "unassign" | "delete">(null);

  const removeMutation = useMutation({
    mutationFn: async (mode: "unassign" | "delete") => {
      const qs = mode === "delete" ? "?deletePayment=true" : "";
      return apiRequest(
        "DELETE",
        `/api/ledger-payment-batches/${batchId}/payments/${payment.id}${qs}`,
      );
    },
    onSuccess: (_, mode) => {
      qc.invalidateQueries({ queryKey: ["/api/ledger-payment-batches", batchId, "payments"] });
      qc.invalidateQueries({ queryKey: [`/api/ledger-payment-batches/${batchId}`] });
      toast({ title: mode === "delete" ? "Payment deleted" : "Payment unassigned" });
      onRemoved();
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`card-payment-detail-${payment.id}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {formatCurrency(payment.amount, currencyCode)}
            </CardTitle>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{paymentType?.name || "Unknown type"}</span>
              <Badge variant="outline">{payment.status}</Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen("unassign")}
              data-testid={`button-unassign-${payment.id}`}
            >
              <MinusCircle className="h-4 w-4 mr-1" /> Unassign
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen("delete")}
              data-testid={`button-delete-${payment.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <AlertDialog open={confirmOpen !== null} onOpenChange={(open) => !open && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmOpen === "delete" ? "Delete this payment?" : "Unassign from batch?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmOpen === "delete"
                ? "This will permanently delete the payment and its ledger entries. This cannot be undone."
                : "The payment will remain in the system but will no longer be part of this batch."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmOpen && removeMutation.mutate(confirmOpen)}
              data-testid="button-confirm-remove"
            >
              {removeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function BatchPaymentsContent() {
  const { batch } = usePaymentBatchLayout();
  const [selected, setSelected] = useState<string | "new" | null>(null);

  const { data: account } = useQuery<LedgerAccount & { currencyCode?: string }>({
    queryKey: ["/api/ledger/accounts", batch.accountId],
    enabled: !!batch.accountId,
  });
  const currency = account?.currencyCode || "USD";

  const { data: payments = [], isLoading } = useQuery<BatchPayment[]>({
    queryKey: ["/api/ledger-payment-batches", batch.id, "payments"],
    queryFn: () => apiRequest("GET", `/api/ledger-payment-batches/${batch.id}/payments`),
    enabled: !!batch.id,
  });

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  const paymentTypeMap = useMemo(() => {
    const m = new Map<string, LedgerPaymentType>();
    paymentTypes.forEach((t) => m.set(t.id, t));
    return m;
  }, [paymentTypes]);

  const { data: enrichedBatch } = useQuery<typeof batch & { paymentsCount?: number; paymentsTotal?: string }>({
    queryKey: [`/api/ledger-payment-batches/${batch.id}`],
    enabled: !!batch.id,
  });

  const expectedTotal = batch.batchTotal != null ? parseFloat(batch.batchTotal) : null;
  const actualTotal = enrichedBatch?.paymentsTotal != null ? parseFloat(enrichedBatch.paymentsTotal) : 0;
  const totalDiff = expectedTotal != null ? actualTotal - expectedTotal : null;
  const expectedCount = batch.expectedPaymentCount;
  const actualCount = enrichedBatch?.paymentsCount ?? payments.length;
  const totalReconciled = totalDiff != null && Math.abs(totalDiff) < 0.01;
  const countReconciled =
    expectedCount == null ? null : actualCount === expectedCount;

  const reconciliationBadge = (() => {
    if (expectedTotal == null && expectedCount == null) {
      return (
        <Badge variant="outline" data-testid="badge-reconciliation">
          Unset
        </Badge>
      );
    }
    const totalsOk = expectedTotal == null || totalReconciled;
    const countsOk = expectedCount == null || countReconciled;
    if (totalsOk && countsOk) {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-reconciliation">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Balanced
        </Badge>
      );
    }
    if (totalDiff != null && totalDiff > 0) {
      return (
        <Badge variant="destructive" data-testid="badge-reconciliation">
          <AlertCircle className="h-3 w-3 mr-1" /> Over by {formatCurrency(Math.abs(totalDiff), currency)}
        </Badge>
      );
    }
    if (totalDiff != null && totalDiff < 0) {
      return (
        <Badge variant="destructive" data-testid="badge-reconciliation">
          <AlertCircle className="h-3 w-3 mr-1" /> Under by {formatCurrency(Math.abs(totalDiff), currency)}
        </Badge>
      );
    }
    // Only count mismatch
    return (
      <Badge variant="destructive" data-testid="badge-reconciliation">
        <AlertCircle className="h-3 w-3 mr-1" /> Count mismatch
      </Badge>
    );
  })();

  const selectedPayment = selected && selected !== "new" ? payments.find((p) => p.id === selected) : null;

  return (
    <div className="space-y-4">
      {/* Reconciliation summary strip */}
      <Card data-testid="card-payments-summary">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Total: </span>
              <span className="font-semibold tabular-nums" data-testid="text-summary-total">
                {formatCurrency(actualTotal, currency)}
              </span>
              {expectedTotal != null && (
                <span className="text-muted-foreground"> / {formatCurrency(expectedTotal, currency)}</span>
              )}
            </div>
            <div>
              <span className="text-muted-foreground">Payments: </span>
              <span className="font-semibold tabular-nums" data-testid="text-summary-count">
                {actualCount}
              </span>
              {expectedCount != null && (
                <span className="text-muted-foreground"> / {expectedCount}</span>
              )}
            </div>
            {reconciliationBadge}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left pane: vertical sub-tabs */}
        <Card className="md:col-span-1" data-testid="card-payments-list">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Payments</CardTitle>
            <Button
              size="sm"
              variant={selected === "new" ? "default" : "outline"}
              onClick={() => setSelected("new")}
              data-testid="button-add-batch-payment"
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </CardHeader>
          <CardContent className="p-2">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : payments.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                No payments yet. Click <span className="font-medium">Add</span> to record one.
              </div>
            ) : (
              <ul className="space-y-1" data-testid="list-batch-payments">
                {payments.map((p) => {
                  const isActive = selected === p.id;
                  const pt = paymentTypeMap.get(p.paymentType);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(p.id)}
                        className={`w-full text-left px-3 py-2 rounded-md transition-colors border ${
                          isActive
                            ? "bg-primary/10 border-primary"
                            : "border-transparent hover:bg-muted"
                        }`}
                        data-testid={`button-select-payment-${p.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium tabular-nums">
                            {formatCurrency(p.amount, currency)}
                          </span>
                          <Badge variant="outline" className="text-xs">{p.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {pt?.name || "—"}
                          {p.dateReceived
                            ? ` · ${new Date(p.dateReceived).toLocaleDateString()}`
                            : ""}
                        </div>
                        {p.allocatedEntities && p.allocatedEntities.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {p.allocatedEntities
                              .map((a) => a.ea?.entityName || `${a.ea?.entityType ?? "—"}`)
                              .join(", ")}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Right pane */}
        <div className="md:col-span-2">
          {selected === "new" && (
            <PaymentForm
              mode="create"
              accountId={batch.accountId}
              batchId={batch.id}
              title="Add Payment to Batch"
              description="Create a new payment that will be assigned to this batch."
              submitLabel="Save Payment"
              onSuccess={() => setSelected(null)}
              onCancel={() => setSelected(null)}
            />
          )}
          {selectedPayment && (
            <div className="space-y-4">
              <PaymentDetailHeader
                payment={selectedPayment}
                paymentType={paymentTypeMap.get(selectedPayment.paymentType)}
                currencyCode={currency}
                batchId={batch.id}
                onRemoved={() => setSelected(null)}
              />
              <PaymentForm
                mode="edit"
                paymentId={selectedPayment.id}
                title="Edit Payment"
                description="Update this payment in the batch."
                onSuccess={() => {
                  // stay on the selected payment so the user sees the updated values
                }}
                onCancel={() => setSelected(null)}
              />
            </div>
          )}
          {selected === null && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                Select a payment from the list, or click <span className="font-medium">Add</span> to record a new one.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaymentBatchPaymentsPage() {
  return (
    <PaymentBatchLayout activeTab="payments">
      <BatchPaymentsContent />
    </PaymentBatchLayout>
  );
}
