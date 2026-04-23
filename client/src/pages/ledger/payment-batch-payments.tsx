import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Plus, Trash2, Pencil, AlertCircle, CheckCircle2 } from "lucide-react";
import type { LedgerPayment, LedgerPaymentType, LedgerAccount } from "@shared/schema";

type EAListItem = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
};

type BatchPayment = LedgerPayment & { _assignmentId: string };

const paymentStatuses = ["draft", "canceled", "cleared", "error"] as const;

function formatCurrency(amount: string | number | null | undefined, currencyCode = "USD") {
  if (amount == null || amount === "") return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(num);
}

interface NewPaymentFormProps {
  batchId: string;
  accountId: string;
  currencyCode: string;
  onCreated: () => void;
}

function NewPaymentForm({ batchId, accountId, currencyCode, onCreated }: NewPaymentFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: paymentTypes = [] } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });
  const { data: accountEAs = [] } = useQuery<EAListItem[]>({
    queryKey: ["/api/ledger/ea", { accountId }],
    queryFn: () => apiRequest("GET", `/api/ledger/ea?accountId=${accountId}`),
    enabled: !!accountId,
  });

  const [paymentType, setPaymentType] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<typeof paymentStatuses[number]>("draft");
  const [eaId, setEaId] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [dateCleared, setDateCleared] = useState("");
  const [merchant, setMerchant] = useState("");
  const [checkTransactionNumber, setCheckTransactionNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [statementMonth, setStatementMonth] = useState("");
  const [statementYear, setStatementYear] = useState("");

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("POST", `/api/ledger-payment-batches/${batchId}/payments`, { payment: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ledger-payment-batches", batchId, "payments"] });
      qc.invalidateQueries({ queryKey: ["/api/ledger-payment-batches", batchId] });
      toast({ title: "Payment added", description: "The payment was added to this batch." });
      // reset form
      setAmount("");
      setEaId("");
      setMerchant("");
      setCheckTransactionNumber("");
      setMemo("");
      setStatementMonth("");
      setStatementYear("");
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add payment", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentType) {
      toast({ title: "Payment type required", variant: "destructive" });
      return;
    }
    if (!eaId) {
      toast({ title: "Participant required", variant: "destructive" });
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast({ title: "Amount required", description: "Enter a valid amount.", variant: "destructive" });
      return;
    }
    if (!dateReceived) {
      toast({ title: "Date received required", variant: "destructive" });
      return;
    }

    const details: Record<string, unknown> = {};
    if (merchant) details.merchant = merchant;
    if (checkTransactionNumber) details.checkTransactionNumber = checkTransactionNumber;

    const ymd =
      statementMonth && statementYear
        ? `${statementYear}-${String(parseInt(statementMonth, 10)).padStart(2, "0")}-01`
        : "";
    details.proposedAllocation = [
      { eaId, amount: amt.toFixed(2), statementYmd: ymd },
    ];

    createMutation.mutate({
      paymentType,
      amount: amt.toFixed(2),
      status,
      ledgerEaId: eaId,
      allocated: false,
      dateReceived,
      dateCleared: dateCleared || null,
      memo: memo || null,
      details,
    });
  };

  return (
    <Card data-testid="card-new-payment-form">
      <CardHeader>
        <CardTitle>Add Payment to Batch</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Payment Type</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger data-testid="select-new-payment-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {paymentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-new-amount"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Participant</Label>
            <Select value={eaId} onValueChange={setEaId}>
              <SelectTrigger data-testid="select-new-ea">
                <SelectValue placeholder="Select participant" />
              </SelectTrigger>
              <SelectContent>
                {accountEAs.map((ea) => (
                  <SelectItem key={ea.id} value={ea.id}>
                    {ea.entityName || `${ea.entityType} ${ea.entityId}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof paymentStatuses[number])}>
                <SelectTrigger data-testid="select-new-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentStatuses.map((s) => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date Received</Label>
              <Input
                type="date"
                value={dateReceived}
                onChange={(e) => setDateReceived(e.target.value)}
                data-testid="input-new-date-received"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date Cleared (optional)</Label>
              <Input
                type="date"
                value={dateCleared}
                onChange={(e) => setDateCleared(e.target.value)}
                data-testid="input-new-date-cleared"
              />
            </div>
            <div className="space-y-1">
              <Label>Check / Transaction # (optional)</Label>
              <Input
                value={checkTransactionNumber}
                onChange={(e) => setCheckTransactionNumber(e.target.value)}
                data-testid="input-new-check-number"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Merchant (optional)</Label>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              data-testid="input-new-merchant"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Statement Month (optional)</Label>
              <Input
                type="number"
                min="1"
                max="12"
                value={statementMonth}
                onChange={(e) => setStatementMonth(e.target.value)}
                placeholder="1-12"
                data-testid="input-new-stmt-month"
              />
            </div>
            <div className="space-y-1">
              <Label>Statement Year (optional)</Label>
              <Input
                type="number"
                min="2000"
                max="2100"
                value={statementYear}
                onChange={(e) => setStatementYear(e.target.value)}
                placeholder="YYYY"
                data-testid="input-new-stmt-year"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Memo (optional)</Label>
            <Textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Optional memo"
              data-testid="input-new-memo"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-batch-payment">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Payment
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

interface PaymentDetailPaneProps {
  payment: BatchPayment;
  paymentType?: LedgerPaymentType;
  currencyCode: string;
  batchId: string;
  onRemoved: () => void;
}

function PaymentDetailPane({ payment, paymentType, currencyCode, batchId, onRemoved }: PaymentDetailPaneProps) {
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
      qc.invalidateQueries({ queryKey: ["/api/ledger-payment-batches", batchId] });
      toast({
        title: mode === "delete" ? "Payment deleted" : "Payment unassigned",
      });
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
            <Link href={`/ledger/payment/${payment.id}/edit`}>
              <Button variant="outline" size="sm" data-testid={`button-edit-${payment.id}`}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen("unassign")}
              data-testid={`button-unassign-${payment.id}`}
            >
              Unassign
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
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Date Received</dt>
            <dd>{payment.dateReceived ? new Date(payment.dateReceived).toLocaleDateString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Date Cleared</dt>
            <dd>{payment.dateCleared ? new Date(payment.dateCleared).toLocaleDateString() : "—"}</dd>
          </div>
          {payment.memo && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Memo</dt>
              <dd>{payment.memo}</dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-muted-foreground">Payment ID</dt>
            <dd className="font-mono text-xs text-muted-foreground">{payment.id}</dd>
          </div>
        </dl>
      </CardContent>

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
    queryKey: ["/api/ledger-payment-batches", batch.id],
    enabled: !!batch.id,
  });

  const expectedTotal = batch.batchTotal != null ? parseFloat(batch.batchTotal) : null;
  const actualTotal = enrichedBatch?.paymentsTotal != null ? parseFloat(enrichedBatch.paymentsTotal) : 0;
  const totalDiff = expectedTotal != null ? actualTotal - expectedTotal : null;
  const expectedCount = batch.expectedPaymentCount;
  const actualCount = enrichedBatch?.paymentsCount ?? payments.length;
  const totalReconciled = totalDiff != null && Math.abs(totalDiff) < 0.01;

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
            {totalDiff != null &&
              (totalReconciled ? (
                <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {totalDiff > 0 ? "Over" : "Under"} by {formatCurrency(Math.abs(totalDiff), currency)}
                </Badge>
              ))}
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
            <NewPaymentForm
              batchId={batch.id}
              accountId={batch.accountId}
              currencyCode={currency}
              onCreated={() => setSelected(null)}
            />
          )}
          {selectedPayment && (
            <PaymentDetailPane
              payment={selectedPayment}
              paymentType={paymentTypeMap.get(selectedPayment.paymentType)}
              currencyCode={currency}
              batchId={batch.id}
              onRemoved={() => setSelected(null)}
            />
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
