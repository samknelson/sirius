import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { hasPaymentGatewayPayComponent, resolvePaymentGatewayPayComponent } from "@/plugins/payment-gateway/registry";
import { calculateCheckoutSelection, type CheckoutQuote, type CheckoutSelectionInput } from "@shared/ledger/checkout-selection";
import { useAuth } from "@/contexts/AuthContext";

type Statement = { invoiceNumber: string; month: number; year: number; invoiceBalance: string };
type Readiness = {
  paymentAuthorization: "ready" | "configuration_required";
  methodPermission: "allowed" | "denied";
  reusableMethods: "supported" | "unsupported";
  saveMethod: "ready" | "permission_denied" | "configuration_required" | "provider_unsupported";
};
type Checkout = {
  entityType: "worker" | "employer"; entityId: string; eaId: string;
  account: { name: string; currency: string; gatewayConfigId: string };
  balance: string; available: string; invoices: Statement[]; paymentTypes: string[];
  payComponentId: string | null; reusableMethodsSupported: boolean; settings: { allowPartial: boolean; minAmount: number };
  authorization: { version: string; text: string } | null; readiness?: Readiness;
  selectionInput: CheckoutSelectionInput; quote: CheckoutQuote;
};
type Method = { id: string; gatewayConfigId: string; isActive: boolean; providerError?: string; providerDetails?: { card?: { brand: string; last4: string }; us_bank_account?: { bank_name: string; last4: string } } };
type Session = { id: string; status: string; clientSecret: string | null; publicConfig?: Record<string, unknown> };
const money = (value: string | number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));

