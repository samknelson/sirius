import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, Check, CreditCard, Loader2, Plus, Star, Trash2, X } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { WorkerStripePaymentForm } from "@/components/ledger/WorkerStripePaymentForm";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { hasPaymentGatewayComponent, resolvePaymentGatewayComponent } from "@/plugins/payment-gateway/registry";

type Method = {
  id: string; gatewayConfigId: string; isActive: boolean; isDefault: boolean;
  providerDetails?: { type?: string; card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
    us_bank_account?: { bank_name: string | null; last4: string; account_type: string | null } | null };
};
type Gateway = { id: string; pluginId: string; name: string | null };
type Payable = { balance: string; currencyCode?: string; eaId?: string | null };
type Setup = { clientSecret: string; componentId: string | null; publicConfig: Record<string, unknown> };
type Intent = {
  id: string;
  clientSecret: string | null;
  componentId?: string | null;
  publicConfig: Record<string, unknown>;
  status?: "requires_action" | "succeeded" | "processing" | "failed";
};

const BASE = "/api/ledger/payment-methods";

function WorkerPaymentContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [gatewayId, setGatewayId] = useState<string>();
  const [setup, setSetup] = useState<Setup>();
  const [deleteId, setDeleteId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [intent, setIntent] = useState<Intent>();
  const [result, setResult] = useState<"succeeded" | "processing" | "failed">();
  const [attemptId, setAttemptId] = useState<string>();
  const [paymentAmount, setPaymentAmount] = useState("");

  const key = ["worker-payment", worker.id];
  const payable = useQuery<Payable>({ queryKey: [...key, "payable"], queryFn: () => apiRequest("GET", `/api/workers/${worker.id}/ledger/payable`) });
  const methods = useQuery<Method[]>({ queryKey: [...key, "methods"], queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}`) });
  const gateways = useQuery<Gateway[]>({ queryKey: [...key, "gateways"], queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}/gateways`) });

  const attach = useMutation({
    mutationFn: (methodToken: string) => apiRequest("POST", `${BASE}/worker/${worker.id}`, { gatewayConfigId: gatewayId, methodToken }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...key, "methods"] }); setAddOpen(false); setSetup(undefined); },
    onError: (e) => toast({ title: "Could not save payment method", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });
  const startSetup = async (id: string) => {
    setGatewayId(id);
    try { setSetup(await apiRequest("POST", `${BASE}/worker/${worker.id}/setup`, { gatewayConfigId: id })); }
    catch (e) { toast({ title: "Could not start setup", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }); }
  };
  const beginPayment = useMutation({
    mutationFn: () => apiRequest("POST", `/api/workers/${worker.id}/ledger/payment-intent`, {
      eaId: payable.data?.eaId,
      amount: paymentAmount,
      paymentMethodId: selected,
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: (data: Intent) => {
      setAttemptId(data.id);
      if (data.status === "succeeded" || data.status === "processing") {
        setResult("processing");
      } else if (data.status === "failed") {
        setResult("failed");
      } else {
        setIntent(data);
      }
    },
    onError: (e) => toast({ title: "Could not start payment", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });
  const attemptStatus = useQuery<{ status: "requires_action" | "processing" | "succeeded" | "failed" }>({
    queryKey: ["/api/ledger/payment-attempts/status", attemptId],
    queryFn: () => apiRequest("GET", `/api/ledger/payment-attempts/${attemptId}`),
    enabled: !!attemptId && result === "processing",
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (result !== "processing") return;
    if (attemptStatus.data?.status === "succeeded") {
      setResult("succeeded");
      void payable.refetch();
    } else if (attemptStatus.data?.status === "failed") {
      setResult("failed");
    }
  }, [attemptStatus.data?.status, payable, result]);
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${BASE}/worker/${worker.id}/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...key, "methods"] }); setDeleteId(undefined); if (selected === deleteId) setSelected(undefined); },
    onError: (e) => toast({ title: "Could not remove payment method", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${BASE}/worker/${worker.id}/${id}/set-default`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...key, "methods"] }),
  });

  if (payable.isLoading || methods.isLoading || gateways.isLoading) return <Card><CardContent className="py-12 text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin" /></CardContent></Card>;
  if (payable.isError) return <Alert variant="destructive"><AlertDescription data-testid="text-worker-payment-error">Unable to load your payable balance.</AlertDescription></Alert>;
  const amount = Number(payable.data?.balance ?? 0);
  const formatted = amount.toLocaleString("en-US", { style: "currency", currency: payable.data?.currencyCode ?? "USD" });
  const enteredAmount = Number(paymentAmount);
  const validAmount = Number.isFinite(enteredAmount) && enteredAmount > 0 && enteredAmount <= amount;
  const Add = setup?.componentId && hasPaymentGatewayComponent(setup.componentId) ? resolvePaymentGatewayComponent(setup.componentId) : null;

  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Make a payment</CardTitle><CardDescription>Review your balance and pay securely with a card or US bank account.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Amount due</p><p className="text-3xl font-semibold" data-testid="text-worker-payment-balance">{formatted}</p></div>
        {amount <= 0.005 ? <p className="text-sm text-muted-foreground" data-testid="text-worker-payment-paid">You have no balance due.</p> :
          <><div className="flex items-center justify-between"><h3 className="font-medium">Payment method</h3><Button variant="outline" onClick={() => { setAddOpen(true); setSetup(undefined); }} data-testid="button-worker-add-payment-method"><Plus className="mr-2 h-4 w-4" />Add payment method</Button></div>
          {(methods.data ?? []).filter(m => m.isActive).length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-worker-no-payment-methods">Add a payment method to continue.</p> :
            <div className="space-y-2">{methods.data?.filter(m => m.isActive).map(m => {
              const card = m.providerDetails?.card; const bank = m.providerDetails?.us_bank_account;
              return <div key={m.id} className={`flex items-center justify-between rounded-lg border p-3 ${selected === m.id ? "border-primary bg-primary/5" : ""}`} data-testid={`worker-payment-method-${m.id}`}>
                <button type="button" className="flex items-center gap-3 text-left" aria-pressed={selected === m.id} onClick={() => setSelected(m.id)} data-testid={`button-select-worker-payment-method-${m.id}`}>
                  {bank ? <Building2 className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                  <span>{card ? `${card.brand} •••• ${card.last4}` : bank ? `${bank.bank_name || "US bank"} •••• ${bank.last4}` : "Payment method"}</span>
                  {m.isDefault && <Badge variant="secondary"><Star className="mr-1 h-3 w-3" />Default</Badge>}
                </button>
                <div className="flex gap-1">{!m.isDefault && <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(m.id)} aria-label="Set default"><Star className="h-4 w-4" /></Button>}<Button size="sm" variant="ghost" onClick={() => setDeleteId(m.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button></div>
              </div>;
            })}</div>}
          <div className="space-y-2">
            <label htmlFor="worker-payment-amount" className="text-sm font-medium">Payment amount</label>
            <Input
              id="worker-payment-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              max={amount}
              step="0.01"
              aria-invalid={Boolean(paymentAmount && !validAmount)}
              value={paymentAmount}
              onChange={(event) => setPaymentAmount(event.target.value)}
              placeholder={amount.toFixed(2)}
              data-testid="input-worker-payment-amount"
            />
            {paymentAmount && !validAmount && (
              <p className="text-sm text-destructive">Enter an amount greater than $0 and no more than the balance due.</p>
            )}
          </div>
          {!selected && <p className="text-sm text-muted-foreground">Select a saved method, or add one above.</p>}
          <Button disabled={!selected || !validAmount || beginPayment.isPending} onClick={() => beginPayment.mutate()} data-testid="button-worker-start-payment">{beginPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Review and pay</Button></>}
      </CardContent>
    </Card>
    {intent?.clientSecret && !result && <Card><CardHeader><CardTitle>Confirm payment</CardTitle><CardDescription>Complete the secure Stripe confirmation below.</CardDescription></CardHeader><CardContent><WorkerStripePaymentForm clientSecret={intent.clientSecret} publicConfig={intent.publicConfig} amount={enteredAmount.toLocaleString("en-US", { style: "currency", currency: payable.data?.currencyCode ?? "USD" })} onComplete={(status, message) => { setResult(status === "succeeded" ? "processing" : status); if (message) toast({ title: "Payment failed", description: message, variant: "destructive" }); }} /></CardContent></Card>}
    {result && <Card><CardContent className="py-10 text-center space-y-3">{result === "succeeded" ? <Check className="mx-auto h-10 w-10 text-green-600" /> : result === "processing" ? <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" /> : <X className="mx-auto h-10 w-10 text-destructive" />}<h2 className="text-xl font-semibold">{result === "succeeded" ? "Payment successful" : result === "processing" ? "Payment processing" : "Payment failed"}</h2><p className="text-sm text-muted-foreground">{result === "processing" ? "Your payment is being processed. Your balance will update after the funds are recorded." : result === "succeeded" ? "Your payment has been recorded successfully." : "No funds were collected. Please try another payment method."}</p><Button variant="outline" onClick={() => { setResult(undefined); setIntent(undefined); setSelected(undefined); payable.refetch(); methods.refetch(); }}>Make another payment</Button></CardContent></Card>}
    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent><DialogHeader><DialogTitle>Add payment method</DialogTitle><DialogDescription>Your sensitive payment details go directly to Stripe.</DialogDescription></DialogHeader>{!setup ? <Select onValueChange={startSetup}><SelectTrigger data-testid="select-worker-payment-gateway"><SelectValue placeholder="Select a payment method type" /></SelectTrigger><SelectContent>{(gateways.data ?? []).map(g => <SelectItem key={g.id} value={g.id}>{g.name || g.pluginId}</SelectItem>)}</SelectContent></Select> : Add ? <Add clientSecret={setup.clientSecret} publicConfig={setup.publicConfig} onSuccess={(token) => attach.mutate(token)} onCancel={() => setAddOpen(false)} /> : <p className="text-sm text-destructive">This payment provider is not available.</p>}</DialogContent></Dialog>
    <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(undefined)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove payment method?</AlertDialogTitle><AlertDialogDescription>You can add it again later.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteId && remove.mutate(deleteId)}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export default function WorkerLedgerPaymentPage() { return <WorkerLayout activeTab="accounts"><WorkerPaymentContent /></WorkerLayout>; }