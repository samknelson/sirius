import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
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
  id: string; gatewayConfigId: string; isActive: boolean; isDefault: boolean; providerError?: string;
  providerDetails?: { type?: string; card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
    us_bank_account?: { bank_name: string | null; last4: string; account_type: string | null } | null };
};
type Gateway = { id: string; pluginId: string; name: string | null };
type PayableAccount = {
  eaId: string; accountId: string; accountName: string; currencyCode: string;
  gatewayConfigId: string | null; eligible: boolean; error?: string;
};
type Payable = {
  eaId: string; accountId: string; accountName: string; balance: string; currencyCode: string;
  availableBalance: string; reservedAmount: string; gatewayConfigId: string | null;
};
type Setup = { clientSecret: string; componentId: string | null; publicConfig: Record<string, unknown> };
type Intent = {
  id: string; clientSecret: string | null; componentId?: string | null;
  publicConfig: Record<string, unknown>; status?: "requires_action" | "succeeded" | "processing" | "failed";
  checkoutEpoch?: number;
};

const BASE = "/api/ledger/payment-methods";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Payment response is missing ${field}.`);
  return value;
}

function requireMoney(value: unknown, field: string, options: { nonnegative?: boolean } = {}): string {
  const text = requireString(value, field);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`Payment response contains an invalid ${field}.`);
  const number = Number(text);
  if (!Number.isSafeInteger(Math.round(number * 100)) || (options.nonnegative && number < 0)) {
    throw new Error(`Payment response contains an invalid ${field}.`);
  }
  return text;
}

function requireCurrency(value: unknown): string {
  const currencyCode = requireString(value, "currencyCode").toUpperCase();
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(0);
  } catch {
    throw new Error("Payment response contains an unsupported currencyCode.");
  }
  return currencyCode;
}

function parseAccounts(value: unknown): PayableAccount[] {
  if (!Array.isArray(value)) throw new Error("Payment account response is invalid.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Payment account response is invalid.");
    const row = item as Record<string, unknown>;
    if (typeof row.eligible !== "boolean") throw new Error("Payment account response is missing eligibility.");
    return {
      eaId: requireString(row.eaId, "eaId"),
      accountId: requireString(row.accountId, "accountId"),
      accountName: requireString(row.accountName, "accountName"),
      currencyCode: requireCurrency(row.currencyCode),
      gatewayConfigId: row.gatewayConfigId == null ? null : requireString(row.gatewayConfigId, "gatewayConfigId"),
      eligible: row.eligible,
      error: typeof row.error === "string" ? row.error : undefined,
    };
  });
}

function parsePayable(value: unknown): Payable {
  if (!value || typeof value !== "object") throw new Error("Payable balance response is invalid.");
  const row = value as Record<string, unknown>;
  const balance = requireMoney(row.balance, "balance");
  const availableBalance = requireMoney(row.availableBalance, "availableBalance", { nonnegative: true });
  const reservedAmount = requireMoney(row.reservedAmount, "reservedAmount", { nonnegative: true });
  if (Number(availableBalance) > Math.max(0, Number(balance)) + 0.005) {
    throw new Error("Payment response has an available balance greater than the amount due.");
  }
  return {
    eaId: requireString(row.eaId, "eaId"),
    accountId: requireString(row.accountId, "accountId"),
    accountName: requireString(row.accountName, "accountName"),
    balance,
    currencyCode: requireCurrency(row.currencyCode),
    availableBalance,
    reservedAmount,
    gatewayConfigId: row.gatewayConfigId == null ? null : requireString(row.gatewayConfigId, "gatewayConfigId"),
  };
}

function WorkerPaymentContent() {
  const { worker } = useWorkerLayout();
  const search = useSearch();
  const requestedEaId = new URLSearchParams(search).get("eaId");
  const { toast } = useToast();
  const [selectedEaId, setSelectedEaId] = useState<string>();
  const [addOpen, setAddOpen] = useState(false);
  const [gatewayId, setGatewayId] = useState<string>();
  const [setup, setSetup] = useState<Setup>();
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string>();
  const [deleteId, setDeleteId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [intent, setIntent] = useState<Intent>();
  const [result, setResult] = useState<"succeeded" | "processing" | "failed">();
  const [attemptId, setAttemptId] = useState<string>();
  const [paymentAmount, setPaymentAmount] = useState("");
  const accountEpoch = useRef(0);
  const setupGeneration = useRef(0);
  const lastAppliedRequest = useRef<string | null | undefined>(undefined);
  const lastWorkerId = useRef(worker.id);

  const key = ["worker-payment", worker.id];
  const accounts = useQuery<PayableAccount[]>({
    queryKey: [...key, "payable-accounts"],
    queryFn: async () => parseAccounts(await apiRequest("GET", `/api/workers/${worker.id}/ledger/payable-accounts`)),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const methods = useQuery<Method[]>({ queryKey: [...key, "methods"], queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}`) });
  const gateways = useQuery<Gateway[]>({ queryKey: [...key, "gateways"], queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}/gateways`) });
  const selectedAccount = accounts.data?.find((account) => account.eaId === selectedEaId);
  const payable = useQuery<Payable>({
    queryKey: [...key, "payable", selectedEaId],
    queryFn: async () => {
      const value = parsePayable(await apiRequest("GET", `/api/workers/${worker.id}/ledger/payable?eaId=${encodeURIComponent(selectedEaId!)}`));
      if (value.eaId !== selectedEaId || value.accountId !== selectedAccount?.accountId) {
        throw new Error("Payable balance response does not match the selected account.");
      }
      return value;
    },
    enabled: Boolean(selectedEaId && selectedAccount?.eligible),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const resetAccountState = (nextEaId?: string) => {
    accountEpoch.current += 1;
    setupGeneration.current += 1;
    setSelectedEaId(nextEaId);
    setSelected(undefined);
    setPaymentAmount("");
    setIntent(undefined);
    setResult(undefined);
    setAttemptId(undefined);
    setAddOpen(false);
    setGatewayId(undefined);
    setSetup(undefined);
    setSetupError(undefined);
    setSetupLoading(false);
  };

  useEffect(() => {
    if (lastWorkerId.current === worker.id) return;
    lastWorkerId.current = worker.id;
    lastAppliedRequest.current = undefined;
    resetAccountState(undefined);
  }, [worker.id]);

  useEffect(() => {
    if (!accounts.data) return;
    if (lastAppliedRequest.current !== undefined && lastAppliedRequest.current === requestedEaId) return;
    lastAppliedRequest.current = requestedEaId;
    const requested = requestedEaId && accounts.data.some((account) => account.eaId === requestedEaId)
      ? requestedEaId : undefined;
    const only = !requestedEaId && accounts.data.length === 1 ? accounts.data[0].eaId : undefined;
    const nextEaId = requested ?? only;
    if (nextEaId !== selectedEaId) resetAccountState(nextEaId);
  }, [accounts.data, requestedEaId]);

  const attach = useMutation({
    mutationFn: ({ methodToken, setupEpoch, setupGateway }: { methodToken: string; setupEpoch: number; setupGateway: string }) =>
      apiRequest("POST", `${BASE}/worker/${worker.id}`, { gatewayConfigId: setupGateway, methodToken })
        .then((data) => ({ data, setupEpoch })),
    onSuccess: ({ setupEpoch }) => {
      void queryClient.invalidateQueries({ queryKey: [...key, "methods"] });
      if (setupEpoch === setupGeneration.current) {
        setAddOpen(false);
        setSetup(undefined);
      }
    },
    onError: (e, variables) => {
      if (variables.setupEpoch === setupGeneration.current) {
        toast({ title: "Could not save payment method", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" });
      }
    },
  });

  const startSetup = async (id: string) => {
    const epoch = ++setupGeneration.current;
    setGatewayId(id);
    setSetup(undefined);
    setSetupError(undefined);
    setSetupLoading(true);
    try {
      const value = await apiRequest("POST", `${BASE}/worker/${worker.id}/setup`, { gatewayConfigId: id });
      if (epoch !== setupGeneration.current) return;
      if (
        !value || typeof value !== "object" ||
        typeof value.clientSecret !== "string" || !value.clientSecret ||
        (value.componentId !== null && typeof value.componentId !== "string") ||
        !value.publicConfig || typeof value.publicConfig !== "object" || Array.isArray(value.publicConfig)
      ) {
        throw new Error("Payment method setup response is invalid.");
      }
      setSetup(value as Setup);
    } catch (e) {
      if (epoch !== setupGeneration.current) return;
      const message = getApiErrorMessage(e, "Please try again.");
      setSetupError(message);
      toast({ title: "Could not start setup", description: message, variant: "destructive" });
    } finally {
      if (epoch === setupGeneration.current) setSetupLoading(false);
    }
  };

  const beginPayment = useMutation({
    mutationFn: ({ eaId, epoch }: { eaId: string; epoch: number }) => apiRequest("POST", `/api/workers/${worker.id}/ledger/payment-intent`, {
      eaId, amount: paymentAmount, paymentMethodId: selected, idempotencyKey: crypto.randomUUID(),
    }).then((data: Intent) => ({ data, epoch })),
    onSuccess: ({ data, epoch }) => {
      if (epoch !== accountEpoch.current) return;
      setAttemptId(data.id);
      if (data.status === "succeeded" || data.status === "processing") setResult("processing");
      else if (data.status === "failed") setResult("failed");
      else setIntent({ ...data, checkoutEpoch: epoch });
    },
    onError: (e, variables) => {
      if (variables.epoch === accountEpoch.current) {
        toast({ title: "Could not start payment", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" });
      }
    },
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
      void queryClient.invalidateQueries({ queryKey: [...key, "payable"] });
      void queryClient.invalidateQueries({ queryKey: [...key, "payable-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "sitespecific/bao/dp"] });
      void queryClient.invalidateQueries({ queryKey: [`/api/ledger/ea/entity/worker/${worker.id}`] });
    } else if (attemptStatus.data?.status === "failed") setResult("failed");
  }, [attemptStatus.data?.status, result, worker.id]);

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${BASE}/worker/${worker.id}/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [...key, "methods"] }); setDeleteId(undefined); if (selected === deleteId) setSelected(undefined); },
    onError: (e) => toast({ title: "Could not remove payment method", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${BASE}/worker/${worker.id}/${id}/set-default`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [...key, "methods"] }),
    onError: (e) => toast({ title: "Could not set default payment method", description: getApiErrorMessage(e, "Please try again."), variant: "destructive" }),
  });

  const compatibleMethods = useMemo(() => (methods.data ?? []).filter((method) =>
    method.isActive && (!selectedAccount?.gatewayConfigId || method.gatewayConfigId === selectedAccount.gatewayConfigId)
  ), [methods.data, selectedAccount?.gatewayConfigId]);
  const compatibleGateways = useMemo(() => (gateways.data ?? []).filter((gateway) =>
    !selectedAccount?.gatewayConfigId || gateway.id === selectedAccount.gatewayConfigId
  ), [gateways.data, selectedAccount?.gatewayConfigId]);
  const rawAmount = Number(payable.data?.balance);
  const availableAmount = Number(payable.data?.availableBalance);
  const payableReady = payable.isSuccess && !payable.isFetching && payable.data?.eaId === selectedEaId;
  const hasBalance = payableReady && Number.isFinite(rawAmount) && rawAmount > 0.005;
  const hasCredit = payableReady && Number.isFinite(rawAmount) && rawAmount < -0.005;
  const enteredAmount = Number(paymentAmount);
  const validAmount = paymentAmount !== "" && Number.isFinite(enteredAmount) && enteredAmount > 0 && enteredAmount <= availableAmount;
  const Add = setup?.componentId && hasPaymentGatewayComponent(setup.componentId) ? resolvePaymentGatewayComponent(setup.componentId) : null;
  const currency = payable.data?.currencyCode ?? selectedAccount?.currencyCode ?? "USD";
  const money = (number: number) => number.toLocaleString("en-US", { style: "currency", currency });

  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Make a payment</CardTitle><CardDescription>Choose the account whose balance you want to pay.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {accounts.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payment accounts…</div>
          : accounts.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(accounts.error, "Unable to load payment accounts.")} <Button variant="link" className="h-auto p-0" onClick={() => accounts.refetch()}>Retry</Button></AlertDescription></Alert>
          : (accounts.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No payable ledger accounts are configured.</p>
          : <div className="space-y-2"><label className="text-sm font-medium">Account</label>
            <Select value={selectedEaId} onValueChange={resetAccountState}><SelectTrigger data-testid="select-worker-payment-account"><SelectValue placeholder="Select an account" /></SelectTrigger>
              <SelectContent>{accounts.data?.map((account) => <SelectItem key={account.eaId} value={account.eaId}>{account.accountName}{account.error ? ` — ${account.error}` : ""}</SelectItem>)}</SelectContent>
            </Select>
            {!selectedEaId && accounts.data && accounts.data.length > 1 && <p className="text-sm text-muted-foreground">Select an account to review its balance. No account is chosen automatically.</p>}
          </div>}
        {requestedEaId && accounts.data && !accounts.data.some((account) => account.eaId === requestedEaId) && <Alert variant="destructive"><AlertDescription>The requested payment account was not found. Select a valid account to continue.</AlertDescription></Alert>}
        {selectedAccount && !selectedAccount.eligible && <Alert variant="destructive"><AlertDescription>{selectedAccount.error || "This account is not eligible for online payment."}</AlertDescription></Alert>}
        {selectedEaId && selectedAccount?.eligible && (payable.isLoading ? <div className="rounded-lg border p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          : payable.isError ? <Alert variant="destructive"><AlertDescription data-testid="text-worker-payment-error">{getApiErrorMessage(payable.error, "Unable to load this account's payable balance.")} <Button variant="link" className="h-auto p-0" onClick={() => payable.refetch()}>Retry</Button></AlertDescription></Alert>
          : payable.data && <><div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{payable.data.accountName} amount due</p><p className="text-3xl font-semibold" data-testid="text-worker-payment-balance">{money(rawAmount)}</p>
            {Number(payable.data.reservedAmount) > 0.005 && <p className="text-sm text-muted-foreground" data-testid="text-worker-payment-available">{money(availableAmount)} currently available to pay; {money(Number(payable.data.reservedAmount))} is already processing.</p>}</div>
            {hasCredit ? <p className="text-sm text-muted-foreground" data-testid="text-worker-payment-credit">This account has a credit of {money(Math.abs(rawAmount))}; no payment is due.</p>
              : !hasBalance ? <p className="text-sm text-muted-foreground" data-testid="text-worker-payment-paid">You have no balance due on this account.</p>
              : availableAmount <= 0.005 ? <p className="text-sm text-muted-foreground">The full balance already has a payment processing.</p>
              : <div className="space-y-2"><label htmlFor="worker-payment-amount" className="text-sm font-medium">Payment amount</label><Input id="worker-payment-amount" type="number" inputMode="decimal" min="0.01" max={availableAmount} step="0.01" aria-invalid={Boolean(paymentAmount && !validAmount)} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} placeholder={availableAmount.toFixed(2)} data-testid="input-worker-payment-amount" />
                {paymentAmount && !validAmount && <p className="text-sm text-destructive">Enter an amount greater than $0 and no more than the amount currently available to pay.</p>}</div>}
          </>)}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><div className="flex items-center justify-between gap-2"><div><CardTitle>Payment methods</CardTitle><CardDescription>Manage saved cards and US bank accounts, even when no balance is due.</CardDescription></div><Button variant="outline" onClick={() => { setAddOpen(true); setSetup(undefined); setSetupError(undefined); }} data-testid="button-worker-add-payment-method"><Plus className="mr-2 h-4 w-4" />Add payment method</Button></div></CardHeader>
      <CardContent className="space-y-3">
        {methods.isLoading ? <Loader2 className="h-5 w-5 animate-spin" />
          : methods.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(methods.error, "Unable to load saved payment methods.")} <Button variant="link" className="h-auto p-0" onClick={() => methods.refetch()}>Retry</Button></AlertDescription></Alert>
          : compatibleMethods.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-worker-no-payment-methods">{selectedAccount?.gatewayConfigId ? "No saved methods are available for this account." : "Add a payment method to continue."}</p>
          : <div className="space-y-2">{compatibleMethods.map((method) => {
            const card = method.providerDetails?.card; const bank = method.providerDetails?.us_bank_account;
            return <div key={method.id} className={`rounded-lg border p-3 ${selected === method.id ? "border-primary bg-primary/5" : ""}`} data-testid={`worker-payment-method-${method.id}`}>
              <div className="flex items-center justify-between"><button type="button" disabled={Boolean(method.providerError)} className="flex items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60" aria-pressed={selected === method.id} onClick={() => setSelected(method.id)} data-testid={`button-select-worker-payment-method-${method.id}`}>
                {bank ? <Building2 className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}<span>{card ? `${card.brand} •••• ${card.last4}` : bank ? `${bank.bank_name || "US bank"} •••• ${bank.last4}` : "Payment method"}</span>{method.isDefault && <Badge variant="secondary"><Star className="mr-1 h-3 w-3" />Default</Badge>}
              </button><div className="flex gap-1">{!method.isDefault && !method.providerError && <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(method.id)} aria-label="Set default"><Star className="h-4 w-4" /></Button>}<Button size="sm" variant="ghost" onClick={() => setDeleteId(method.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button></div></div>
              {method.providerError && <p className="mt-2 text-sm text-destructive" data-testid={`text-worker-payment-method-error-${method.id}`}>{method.providerError}</p>}
            </div>;
          })}</div>}
        {hasBalance && availableAmount > 0.005 && <><Button disabled={!selected || !validAmount || beginPayment.isPending} onClick={() => selectedEaId && beginPayment.mutate({ eaId: selectedEaId, epoch: accountEpoch.current })} data-testid="button-worker-start-payment">{beginPayment.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Review and pay</Button>{!selected && <p className="text-sm text-muted-foreground">Select a saved method, or add one above.</p>}</>}
      </CardContent>
    </Card>

    {intent?.clientSecret && !result && <Card><CardHeader><CardTitle>Confirm payment</CardTitle><CardDescription>Complete the secure Stripe confirmation below.</CardDescription></CardHeader><CardContent><WorkerStripePaymentForm clientSecret={intent.clientSecret} publicConfig={intent.publicConfig} amount={money(enteredAmount)} onComplete={(status, message) => { if (intent.checkoutEpoch !== accountEpoch.current) return; setResult(status === "succeeded" ? "processing" : status); if (message) toast({ title: "Payment failed", description: message, variant: "destructive" }); }} /></CardContent></Card>}
    {result && <Card><CardContent className="py-10 text-center space-y-3">{result === "succeeded" ? <Check className="mx-auto h-10 w-10 text-green-600" /> : result === "processing" ? <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" /> : <X className="mx-auto h-10 w-10 text-destructive" />}<h2 className="text-xl font-semibold">{result === "succeeded" ? "Payment successful" : result === "processing" ? "Payment processing" : "Payment failed"}</h2><p className="text-sm text-muted-foreground">{result === "processing" ? "Your payment is being processed. Your balance will update after the funds are recorded." : result === "succeeded" ? "Your payment has been recorded successfully." : "No funds were collected. Please try another payment method."}</p><Button variant="outline" onClick={() => { setResult(undefined); setIntent(undefined); setSelected(undefined); }}>Make another payment</Button></CardContent></Card>}
    <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) { setupGeneration.current += 1; setSetup(undefined); setSetupLoading(false); setSetupError(undefined); } }}><DialogContent><DialogHeader><DialogTitle>Add payment method</DialogTitle><DialogDescription>Your sensitive payment details go directly to the payment provider.</DialogDescription></DialogHeader>
      {gateways.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payment providers…</div>
        : gateways.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(gateways.error, "Unable to load payment providers.")} <Button variant="link" className="h-auto p-0" onClick={() => gateways.refetch()}>Retry</Button></AlertDescription></Alert>
        : compatibleGateways.length === 0 ? <Alert variant="destructive"><AlertDescription>No payment provider is configured for this account. Contact an administrator to configure online payments.</AlertDescription></Alert>
        : !setup && !setupLoading ? <><Select value={gatewayId} onValueChange={startSetup}><SelectTrigger data-testid="select-worker-payment-gateway"><SelectValue placeholder="Select a payment method type" /></SelectTrigger><SelectContent>{compatibleGateways.map((gateway) => <SelectItem key={gateway.id} value={gateway.id}>{gateway.name || gateway.pluginId}</SelectItem>)}</SelectContent></Select>{setupError && <Alert variant="destructive"><AlertDescription>{setupError} {gatewayId && <Button variant="link" className="h-auto p-0" onClick={() => startSetup(gatewayId)}>Retry</Button>}</AlertDescription></Alert>}</>
        : setupLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Starting secure setup…</div>
        : Add && setup && gatewayId ? <Add clientSecret={setup.clientSecret} publicConfig={setup.publicConfig} onSuccess={(token) => attach.mutateAsync({ methodToken: token, setupEpoch: setupGeneration.current, setupGateway: gatewayId }).then(() => undefined)} onCancel={() => setAddOpen(false)} />
        : <Alert variant="destructive"><AlertDescription>This payment provider is not available. {gatewayId && <Button variant="link" className="h-auto p-0" onClick={() => startSetup(gatewayId)}>Retry</Button>}</AlertDescription></Alert>}
    </DialogContent></Dialog>
    <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(undefined)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove payment method?</AlertDialogTitle><AlertDialogDescription>You can add it again later.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteId && remove.mutate(deleteId)}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export default function WorkerLedgerPaymentPage() { return <WorkerLayout activeTab="accounts"><WorkerPaymentContent /></WorkerLayout>; }