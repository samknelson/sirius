import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { hasPaymentGatewayPayComponent, resolvePaymentGatewayPayComponent } from "@/plugins/payment-gateway/registry";
import { calculateCheckoutSelection, type CheckoutQuote, type CheckoutSelectionInput } from "@shared/ledger/checkout-selection";
import { CHECKOUT_SAVE_METHOD_CONSENT } from "@shared/ledger/checkout-save-consent";
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
  pendingCheckouts?: { id: string; amount: string; currency: string; status: string }[];
};
type Method = { id: string; gatewayConfigId: string; isActive: boolean; providerError?: string; providerDetails?: { card?: { brand: string; last4: string }; us_bank_account?: { bank_name: string; last4: string } } };
type Session = { id: string; status: string; clientSecret: string | null; publicConfig?: Record<string, unknown> };
const money = (value: string | number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));

export default function SharedCheckoutPage() {
  const { eaId, entityType, entityId } = useParams<{ eaId: string; entityType?: "worker" | "employer"; entityId?: string }>();
  const [location, navigate] = useLocation();
  const isAdminTest = location.startsWith("/admin-test-pay/");
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = hasPermission("admin");
  const [choice, setChoice] = useState<"full" | "statements">("full");
  const [statementIds, setStatementIds] = useState<string[]>([]);
  const [method, setMethod] = useState("");
  const [purpose, setPurpose] = useState("");
  const [newType, setNewType] = useState<"card" | "us_bank_account" | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saveMethodAccepted, setSaveMethodAccepted] = useState(false);
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
  const providerSection = useRef<HTMLDivElement>(null);
  const invoiceSelection = new URLSearchParams(window.location.search).get("invoice");
  const ea = useQuery<{ entityType: string; entityId: string }>({
    queryKey: ["checkout-ea", eaId],
    queryFn: () => apiRequest("GET", `/api/ledger/ea/${encodeURIComponent(eaId)}`),
    enabled: !isAdminTest,
  });
  const scope = isAdminTest
    ? entityType && entityId ? `${entityType}/${entityId}` : null
    : ea.data?.entityType === "worker" || ea.data?.entityType === "employer" ? `${ea.data.entityType}/${ea.data.entityId}` : null;
  const checkoutPath = isAdminTest
    ? `/api/ledger/admin-test-checkout/${encodeURIComponent(entityType ?? "")}/${encodeURIComponent(entityId ?? "")}/${encodeURIComponent(eaId)}`
    : `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}`;
  const checkout = useQuery<Checkout & { isAdminTest?: boolean; testMode?: boolean }>({
    queryKey: ["checkout", isAdminTest ? "admin-test" : scope, eaId],
    queryFn: () => apiRequest("GET", checkoutPath),
    enabled: !!scope && !!eaId, refetchOnMount: "always",
  });
  const methods = useQuery<Method[]>({
    queryKey: ["checkout-methods", scope],
    queryFn: () => apiRequest("GET", `/api/ledger/payment-methods/${scope}`),
    enabled: !isAdminTest && !!scope, retry: false,
  });
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
  const unavailableMethods = (methods.data?.length ?? 0) - compatibleMethods.length;
  const chosenMethod = compatibleMethods.find(item => item.id === method);
  const selectedNewType = newType ?? (data?.paymentTypes.includes("card") ? "card" : data?.paymentTypes.includes("us_bank_account") ? "us_bank_account" : null);
  const methodDescription = method
    ? chosenMethod?.providerDetails?.card ? "saved card" : "saved bank account"
    : selectedNewType === "card" ? "new credit/debit card" : "new US bank transfer";
  const authReady = isAdminTest ? data?.isAdminTest === true && data.testMode === true
    : data?.readiness ? data.readiness.paymentAuthorization === "ready" : !!data?.authorization;
  const canManageMethods = data?.readiness?.methodPermission === "allowed" && data.reusableMethodsSupported;
  const canSaveMethod = !!data && !method && !!selectedNewType && data.paymentTypes.includes(selectedNewType) &&
    data.readiness?.saveMethod === "ready" && canManageMethods &&
    ["card", "us_bank_account"].includes(selectedNewType);
  const managementUrl = data?.entityType === "worker" ? `/workers/${data.entityId}/ledger/payment-methods` : `/employers/${data?.entityId}/ledger/payment_methods`;
  const Pay = data?.payComponentId && hasPaymentGatewayPayComponent(data.payComponentId) ? resolvePaymentGatewayPayComponent(data.payComponentId) : null;
  const frozen = !!session || submitting.current;
  const change = (update: () => void) => {
    if (frozen) return;
    generation.current++;
    setReview(false);
    setAccepted(false);
    setSaveMethodAccepted(false);
    setError("");
    update();
  };
  useEffect(() => {
    seeded.current = false; generation.current++; setChoice("full"); setStatementIds([]); setMethod(""); setPurpose(""); setNewType(null); setAccepted(false); setReview(false); setSession(undefined); setLockedQuote(undefined); setError("");
  }, [eaId, location]);
  useEffect(() => {
    if (session) {
      providerSection.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      providerSection.current?.focus();
    }
  }, [session]);
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
  const canReview = selectionReady && authReady && !!data?.paymentTypes.length &&
    (isAdminTest ? !!Pay && !method && !!selectedNewType && data.paymentTypes.includes(selectedNewType)
      : method ? !!chosenMethod : !!Pay && !!selectedNewType && data.paymentTypes.includes(selectedNewType));
  const submit = async () => {
    if (!data || !scope || !breakdown || !canReview || !accepted ||
        (isAdminTest && !purpose.trim()) || (method && !chosenMethod) || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const created: Session = await apiRequest("POST", `${isAdminTest ? checkoutPath : `/api/ledger/checkout/${scope}/${encodeURIComponent(eaId)}`}/sessions`, {
        selection: { mode: choice, invoiceNumbers: choice === "full" ? [] : statementIds },
        amount: breakdown.amount, statementSelection: breakdown.statementSelection,
        creditTransfers: breakdown.creditTransfers,
         paymentMethodId: method || undefined, paymentMethodType: method ? undefined : selectedNewType,
         saveMethod: !isAdminTest && !!(canSaveMethod && saveMethodAccepted),
         ...(!isAdminTest && canSaveMethod && saveMethodAccepted
           ? { saveMethodConsent: { ...CHECKOUT_SAVE_METHOD_CONSENT, accepted: true } }
           : {}),
         ...(isAdminTest
           ? { adminTestConfirmation: true, purpose: purpose.trim() }
           : { consent: { ...data.authorization, accepted: true } }),
         idempotencyKey: crypto.randomUUID(),
      });
      const receiptPath = `${isAdminTest ? "/admin-test-pay/receipt" : "/pay/receipt"}/${encodeURIComponent(created.id)}`;
      if (current !== generation.current || !["created", "requires_action"].includes(created.status)) navigate(receiptPath);
      else if (created.clientSecret && Pay) { setLockedQuote(breakdown); setSession(created); }
       else { setLockedQuote(breakdown); setSession(created); setError("Secure payment entry is unavailable. Check the payment status below; if it is still awaiting confirmation, contact support with the confirmation number. Do not start another payment until its status is known."); }
    } catch (cause) {
      if (current === generation.current) {
        setError(getApiErrorMessage(cause, "Could not start payment. Check your unfinished payment status before trying again."));
        setReview(false);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["checkout"] }),
          queryClient.invalidateQueries({ queryKey: ["employer-checkout-entry"] }),
          queryClient.invalidateQueries({ queryKey: ["worker-online-pay-accounts"] }),
        ]);
      }
    }
    finally { submitting.current = false; setBusy(false); }
  };
  if ((!isAdminTest && ea.isLoading) || checkout.isLoading) return <main className="mx-auto w-full max-w-xl p-4" role="status">Loading checkout…</main>;
  if ((!isAdminTest && ea.isError) || checkout.isError || !data) return <main className="mx-auto w-full max-w-xl p-4"><Alert variant="destructive"><AlertDescription>{getApiErrorMessage(ea.error || checkout.error, "Online payment is unavailable for this account.")}</AlertDescription></Alert><Button variant="outline" className="mt-4" onClick={() => { if (!isAdminTest) void ea.refetch(); void checkout.refetch(); }}>Retry</Button></main>;
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6" aria-label="Checkout">
    <header><h1 className="text-2xl font-semibold">{isAdminTest ? "Admin test payment" : "Make a payment"}</h1><p className="mt-1 break-words text-muted-foreground">{data.account.name}</p>
      {isAdminTest && <p className="mt-1 text-sm text-muted-foreground">{data.entityType === "worker" ? "Worker" : "Employer"} {data.entityId}</p>}
    </header>
    {isAdminTest && <Alert><AlertDescription><strong>Test mode only.</strong> A successful test payment will post to this selected account's ledger and apply to the displayed balance and statement selection. It does not represent real funds or the worker's or employer's payment consent.</AlertDescription></Alert>}
    <Card><CardContent className="space-y-1 pt-6 text-sm"><p>Posted balance: {money(data.quote.postedBalance, currency)}</p><p>Pending payments: {money(data.quote.pendingPayments, currency)}</p><p className="font-medium">Available to pay: {money(data.quote.available, currency)}</p></CardContent></Card>
    {!!data.pendingCheckouts?.length && <Card><CardHeader><CardTitle className="text-lg">{isAdminTest ? "Your unfinished test payments" : "Your unfinished payments"}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      {data.pendingCheckouts.map(attempt => <p key={attempt.id}>{money(attempt.amount, attempt.currency)} · {attempt.status === "created" ? "Awaiting payment details" : attempt.status === "requires_action" ? "Awaiting confirmation" : attempt.status === "processing" ? "Processing funds" : "Awaiting ledger posting"} · <Link href={`${isAdminTest ? "/admin-test-pay/receipt" : "/pay/receipt"}/${encodeURIComponent(attempt.id)}`} className="underline">Check status</Link></p>)}
    </CardContent></Card>}
    {Number(data.quote.available) <= 0 ? <Alert><AlertDescription>No payment is currently available. Pending payments or account credits may be covering this balance.</AlertDescription></Alert> : <>
      <Card><CardHeader><CardTitle className="text-lg">Choose what to pay</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="flex items-start gap-3 rounded-md border p-3"><input type="radio" name="payment-choice" checked={choice === "full"} disabled={frozen} onChange={() => change(() => setChoice("full"))} /><span><span className="block font-medium">Pay full balance</span><span className="text-sm text-muted-foreground">Apply the current payable balance across eligible statements and account debt.</span></span></label>
         {data.settings.allowPartial && <fieldset className="space-y-2"><legend className="sr-only">Pay selected statements</legend><label className="flex items-start gap-3 rounded-md border p-3"><input type="radio" name="payment-choice" checked={choice === "statements"} disabled={frozen} onChange={() => change(() => setChoice("statements"))} /><span><span className="block font-medium">Pay selected statements</span><span className="text-sm text-muted-foreground">Pay all currently unreserved debt on each selected statement, including any new charges since a pending payment. Existing pending amounts cannot be paid again.</span></span></label>
           {choice === "statements" && <div className="space-y-2 pl-1">{payableStatements.length ? payableStatements.map(statement => <label key={statement.invoiceNumber} className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={statementIds.includes(statement.invoiceNumber)} disabled={frozen} onCheckedChange={() => toggleStatement(statement.invoiceNumber)} /><span className="min-w-0 break-words">{statement.statementYmd.slice(5, 7)}/{statement.statementYmd.slice(0, 4)} · {statement.invoiceNumber}<span className="mt-1 block font-medium">{money(statement.payable, currency)} due</span>{Number(statement.creditAdjustment) > 0 && <span className="mt-1 block text-muted-foreground">Includes {money(statement.creditAdjustment, currency)} in account credits.</span>}</span></label>) : <p className="text-sm text-muted-foreground">No statements can be selected right now. A pending payment may cover them; review the full-balance explanation above, or wait for it to finish.</p>}</div>}
        </fieldset>}
        {!data.settings.allowPartial && <p className="text-sm text-muted-foreground">This account requires payment of the full available balance.</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Payment total</CardTitle></CardHeader><CardContent className="space-y-2">
         {shownBreakdown ? <><p className="text-2xl font-semibold">{money(shownBreakdown.amount, currency)}</p>{shownBreakdown.statements.filter(item => item.selected).map(item => <p key={item.invoiceNumber} className="flex justify-between gap-4 text-sm"><span className="min-w-0 break-words">{item.invoiceNumber}<span className="block text-muted-foreground">Unreserved statement due {money(item.due, currency)}</span></span><span>{money(item.payable, currency)} cash</span></p>)}{shownBreakdown.creditTransfers.length > 0 && <div className="rounded-md border p-3 text-sm"><p className="font-medium">Account-credit transfers</p>{shownBreakdown.creditTransfers.map(transfer => <p key={`${transfer.sourceInvoiceNumber}-${transfer.targetInvoiceNumber}-${transfer.amount}`} className="mt-1 break-words">{money(transfer.amount, currency)} from {transfer.sourceInvoiceNumber} ({transfer.sourceStatementYmd}) to {transfer.targetInvoiceNumber} ({transfer.targetStatementYmd})</p>)}<p className="mt-2 text-muted-foreground">The listed transfer and cash payment cover the selected unreserved debt.</p></div>}{Number(shownBreakdown.unstatementedAmount) > 0 && <p className="text-sm">Account debt not tied to a statement: {money(shownBreakdown.unstatementedAmount, currency)}</p>}{shownBreakdown.issues.length > 0 && <Alert variant="destructive"><AlertDescription>{shownBreakdown.issues.join(" ")}</AlertDescription></Alert>}</> : <p className="text-sm text-muted-foreground">{choice === "statements" && !statementIds.length ? "Select at least one outstanding statement." : "This selection changed. Refresh the checkout to get its current total."}</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-lg">Payment method</CardTitle></CardHeader><CardContent className="space-y-3">
        {!isAdminTest && methods.isLoading ? <p role="status">Loading saved methods…</p> : null}
        {!isAdminTest && methods.isError ? <Alert variant="destructive"><AlertDescription>Saved methods could not be loaded. <Button variant="link" onClick={() => void methods.refetch()}>Retry</Button></AlertDescription></Alert> : null}
         {!isAdminTest && methods.isSuccess && methods.data?.length === 0 && <p className="text-sm text-muted-foreground">No saved methods for this payer yet.</p>}
         {!isAdminTest && methods.isSuccess && unavailableMethods > 0 && <p className="text-sm text-muted-foreground">{unavailableMethods} saved {unavailableMethods === 1 ? "method is" : "methods are"} unavailable for this account. A method may be inactive, belong to another gateway, have an unsupported type, or be temporarily unavailable at the provider. You can use a new method instead.</p>}
          {data.paymentTypes.includes("card") && <label className="flex items-center gap-2"><input type="radio" name="method" checked={!method && selectedNewType === "card"} disabled={frozen} onChange={() => change(() => { setMethod(""); setNewType("card"); })} />New credit/debit card</label>}
          {data.paymentTypes.includes("us_bank_account") && <label className="flex items-center gap-2"><input type="radio" name="method" checked={!method && selectedNewType === "us_bank_account"} disabled={frozen} onChange={() => change(() => { setMethod(""); setNewType("us_bank_account"); })} />New US bank transfer</label>}
          {!isAdminTest && compatibleMethods.map(item => <label key={item.id} className="flex items-center gap-2 break-words"><input type="radio" name="method" checked={method === item.id} disabled={frozen} onChange={() => change(() => setMethod(item.id))} />{item.providerDetails?.card ? `${item.providerDetails.card.brand} •••• ${item.providerDetails.card.last4}` : `${item.providerDetails?.us_bank_account?.bank_name || "Bank"} •••• ${item.providerDetails?.us_bank_account?.last4}`}</label>)}
          {!isAdminTest && canManageMethods && <Link href={managementUrl} className="inline-block text-sm underline">Manage saved payment methods</Link>}
          {!method && <p className="text-sm text-muted-foreground">{isAdminTest
            ? "Admin test checkout always uses a new method for this attempt and cannot save it."
             : canSaveMethod
               ? "Saving is optional; leave the separate checkbox unchecked to use this method for this payment only."
               : "A new method here is used for this payment only. To add or remove a reusable method, use payment method management."}</p>}
          {!isAdminTest && canSaveMethod && <label className="flex items-start gap-2 text-sm"><Checkbox checked={saveMethodAccepted} disabled={frozen} onCheckedChange={value => { if (!frozen) { setReview(false); setSaveMethodAccepted(value === true); } }} /><span><span className="block font-medium">{CHECKOUT_SAVE_METHOD_CONSENT.text}</span><span className="mt-1 block text-muted-foreground">This is separate from the required authorization for the payment above. Saving does not authorize a later charge or enable automatic payments.</span></span></label>}
         {!method && selectedNewType && <p className="text-sm text-muted-foreground">After you review and start this payment, securely {selectedNewType === "card" ? "enter your card details" : "link or enter your US bank account with the payment provider"} and confirm there. Your payment is not complete yet.</p>}
         {!data.paymentTypes.length && <Alert variant="destructive"><AlertDescription>No payment types are available for this account. Ask an administrator to enable a compatible card or bank account type under Gateway Payment Types and ledger online payment settings.</AlertDescription></Alert>}
        {!method && !Pay && <Alert variant="destructive"><AlertDescription>Secure payment entry is unavailable for this account. Contact support before starting a new payment.</AlertDescription></Alert>}
      </CardContent></Card>
      <Card><CardContent className="space-y-4 pt-6">
        {isAdminTest ? <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} disabled={frozen} onCheckedChange={value => change(() => setAccepted(value === true))} /><span>I confirm this is an administrator test only. I understand that success posts a test payment to the selected ledger, and this does not record payer consent or prove real funds.</span></label>
          <label className="block space-y-1 text-sm font-medium">Test purpose
            <input className="w-full rounded-md border bg-background px-3 py-2 font-normal" value={purpose} maxLength={500} disabled={frozen} onChange={event => change(() => setPurpose(event.target.value))} placeholder="For example, verify the test gateway setup" />
          </label>
        </div> : !authReady ? <Alert variant="destructive"><AlertDescription>Payment authorization wording has not been configured. An administrator must finish ledger payment settings before online payments can be made.{isAdmin && <> <Link href="/config/ledger/settings#payment-authorization" className="font-medium underline">Open payment authorization settings</Link></>}</AlertDescription></Alert> : <label className="flex items-start gap-2 text-sm"><Checkbox checked={accepted} disabled={frozen} onCheckedChange={value => change(() => setAccepted(value === true))} /><span>{data.authorization?.text}</span></label>}
          {review ? <div className="space-y-3"><h2 className="font-semibold">Review {isAdminTest ? "test payment" : "payment"}</h2><p className="text-sm">{shownBreakdown && `${money(shownBreakdown.amount, currency)} to ${data.account.name}`} using a {methodDescription}{!isAdminTest && canSaveMethod && saveMethodAccepted ? " (save for future use)" : ""}.</p>{isAdminTest ? <p className="text-sm font-medium">If the provider confirms this test, {money(shownBreakdown?.amount ?? "0", currency)} will post to this ledger account and apply to the statement/account allocation shown above. This is not payer consent and does not prove real funds.</p> : <p className="text-sm text-muted-foreground">Starting the secure step does not complete your payment. Confirm it with the payment provider next.</p>}<div className="flex flex-col gap-2 sm:flex-row"><Button onClick={() => void submit()} disabled={busy || frozen || !canReview || !accepted || (isAdminTest && !purpose.trim())}>{busy ? "Starting…" : isAdminTest ? "Start test payment" : "Continue to secure confirmation"}</Button><Button variant="outline" onClick={() => setReview(false)} disabled={busy || frozen}>Edit</Button></div></div> : <Button onClick={() => setReview(true)} disabled={!canReview || !accepted || (isAdminTest && !purpose.trim())}>{isAdminTest ? "Review test payment" : "Review payment"}</Button>}
         {error && !session && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      </CardContent></Card>
    </>}
      {session && <div ref={providerSection} tabIndex={-1} className="scroll-mt-4 outline-none" aria-label="Secure payment confirmation"><Card><CardHeader><CardTitle>Secure payment confirmation</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm">Payment not complete. {method ? "Complete verification with the payment provider." : selectedNewType === "card" ? "Enter your card details securely below, then confirm with the provider." : "Link or enter your US bank account securely below, then confirm with the provider."}</p>{error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}{Pay && session.clientSecret && (method || (Array.isArray(session.publicConfig?.paymentTypes) && session.publicConfig.paymentTypes.length === 1 && session.publicConfig.paymentTypes[0] === selectedNewType)) ? <Pay key={session.id} clientSecret={session.clientSecret} publicConfig={session.publicConfig ?? {}} amount={shownBreakdown ? money(shownBreakdown.amount, currency) : ""} savedMethod={!!method} returnUrl={`${window.location.origin}${isAdminTest ? "/admin-test-pay/receipt" : "/pay/receipt"}/${encodeURIComponent(session.id)}`} onComplete={(status, message) => status === "failed" ? setError(message || "Provider confirmation failed. Check your details and try again below.") : navigate(`${isAdminTest ? "/admin-test-pay/receipt" : "/pay/receipt"}/${encodeURIComponent(session.id)}`)} /> : <p role="alert">Provider confirmation is unavailable or does not match your selection. Check this payment's status before starting another payment; contact support with confirmation {session.id} if needed.</p>}<Link href={`${isAdminTest ? "/admin-test-pay/receipt" : "/pay/receipt"}/${encodeURIComponent(session.id)}`} className="mt-3 inline-block underline">Check this payment's status</Link></CardContent></Card></div>}
    {data.entityType === "worker" ? <Link href={`/workers/${data.entityId}/ledger/accounts`} className="inline-block text-sm underline">Back to accounts</Link> : <Link href={`/ea/${eaId}`} className="inline-block text-sm underline">Back to account</Link>}
  </main>;
}
