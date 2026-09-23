import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { resolvePaymentGatewayPayComponent, hasPaymentGatewayPayComponent } from "@/plugins/payment-gateway/registry";

type Invoice = { invoiceNumber: string; month: number; year: number; invoiceBalance: string };
type Checkout = {
  entityType: "worker" | "employer"; entityId: string; eaId: string;
  account: { name: string; currency: string; gatewayConfigId: string }; balance: string; available: string;
  invoices: Invoice[]; paymentTypes: string[]; payComponentId: string | null; reusableMethodsSupported: boolean;
  settings: { allowPartial: boolean; minAmount: number };
  authorization: { version: string; text: string } | null;
};
type Method = { id: string; gatewayConfigId: string; isActive: boolean; providerError?: string; providerDetails?: {
  card?: { brand: string; last4: string }; us_bank_account?: { bank_name: string; last4: string };
} };
type Session = { id: string; status: string; clientSecret: string | null; publicConfig?: Record<string, unknown> };
const amountPattern = /^\d+(?:\.\d{1,2})?$/;
const cents = (value: string) => amountPattern.test(value) ? Math.round(Number(value) * 100) : NaN;
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

export default function SharedCheckoutPage() {
  const { eaId } = useParams<{ eaId: string }>();
  const [, navigate] = useLocation();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [save, setSave] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [review, setReview] = useState(false);
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const ea = useQuery<{ entityType: string; entityId: string }>({
    queryKey: ["checkout-ea", eaId],
    queryFn: () => apiRequest("GET", `/api/ledger/ea/${encodeURIComponent(eaId)}`),
  });
  const scope = ea.data?.entityType === "worker" || ea.data?.entityType === "employer"
    ? `${ea.data.entityType}/${ea.data.entityId}` : null;
  const checkout = useQuery<Checkout>({
    queryKey: ["checkout", scope, eaId],
    queryFn: () => apiRequest("GET", `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}`),
    enabled: !!scope,
    refetchOnMount: "always",
  });
  const methods = useQuery<Method[]>({
    queryKey: ["checkout-methods", scope],
    queryFn: () => apiRequest("GET", `/api/ledger/payment-methods/${scope}`),
    enabled: !!scope,
  });
  const authority = useQuery<{ authorization: { version: string; text: string } | null }>({
    queryKey: ["checkout-method-authority", scope],
    queryFn: () => apiRequest("GET", `/api/ledger/payment-methods/${scope}/authorization`),
    enabled: !!scope,
    retry: false,
  });
  const data = checkout.data;
  const available = Number(data?.available ?? 0);
  const due = Number(data?.balance ?? 0);
  const currency = data?.account.currency ?? "USD";
  const selected = Object.entries(allocations).filter(([, value]) => value !== "");
  const invoiceMap = new Map(data?.invoices.map((i) => [i.invoiceNumber, i]) ?? []);
  const allocated = selected.reduce((sum, [id, value]) => {
    const valueCents = cents(value);
    const max = cents(invoiceMap.get(id)?.invoiceBalance ?? "");
    return sum + (Number.isFinite(valueCents) && valueCents > 0 && valueCents <= max ? valueCents : NaN);
  }, 0);
  const entered = cents(amount);
  const valid = Number.isFinite(entered) && entered >= (data?.settings.minAmount ?? 1) * 100 &&
    entered <= Math.round(available * 100) &&
    (data?.settings.allowPartial || entered === Math.round(available * 100)) &&
    (!selected.length || allocated === entered);
  const compatibleMethods = methods.data?.filter(m => m.isActive && !m.providerError &&
    m.gatewayConfigId === data?.account.gatewayConfigId &&
    (m.providerDetails?.card ? data?.paymentTypes.includes("card") :
      m.providerDetails?.us_bank_account ? data?.paymentTypes.includes("us_bank_account") : false)) ?? [];
  const chosenMethod = compatibleMethods.find((m) => m.id === method);
  const canSave = !method && !!data?.reusableMethodsSupported && !!authority.data?.authorization &&
    authority.data.authorization.version === data?.authorization?.version &&
    authority.data.authorization.text === data.authorization.text;
  const Pay = data?.payComponentId && hasPaymentGatewayPayComponent(data.payComponentId)
    ? resolvePaymentGatewayPayComponent(data.payComponentId) : null;
  // A changed choice invalidates the provider intent. Never confirm a secret
  // created for an older amount, allocation, method, or authorization.
  const change = (update: () => void) => {
    if (session || submitting.current) return;
    generation.current++;
    setSession(undefined);
    setReview(false);
    setError("");
    update();
  };
  useEffect(() => {
    generation.current++;
    setSession(undefined);
    setAmount("");
    setMethod("");
    setAllocations({});
    setSave(false);
    setAccepted(false);
    setReview(false);
  }, [eaId]);
  const submit = async () => {
    if (!data || !scope || !valid || !accepted || (method && !chosenMethod) || (save && !canSave) || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const created: Session = await apiRequest("POST", `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}/sessions`, {
        amount, paymentMethodId: method || undefined, saveMethod: save,
        consent: { ...data.authorization, accepted: true },
        statementSelection: selected.map(([invoiceNumber, value]) => ({ invoiceNumber, amount: value })),
        idempotencyKey: crypto.randomUUID(),
      });
      if (current !== generation.current) {
        // An in-flight request may reserve funds. Keep its receipt accessible.
        navigate(`/pay/receipt/${encodeURIComponent(created.id)}`);
      } else if (created.status !== "requires_action") {
        navigate(`/pay/receipt/${encodeURIComponent(created.id)}`);
      } else if (created.clientSecret && Pay) {
        setSession(created);
      } else {
        // Do not strand a payment requiring browser action on a polling-only
        // receipt. A missing secret or component is a configuration error.
        setError("Secure payment confirmation is unavailable. Contact support with this payment's confirmation number.");
        setSession(created);
      }
    } catch (cause) {
      if (current === generation.current) setError(getApiErrorMessage(cause, "Could not start payment. Please try again."));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  if (ea.isLoading || checkout.isLoading) return <main className="mx-auto max-w-xl p-4" role="status">Loading checkout…</main>;
  if (ea.isError || checkout.isError || !data) return <main className="mx-auto max-w-xl p-4"><Alert variant="destructive"><AlertDescription>{getApiErrorMessage(ea.error || checkout.error, "Online payment is unavailable for this account.")}</AlertDescription></Alert><Button variant="outline" className="mt-4" onClick={() => { void ea.refetch(); void checkout.refetch(); }}>Retry</Button></main>;
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4" aria-label="Checkout">
    <h1 className="text-2xl font-semibold">Make a payment</h1>
    <p className="break-words">{data.account.name}</p>
    <Card><CardContent className="space-y-1 pt-6 text-sm">
      <p>Posted balance: {money(due, currency)}</p>
      <p>Pending payments: {money(Math.max(0, due - available), currency)}</p>
      <p className="font-medium">Available to pay: {money(available, currency)}</p>
    </CardContent></Card>
    {available <= 0 ? <p>No amount is currently available to pay.</p> : <>
      <Card><CardHeader><CardTitle className="text-lg">Amount and statements</CardTitle></CardHeader><CardContent className="space-y-4">
        <div><label htmlFor="checkout-amount" className="block text-sm font-medium">Payment amount</label>
          <Input id="checkout-amount" type="number" min={data.settings.minAmount} max={available} step="0.01" inputMode="decimal" value={amount} disabled={!!session || busy} onChange={e => change(() => setAmount(e.target.value))} aria-invalid={!!amount && !valid} />
          <p className="text-sm text-muted-foreground">{data.settings.allowPartial ? `Minimum ${money(data.settings.minAmount, currency)}` : "Full available balance required"}</p>
        </div>
        {!!data.invoices.length && <fieldset className="space-y-2"><legend className="font-medium">Apply to statements (optional)</legend>
          <p className="text-sm text-muted-foreground">Leave all blank to pay the general balance. Selected amounts must total your payment.</p>
          {data.invoices.filter(i => Number(i.invoiceBalance) > 0).map(i => <div key={i.invoiceNumber} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
            <label htmlFor={`invoice-${i.invoiceNumber}`} className="min-w-0 text-sm">{i.month}/{i.year} · {i.invoiceNumber} · {money(Number(i.invoiceBalance), currency)} due</label>
            <Input id={`invoice-${i.invoiceNumber}`} type="number" inputMode="decimal" step="0.01" min="0" max={i.invoiceBalance} className="w-28" placeholder="Apply" aria-label={`Amount for statement ${i.invoiceNumber}`} value={allocations[i.invoiceNumber] ?? ""} disabled={!!session || busy} onChange={e => change(() => setAllocations(a => ({ ...a, [i.invoiceNumber]: e.target.value })))} />
          </div>)}
        </fieldset>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Payment method</CardTitle></CardHeader><CardContent className="space-y-3">
        {methods.isLoading ? <p role="status">Loading saved methods…</p> : methods.isError ? <Alert variant="destructive"><AlertDescription>Saved methods could not be loaded. <Button variant="link" onClick={() => void methods.refetch()}>Retry</Button></AlertDescription></Alert> : null}
        <label className="flex items-center gap-2"><input type="radio" name="method" checked={!method} disabled={!!session || busy} onChange={() => change(() => { setMethod(""); setSave(false); })} />New card or bank account</label>
        {compatibleMethods.map(m => <label key={m.id} className="flex items-center gap-2 break-words"><input type="radio" name="method" checked={method === m.id} disabled={!!session || busy} onChange={() => change(() => { setMethod(m.id); setSave(false); })} />{m.providerDetails?.card ? `${m.providerDetails.card.brand} •••• ${m.providerDetails.card.last4}` : m.providerDetails?.us_bank_account ? `${m.providerDetails.us_bank_account.bank_name || "Bank"} •••• ${m.providerDetails.us_bank_account.last4}` : "Saved method"}</label>)}
        {!method && <label className="flex items-center gap-2 text-sm"><Checkbox checked={save} disabled={!canSave || !!session || busy} onCheckedChange={value => change(() => setSave(value === true))} />Save this method for future payments</label>}
        {!canSave && !method && <p className="text-sm text-muted-foreground">Saving is unavailable for this account or your access level. This payment can still be made without saving.</p>}
        {data.paymentTypes.length === 0 && <Alert variant="destructive"><AlertDescription>No payment types are available for this account.</AlertDescription></Alert>}
      </CardContent></Card>
      <Card><CardContent className="space-y-4 pt-6">
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} disabled={!data.authorization || !!session || busy} onCheckedChange={value => change(() => setAccepted(value === true))} /><span>{data.authorization?.text ?? "Payment authorization is not configured. Contact an administrator."}</span></label>
        {review ? <div className="space-y-3"><h2 className="font-semibold">Review payment</h2><p>{money(entered / 100, currency)} to {data.account.name} using {method ? "a saved method" : "a new method"}{save ? ", saved for future use" : ""}.</p>
          <Button onClick={() => void submit()} disabled={busy || !!session || !valid || !accepted || !data.paymentTypes.length || (!method && !Pay)}>{busy ? "Starting…" : "Submit payment"}</Button>
          <Button variant="outline" onClick={() => setReview(false)} disabled={busy || !!session}>Edit</Button>
        </div> : <Button onClick={() => setReview(true)} disabled={!valid || !accepted || !data.paymentTypes.length || (!method && !Pay)}>Review payment</Button>}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      </CardContent></Card>
    </>}
    {session && <Card><CardHeader><CardTitle>Secure payment confirmation</CardTitle></CardHeader><CardContent>
      {Pay && session.clientSecret && <Pay clientSecret={session.clientSecret} publicConfig={session.publicConfig ?? {}} amount={money(entered / 100, currency)}
        savedMethod={!!method}
        returnUrl={`${window.location.origin}/pay/receipt/${encodeURIComponent(session.id)}`}
        onComplete={(status, message) => {
          if (status === "failed") setError(message || "Provider confirmation failed. Please retry the secure payment form.");
          else navigate(`/pay/receipt/${encodeURIComponent(session.id)}`);
        }} />}
      {(!Pay || !session.clientSecret) && <p role="alert">Provider confirmation is unavailable. Use the status link below or contact support with confirmation {session.id}.</p>}
      <Link href={`/pay/receipt/${encodeURIComponent(session.id)}`} className="mt-3 inline-block underline">Check this payment's status</Link>
    </CardContent></Card>}
    {data.entityType === "worker" && <Link href={`/workers/${data.entityId}/ledger/accounts`} className="inline-block text-sm underline">Back to accounts</Link>}
  </main>;
}