export default function SharedCheckoutPage() {
  const { eaId } = useParams<{ eaId: string }>();
  const [, navigate] = useLocation();
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission("admin");
  const [choice, setChoice] = useState<"full" | "statements">("full");
  const [statementIds, setStatementIds] = useState<string[]>([]);
  const [method, setMethod] = useState("");
  const [save, setSave] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [review, setReview] = useState(false);
  const [session, setSession] = useState<Session>();
  const [lockedQuote, setLockedQuote] = useState<CheckoutQuote>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seeded = useRef(false);
  const authorizationSnapshot = useRef<string | null>(null);
  const quoteSnapshot = useRef<string | null>(null);
  const generation = useRef(0);
  const submitting = useRef(false);
  const invoiceSelection = new URLSearchParams(window.location.search).get("invoice");
  const ea = useQuery<{ entityType: string; entityId: string }>({ queryKey: ["checkout-ea", eaId], queryFn: () => apiRequest("GET", `/api/ledger/ea/${encodeURIComponent(eaId)}`) });
  const scope = ea.data?.entityType === "worker" || ea.data?.entityType === "employer" ? `${ea.data.entityType}/${ea.data.entityId}` : null;
  const checkout = useQuery<Checkout>({ queryKey: ["checkout", scope, eaId], queryFn: () => apiRequest("GET", `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}`), enabled: !!scope, refetchOnMount: "always" });
  const methods = useQuery<Method[]>({ queryKey: ["checkout-methods", scope], queryFn: () => apiRequest("GET", `/api/ledger/payment-methods/${scope}`), enabled: !!scope, retry: false });
  const data = checkout.data;
  const currency = data?.account.currency ?? "USD";
  // Keep credit-covered statements in the choice list. They can be settled in
  // full by an explicit source-to-target transfer even when their cash amount
  // is zero, and hiding them would make the full-balance result misleading.
  const payableStatements = useMemo(() => data?.quote.statements.filter(statement => Number(statement.due) > 0 && !statement.reserved) ?? [], [data?.quote.statements]);
  // This is the shared server/client calculator. The session endpoint
  // recalculates the same quote while locking the attempt; the browser only
  // renders its result and never owns allocation arithmetic.
  const breakdown = useMemo(() => data ? calculateCheckoutSelection(data.selectionInput, {
    mode: choice, invoiceNumbers: choice === "full" ? [] : statementIds,
  }) : undefined, [choice, data, statementIds]);
  const compatibleMethods = methods.data?.filter(item => item.isActive && !item.providerError && item.gatewayConfigId === data?.account.gatewayConfigId && (item.providerDetails?.card ? data?.paymentTypes.includes("card") : item.providerDetails?.us_bank_account ? data?.paymentTypes.includes("us_bank_account") : false)) ?? [];
  const chosenMethod = compatibleMethods.find(item => item.id === method);
  const authReady = data?.readiness ? data.readiness.paymentAuthorization === "ready" : !!data?.authorization;
  const saveReady = data?.readiness ? data.readiness.saveMethod === "ready" : !!data?.reusableMethodsSupported && authReady;
  const Pay = data?.payComponentId && hasPaymentGatewayPayComponent(data.payComponentId) ? resolvePaymentGatewayPayComponent(data.payComponentId) : null;
  const frozen = !!session || submitting.current;
  const change = (update: () => void) => {
    if (frozen) return;
    generation.current++;
    setReview(false);
    setAccepted(false);
    setError("");
    update();
  };
  useEffect(() => {
    seeded.current = false; generation.current++; setChoice("full"); setStatementIds([]); setMethod(""); setSave(false); setAccepted(false); setReview(false); setSession(undefined); setLockedQuote(undefined); setError("");
  }, [eaId]);
  useEffect(() => {
    if (!data || seeded.current) return;
    seeded.current = true;
    if (!invoiceSelection) return;
    const statement = payableStatements.find(item => item.invoiceNumber === invoiceSelection);
    if (statement && data.settings.allowPartial) { setChoice("statements"); setStatementIds([statement.invoiceNumber]); }
    else if (statement) setError("This account requires payment of the full available balance.");
    else setError("That statement is no longer payable. Review the current balance before continuing.");
  }, [data, invoiceSelection, payableStatements]);
  // Consent belongs to the exact approved wording/version, and a review must
  // always describe the latest server quote after a background refetch.
  useEffect(() => {
    if (!data) return;
    const nextAuthorization = data.authorization ? `${data.authorization.version}\u0000${data.authorization.text}` : null;
    if (authorizationSnapshot.current !== null && authorizationSnapshot.current !== nextAuthorization) {
      setAccepted(false);
      setReview(false);
    }
    authorizationSnapshot.current = nextAuthorization;
    const nextQuote = JSON.stringify(data.quote);
    if (quoteSnapshot.current !== null && quoteSnapshot.current !== nextQuote) setReview(false);
    quoteSnapshot.current = nextQuote;
  }, [data]);
  const toggleStatement = (id: string) => change(() => {
    setChoice("statements");
    setStatementIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  });
  const selectionReady = !!breakdown && !breakdown.issues.length && (choice === "full" || statementIds.length > 0);
  const shownBreakdown = session && lockedQuote ? lockedQuote : breakdown;
  const canReview = selectionReady && authReady && !!data?.paymentTypes.length && (!save || saveReady) && (method ? !!chosenMethod : !!Pay);
  const submit = async () => {
    if (!data || !scope || !breakdown || !canReview || !accepted || (method && !chosenMethod) || (save && !saveReady) || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const created: Session = await apiRequest("POST", `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}/sessions`, {
        selection: { mode: choice, invoiceNumbers: choice === "full" ? [] : statementIds },
        amount: breakdown.amount, statementSelection: breakdown.statementSelection,
        creditTransfers: breakdown.creditTransfers,
        paymentMethodId: method || undefined, saveMethod: save, consent: { ...data.authorization, accepted: true }, idempotencyKey: crypto.randomUUID(),
      });
      if (current !== generation.current || created.status !== "requires_action") navigate(`/pay/receipt/${encodeURIComponent(created.id)}`);
      else if (created.clientSecret && Pay) { setLockedQuote(breakdown); setSession(created); }
      else { setLockedQuote(breakdown); setSession(created); setError("Secure payment confirmation is unavailable. Use the payment status link below."); }
    } catch (cause) { if (current === generation.current) setError(getApiErrorMessage(cause, "Could not start payment. Please try again.")); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (ea.isLoading || checkout.isLoading) return <main className="mx-auto w-full max-w-xl p-4" role="status">Loading checkout…</main>;
  if (ea.isError || checkout.isError || !data) return <main className="mx-auto w-full max-w-xl p-4"><Alert variant="destructive"><AlertDescription>{getApiErrorMessage(ea.error || checkout.error, "Online payment is unavailable for this account.")}</AlertDescription></Alert><Button variant="outline" className="mt-4" onClick={() => { void ea.refetch(); void checkout.refetch(); }}>Retry</Button></main>;
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6" aria-label="Checkout">
    <header><h1 className="text-2xl font-semibold">Make a payment</h1><p className="mt-1 break-words text-muted-foreground">{data.account.name}</p></header>
    <Card><CardContent className="space-y-1 pt-6 text-sm"><p>Posted balance: {money(data.quote.postedBalance, currency)}</p><p>Pending payments: {money(data.quote.pendingPayments, currency)}</p><p className="font-medium">Available to pay: {money(data.quote.available, currency)}</p></CardContent></Card>
    {Number(data.quote.available) <= 0 ? <Alert><AlertDescription>No payment is currently available. Pending payments or account credits may be covering this balance.</AlertDescription></Alert> : <>
      <Card><CardHeader><CardTitle className="text-lg">Choose what to pay</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="flex items-start gap-3 rounded-md border p-3"><input type="radio" name="payment-choice" checked={choice === "full"} disabled={frozen} onChange={() => change(() => setChoice("full"))} /><span><span className="block font-medium">Pay full balance</span><span className="text-sm text-muted-foreground">Apply the current payable balance across eligible statements and account debt.</span></span></label>
        {data.settings.allowPartial && <fieldset className="space-y-2"><legend className="sr-only">Pay selected statements</legend><label className="flex items-start gap-3 rounded-md border p-3"><input type="radio" name="payment-choice" checked={choice === "statements"} disabled={frozen} onChange={() => change(() => setChoice("statements"))} /><span><span className="block font-medium">Pay selected statements</span><span className="text-sm text-muted-foreground">Each statement is settled in full by its cash payment and any listed account-credit transfer. Partial statement payments are not available.</span></span></label>
          {choice === "statements" && <div className="space-y-2 pl-1">{payableStatements.length ? payableStatements.map(statement => <label key={statement.invoiceNumber} className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={statementIds.includes(statement.invoiceNumber)} disabled={frozen} onCheckedChange={() => toggleStatement(statement.invoiceNumber)} /><span className="min-w-0 break-words">{statement.statementYmd.slice(5, 7)}/{statement.statementYmd.slice(0, 4)} · {statement.invoiceNumber}<span className="mt-1 block font-medium">{money(statement.payable, currency)} due</span>{Number(statement.creditAdjustment) > 0 && <span className="mt-1 block text-muted-foreground">Includes {money(statement.creditAdjustment, currency)} in account credits.</span>}</span></label>) : <p className="text-sm text-muted-foreground">There are no outstanding statements to select. Pay the full balance to cover any account-level debt.</p>}</div>}
        </fieldset>}
        {!data.settings.allowPartial && <p className="text-sm text-muted-foreground">This account requires payment of the full available balance.</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Payment total</CardTitle></CardHeader><CardContent className="space-y-2">
        {shownBreakdown ? <><p className="text-2xl font-semibold">{money(shownBreakdown.amount, currency)}</p>{shownBreakdown.statements.filter(item => item.selected).map(item => <p key={item.invoiceNumber} className="flex justify-between gap-4 text-sm"><span className="min-w-0 break-words">{item.invoiceNumber}<span className="block text-muted-foreground">Statement due {money(item.due, currency)}</span></span><span>{money(item.payable, currency)} cash</span></p>)}{shownBreakdown.creditTransfers.length > 0 && <div className="rounded-md border p-3 text-sm"><p className="font-medium">Account-credit transfers</p>{shownBreakdown.creditTransfers.map(transfer => <p key={`${transfer.sourceInvoiceNumber}-${transfer.targetInvoiceNumber}-${transfer.amount}`} className="mt-1 break-words">{money(transfer.amount, currency)} from {transfer.sourceInvoiceNumber} ({transfer.sourceStatementYmd}) to {transfer.targetInvoiceNumber} ({transfer.targetStatementYmd})</p>)}<p className="mt-2 text-muted-foreground">The listed transfer and cash payment settle the selected statements in full.</p></div>}{Number(shownBreakdown.unstatementedAmount) > 0 && <p className="text-sm">Account debt not tied to a statement: {money(shownBreakdown.unstatementedAmount, currency)}</p>}{shownBreakdown.issues.length > 0 && <Alert variant="destructive"><AlertDescription>{shownBreakdown.issues.join(" ")}</AlertDescription></Alert>}</> : <p className="text-sm text-muted-foreground">{choice === "statements" && !statementIds.length ? "Select at least one outstanding statement." : "This selection changed. Refresh the checkout to get its current total."}</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Payment method</CardTitle></CardHeader><CardContent className="space-y-3">
        {methods.isLoading ? <p role="status">Loading saved methods…</p> : null}
        {methods.isError ? <Alert variant="destructive"><AlertDescription>Saved methods could not be loaded. <Button variant="link" onClick={() => void methods.refetch()}>Retry</Button></AlertDescription></Alert> : null}
        {data.readiness?.methodPermission === "denied" && <p className="text-sm text-muted-foreground">You do not have permission to manage or save payment methods for this account.</p>}
        <label className="flex items-center gap-2"><input type="radio" name="method" checked={!method} disabled={frozen} onChange={() => change(() => { setMethod(""); setSave(false); })} />{data.paymentTypes.includes("us_bank_account") ? "New bank transfer (recommended)" : "New card"}</label>
        {compatibleMethods.map(item => <label key={item.id} className="flex items-center gap-2 break-words"><input type="radio" name="method" checked={method === item.id} disabled={frozen} onChange={() => change(() => { setMethod(item.id); setSave(false); })} />{item.providerDetails?.card ? `${item.providerDetails.card.brand} •••• ${item.providerDetails.card.last4}` : `${item.providerDetails?.us_bank_account?.bank_name || "Bank"} •••• ${item.providerDetails?.us_bank_account?.last4}`}</label>)}
        {!method && <label className="flex items-center gap-2 text-sm"><Checkbox checked={save} disabled={!saveReady || frozen} onCheckedChange={value => change(() => setSave(value === true))} />Save this method for future payments</label>}
        {!method && !saveReady && <p className="text-sm text-muted-foreground">{data.readiness?.saveMethod === "permission_denied" ? "You do not have permission to save payment methods for this account." : data.readiness?.saveMethod === "provider_unsupported" ? "This payment provider does not support saving methods for this account." : data.readiness?.saveMethod === "configuration_required" ? "Saving requires current payment authorization." : "Saving methods is not enabled for this account."}</p>}
        {!data.paymentTypes.length && <Alert variant="destructive"><AlertDescription>No payment types are available for this account.</AlertDescription></Alert>}
      </CardContent></Card>
      <Card><CardContent className="space-y-4 pt-6">
        {!authReady ? <Alert variant="destructive"><AlertDescription>Payment authorization wording has not been configured. An administrator must finish ledger payment settings before online payments can be made.{isAdmin && <> <Link href="/config/ledger/settings#payment-authorization" className="font-medium underline">Open payment authorization settings</Link></>}</AlertDescription></Alert> : <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} disabled={frozen} onCheckedChange={value => change(() => setAccepted(value === true))} /><span>{data.authorization?.text}</span></label>}
        {review ? <div className="space-y-3"><h2 className="font-semibold">Review payment</h2><p className="text-sm">{shownBreakdown && `${money(shownBreakdown.amount, currency)} to ${data.account.name}`} using {method ? "a saved method" : "a new method"}{save ? ", saved for future use" : ""}.</p><div className="flex flex-col gap-2 sm:flex-row"><Button onClick={() => void submit()} disabled={busy || frozen || !canReview || !accepted}>{busy ? "Starting…" : "Submit payment"}</Button><Button variant="outline" onClick={() => setReview(false)} disabled={busy || frozen}>Edit</Button></div></div> : <Button onClick={() => setReview(true)} disabled={!canReview || !accepted}>Review payment</Button>}
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      </CardContent></Card>
    </>}
    {session && <Card><CardHeader><CardTitle>Secure payment confirmation</CardTitle></CardHeader><CardContent>{Pay && session.clientSecret ? <Pay clientSecret={session.clientSecret} publicConfig={{ ...session.publicConfig, preferredPaymentType: data.entityType === "employer" ? "us_bank_account" : undefined }} amount={shownBreakdown ? money(shownBreakdown.amount, currency) : ""} savedMethod={!!method} returnUrl={`${window.location.origin}/pay/receipt/${encodeURIComponent(session.id)}`} onComplete={(status, message) => status === "failed" ? setError(message || "Provider confirmation failed.") : navigate(`/pay/receipt/${encodeURIComponent(session.id)}`)} /> : <p role="alert">Provider confirmation is unavailable. Use the status link below or contact support with confirmation {session.id}.</p>}<Link href={`/pay/receipt/${encodeURIComponent(session.id)}`} className="mt-3 inline-block underline">Check this payment's status</Link></CardContent></Card>}
    {data.entityType === "worker" ? <Link href={`/workers/${data.entityId}/ledger/accounts`} className="inline-block text-sm underline">Back to accounts</Link> : <Link href={`/ea/${eaId}`} className="inline-block text-sm underline">Back to account</Link>}
  </main>;
}