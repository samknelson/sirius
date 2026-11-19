import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Info, RefreshCw, Save, Send, Users } from "lucide-react";
import type { LegalConfirmationData, LegalRemittance } from "@shared/legal-payment";
import { EMPLOYER_SUBMITTED, ledgerDecimal, legalPaymentMinor, paymentStatusLabel } from "@shared/legal-payment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { LegalPayerOptions } from "./LegalPayerOptions";

const amountLabel = (value: string, currency: string) => {
  const number = Number(value);
  try {
    return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(number) : `${value} ${currency}`;
  } catch { return `${value} ${currency}`; }
};

function Metric({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <div className="rounded-md border bg-muted/25 p-3">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
  </div>;
}

export function LegalConfirmation({ wizardId }: WizardStepComponentProps) {
  const { toast } = useToast();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/confirmation/data`;
  const wizardUrl = `/api/wizards/${wizardId}`;
  const { data, error, isLoading, isError, isFetching, refetch } = useQuery<LegalConfirmationData>({
    queryKey: [dataUrl], staleTime: 0,
    refetchInterval: query => query.state.data?.accounts.some(account =>
      account.payerHandoff?.status === "queued" && Date.now() - Date.parse(account.payerHandoff.requestedAt) < 120_000) ? 2000 : false,
  });
  const [forms, setForms] = useState<Record<string, LegalRemittance>>({});
  const [delegations, setDelegations] = useState<Record<string, boolean>>({});
  const formFor = (id: string, fallback: LegalRemittance) => forms[id] ?? fallback;
  const patchForm = (id: string, patch: Partial<LegalRemittance>, fallback: LegalRemittance) =>
    setForms(current => ({ ...current, [id]: { ...(current[id] ?? fallback), ...patch } }));
  const submitMutation = useMutation({
    mutationFn: async ({ eaId, action, remittance }: { eaId: string; action: "save" | "submit"; remittance: LegalRemittance }) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/confirmation/submit`, { input: { eaId, action, remittance } }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: [dataUrl] });
      queryClient.invalidateQueries({ queryKey: [wizardUrl] });
      toast({
        title: variables.action === "save" ? "Draft saved" : "Payment submitted",
        description: variables.action === "save" ? "Your details were saved; no receipt has been credited." : "Your receipt is awaiting staff review and is not yet credited.",
      });
    },
    onError: (mutationError: Error, variables) => toast({
      title: variables.action === "save" ? "Could not save draft" : "Could not submit payment",
      description: getApiErrorMessage(mutationError, "Please try again."),
      variant: "destructive",
    }),
  });

  if (isLoading) return <Card><CardHeader><Skeleton className="h-6 w-56" /><Skeleton className="h-4 w-80" /></CardHeader><CardContent className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></CardContent></Card>;
  if (isError) return <Card><CardHeader><CardTitle>Confirmation and payment</CardTitle><CardDescription>We could not load saved upload outcomes.</CardDescription></CardHeader><CardContent><Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Confirmation unavailable</AlertTitle><AlertDescription>{getApiErrorMessage(error, "Please try again.")}</AlertDescription></Alert><Button className="mt-4" variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card>;
  if (!data) return null;

  const population = data.population;
  const totals = data.totals;
  const historical = data.completed && data.historical;
  return <div className="space-y-5">
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div><CardTitle>Confirmation and payment</CardTitle><CardDescription className="mt-1">Saved processing outcomes and posted charges. This step never reruns the import or grants benefits again.</CardDescription></div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {historical && <Alert><Info className="h-4 w-4" /><AlertTitle>Historical upload</AlertTitle><AlertDescription>This upload was completed before outcome measurements were retained. No payment is required retroactively; unavailable history is not shown as zero.</AlertDescription></Alert>}
        {data.completed && !historical && <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>Processing is complete</AlertTitle><AlertDescription>These are the persisted results for this run. Detailed row outcomes remain available in the upload results step.</AlertDescription></Alert>}
        {totals && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="New workers created" value={totals.newWorkers} note="Actual processing result, not the preview estimate" />
          <Metric label="New benefit grants" value={totals.newGrants} note={`Across ${totals.workersWithNewGrants} workers`} />
          <Metric label="Rows processed" value={totals.processedRows} note={`${totals.failedRows} failed rows`} />
          <Metric label="Charge failures" value={totals.chargeReadFailed ? "Unavailable" : totals.chargeFailures} note={totals.chargeReadFailed ? "The charge read failed; no total is inferred." : "Reported during processing"} />
        </div>}
        {population ? <>
          {((population.unresolvedRows ?? 0) > 0 || (population.benefitReadFailures ?? 0) > 0 || population.contactDifferences.failedWorkers > 0 || (totals?.failedRows ?? 0) > 0) && <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Some outcomes need attention</AlertTitle>
            <AlertDescription>{[
              (population.unresolvedRows ?? 0) > 0 && `${population.unresolvedRows} unresolved rows`,
              (population.benefitReadFailures ?? 0) > 0 && `${population.benefitReadFailures} benefit read failures`,
              population.contactDifferences.failedWorkers > 0 && `${population.contactDifferences.failedWorkers} failed contact updates`,
              (totals?.failedRows ?? 0) > 0 && `${totals?.failedRows} failed rows`,
            ].filter(Boolean).join(" · ")}. A failed or unresolved row is not the same as a confirmed worker without benefits. Review the detailed results before interpreting these totals.</AlertDescription>
          </Alert>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Distinct worker identities" value={population.distinctWorkers} note={`${population.totalRows} source rows; repeated identities counted once`} />
            <Metric label="Confirmed workers" value={population.confirmedWorkers} note={`${population.unconfirmedWorkers} unconfirmed workers; unresolved identity rows are counted separately`} />
            <Metric label="Workers with mapped benefit" value={population.workersWithBenefits} note={`${population.benefitReadFailures} benefit outcomes unknown`} />
            <Metric label="Confirmed without benefit" value={population.workersWithoutBenefits} note="Failed or unresolved rows are reported separately" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr]">
            <div className="rounded-md border p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" />Worker and contact outcomes</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">New benefit grants</dt><dd className="text-right tabular-nums">{totals?.newGrants ?? "Unavailable"} across {totals?.workersWithNewGrants ?? "—"} workers</dd>
                <dt className="text-muted-foreground">Existing grants</dt><dd className="text-right tabular-nums">{population.existingGrants}</dd>
                <dt className="text-muted-foreground">Workers with submitted contact differences</dt><dd className="text-right tabular-nums">{population.contactDifferences.workers}</dd>
                <dt className="text-muted-foreground">Email / phone / address</dt><dd className="text-right tabular-nums">{population.contactDifferences.email} / {population.contactDifferences.phone} / {population.contactDifferences.address}</dd>
                <dt className="text-muted-foreground">Contact update failures</dt><dd className="text-right tabular-nums">{population.contactDifferences.failedWorkers}</dd>
                <dt className="text-muted-foreground">Contact differences on unconfirmed workers</dt><dd className="text-right tabular-nums">{population.contactDifferences.unconfirmedWorkers}</dd>
                <dt className="text-muted-foreground">Unconfirmed workers / unresolved identity rows</dt><dd className="text-right tabular-nums">{population.unconfirmedWorkers} / {population.unresolvedIdentityRows}</dd>
                <dt className="text-muted-foreground">Rows processed / failed</dt><dd className="text-right tabular-nums">{totals?.processedRows ?? "Unavailable"} / {totals?.failedRows ?? "Unavailable"}</dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Unconfirmed worker and unresolved identity-row counts are shown separately; unresolved rows may not identify a unique worker. Contact differences are deduplicated workers with meaningful submitted values that differed from saved values. They are not proof that every primary contact detail was replaced. Blank or unchanged values and new-worker initial contact information are excluded; existing import/address-source behavior still applies.</p>
            </div>
            <div className="rounded-md border p-4">
              <h3 className="text-sm font-semibold">Benefit-period detail</h3>
              {population.benefits.length ? <div className="mt-3 divide-y">{population.benefits.map((benefit, index) => <div key={`${benefit.benefitId}-${benefit.year}-${benefit.month}-${index}`} className="grid grid-cols-[1fr_auto_auto] gap-3 py-2 text-sm">
                <span>{benefit.year}-{String(benefit.month).padStart(2, "0")} · {benefit.benefitId}</span><span className="text-right tabular-nums">{benefit.withBenefit} with</span><span className="text-right tabular-nums">{benefit.withoutBenefit} without</span>
                <span className="col-span-3 text-xs text-muted-foreground">{benefit.unresolvedWorkers} unresolved · one worker may have multiple benefit rows/periods</span>
              </div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No benefit-period breakdown was supplied.</p>}
            </div>
          </div>
        </> : <Alert><Info className="h-4 w-4" /><AlertTitle>{historical ? "Historical measurements unavailable" : "Population outcomes unavailable"}</AlertTitle><AlertDescription>The server did not supply a saved population breakdown for this upload.</AlertDescription></Alert>}
        {totals && <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Unpriceable grants" value={totals.unpriceableGrants ?? "Unavailable"} note="Only reported processing measurements are shown." />
        </div>}
        {!totals && <p className="text-sm text-muted-foreground">Processing totals and charge reads are unavailable.</p>}
      </CardContent>
    </Card>

    <section className="space-y-3" aria-labelledby="payment-heading">
      <div><h2 id="payment-heading" className="text-lg font-semibold">Tell us how you will pay</h2><p className="text-sm text-muted-foreground">Each ledger account and currency is funded separately. Submission creates a pending review record, not an account credit.</p></div>
      {totals?.chargeReadFailed && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Upload charges unavailable</AlertTitle><AlertDescription>Charge lookup failed. No charge total can be confirmed from this response.</AlertDescription></Alert>}
      {data.accounts.length === 0 && <p className="rounded-md border p-4 text-sm text-muted-foreground">{historical || !totals ? "Historical account charge measurements are unavailable." : totals.chargeReadFailed ? "No confirmed account charge groups are available." : "No upload charges posted for this confirmation."}</p>}
      {data.accounts.map(account => {
        const details = account.payment?.details && typeof account.payment.details === "object" ? account.payment.details as Record<string, unknown> : {};
        const paymentType = account.methods.find(method => method.id === account.payment?.paymentType);
        const persisted: LegalRemittance = {
          amount: account.payment?.amount ?? "",
          paymentType: account.payment?.paymentType,
          method: details.method === "check" || details.method === "wire" ? details.method : paymentType?.method,
          merchant: typeof details.merchant === "string" ? details.merchant : undefined,
          checkTransactionNumber: typeof details.checkTransactionNumber === "string" ? details.checkTransactionNumber : undefined,
          timing: details.timing === "planned" || details.timing === "already_sent" ? details.timing : undefined,
          paymentDate: typeof details.paymentDate === "string" ? details.paymentDate : undefined,
          bankNickname: typeof details.bankNickname === "string" ? details.bankNickname : undefined,
          notes: typeof details.notes === "string" ? details.notes : undefined,
        };
        const fallback = account.draft ?? (account.payment?.status === EMPLOYER_SUBMITTED ? persisted : { amount: "", timing: "planned" as const });
        const value = formFor(account.eaId, fallback);
        const choices = account.methods.filter(method => !value.method || method.method === value.method);
        const typeValid = choices.some(method => method.id === value.paymentType);
        const editable = !account.payment || account.payment.status === EMPLOYER_SUBMITTED;
        const delegated = !account.payment && (delegations[account.eaId] ?? !!account.payerHandoff);
        let projection: string | null = null;
        let projectionLabel: string | null = null;
        let outcome = "";
        try {
          const amount = legalPaymentMinor(value.amount || "0", account.currency);
          const balance = account.balance === null ? null : legalPaymentMinor(account.balance, account.currency);
          const charge = legalPaymentMinor(account.amount, account.currency);
          if (editable && !delegated && amount > 0n) {
            if (balance !== null) {
              projection = ledgerDecimal(balance - amount);
              const projectedMinor = balance - amount;
              projectionLabel = projectedMinor < 0n
                ? `Credit ${amountLabel(ledgerDecimal(-projectedMinor), account.currency)}`
                : amountLabel(projection, account.currency);
            }
            if (balance !== null && balance <= 0n) outcome = "The account currently has a credit; this receipt would increase that credit.";
            else if (balance !== null && amount >= balance) outcome = amount === balance ? "Would cover the current account balance." : "Would exceed the current account balance.";
            else if (amount < charge) outcome = "This amount is below the current upload charges.";
            else if (amount === charge) outcome = "This amount covers this upload exactly.";
            else outcome = "This amount exceeds this upload’s charges.";
          }
        } catch { /* Incomplete or invalid form values have no projection. */ }
        const partialBalance = (() => {
          try {
            if (!editable || delegated || account.balance === null) return null;
            const amount = legalPaymentMinor(value.amount || "0", account.currency);
            const charge = legalPaymentMinor(account.amount, account.currency);
            const balance = legalPaymentMinor(account.balance, account.currency);
            return amount > 0n && amount >= charge && amount < balance ? ledgerDecimal(balance - amount) : null;
          } catch { return null; }
        })();
        return <Card key={account.eaId}>
          <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{account.accountName}</CardTitle><CardDescription className="mt-1">{account.entries} posted charge entries · {account.currency}</CardDescription></div>{account.payment && <Badge variant={account.payment.status === "error" ? "destructive" : "secondary"}>{paymentStatusLabel(account.payment.status)}</Badge>}</div></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Upload charges" value={amountLabel(account.amount, account.currency)} />
              <Metric label="Current account balance" value={account.balance === null ? "Unavailable" : amountLabel(account.balance, account.currency)} />
              <Metric label={delegated ? "Payment responsibility" : editable ? "Projected after receipt clears" : "Current balance"} value={delegated ? "Another payer" : editable ? projectionLabel ?? "Enter a valid amount" : account.balance === null ? "Unavailable" : amountLabel(account.balance, account.currency)} note={delegated ? "Notifying a payer does not submit or credit a payment." : editable ? "Projection only; pending payment does not reduce current balance." : "No pending amount is subtracted again."} />
            </div>
            {account.error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{account.error}</AlertDescription></Alert>}
            {data.completed && !historical && editable && !account.methods.length && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>No valid check or wire payment type is configured</AlertTitle><AlertDescription>Ask ledger staff to configure a financial payment type for {account.currency}. This account cannot be submitted until the matching type is available.</AlertDescription></Alert>}
            <div className="flex flex-wrap gap-3 text-sm"><Link href={account.invoiceSummaryPath} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">Account invoice summary <ExternalLink className="h-3.5 w-3.5" /></Link>{account.invoicePaths.map((path, index) => <a key={`${path}-${index}`} href={path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">Invoice {index + 1} <ExternalLink className="h-3.5 w-3.5" /></a>)}</div>
            {account.payment && <Alert className="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20"><AlertTriangle className="h-4 w-4" /><AlertTitle>{account.payment.status === EMPLOYER_SUBMITTED ? "Employer submitted — not credited" : `Payment ${paymentStatusLabel(account.payment.status)}`}</AlertTitle><AlertDescription>{amountLabel(account.payment.amount, account.currency)} · {paymentType?.name ?? account.payment.paymentType}{typeof details.merchant === "string" && ` · ${details.merchant}`}{typeof details.checkTransactionNumber === "string" && ` · Reference ${details.checkTransactionNumber}`}{typeof details.paymentDate === "string" && ` · ${details.paymentDate}`}{typeof details.notes === "string" && <span className="block mt-1">{details.notes}</span>}{account.payment.status === EMPLOYER_SUBMITTED && <span className="block mt-1 font-medium">Staff must verify receipt and clear this payment before it is credited.</span>}</AlertDescription></Alert>}
            {partialBalance !== null && <Alert><Info className="h-4 w-4" /><AlertDescription>This payment covers this upload, but you will still have an outstanding balance of {amountLabel(partialBalance, account.currency)}.</AlertDescription></Alert>}
            {outcome && partialBalance === null && <p className="text-sm text-muted-foreground">{outcome}</p>}
            {data.completed && !historical && !account.payment && <LegalPayerOptions
              wizardId={wizardId} eaId={account.eaId}
              contacts={data.payerContacts ?? []} canSaveContact={!!data.canSavePayerContact}
              handoff={account.payerHandoff} delegated={delegated}
              onDelegate={value => setDelegations(current => ({ ...current, [account.eaId]: value }))}
            />}
            {data.completed && !historical && editable && !delegated ? <div className="space-y-4 border-t pt-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2"><Label htmlFor={`amount-${account.eaId}`}>Amount ({account.currency})</Label><Input id={`amount-${account.eaId}`} inputMode="decimal" placeholder="Amount you know" value={value.amount} onChange={event => patchForm(account.eaId, { amount: event.target.value }, fallback)} /></div>
                <div className="space-y-2"><Label htmlFor={`method-${account.eaId}`}>Method</Label><Select value={value.method ?? ""} onValueChange={method => patchForm(account.eaId, { method: method as "check" | "wire", paymentType: undefined }, fallback)} disabled={!account.methods.length}><SelectTrigger id={`method-${account.eaId}`}><SelectValue placeholder="Choose check or wire" /></SelectTrigger><SelectContent>{Array.from(new Set(account.methods.map(method => method.method))).map(method => <SelectItem key={method} value={method}>{method === "check" ? "Check" : "Wire"}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={`type-${account.eaId}`}>Configured payment type</Label><Select value={typeValid ? value.paymentType : ""} onValueChange={paymentType => patchForm(account.eaId, { paymentType }, fallback)} disabled={!value.method}><SelectTrigger id={`type-${account.eaId}`}><SelectValue placeholder={value.method ? "Select a configured type" : "Choose a method first"} /></SelectTrigger><SelectContent>{choices.map(method => <SelectItem key={method.id} value={method.id}>{method.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={`timing-${account.eaId}`}>Timing</Label><Select value={value.timing ?? "planned"} onValueChange={timing => patchForm(account.eaId, { timing: timing as "planned" | "already_sent" }, fallback)}><SelectTrigger id={`timing-${account.eaId}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planned">Planned</SelectItem><SelectItem value="already_sent">Already sent</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={`payer-${account.eaId}`}>Merchant / payer (optional)</Label><Input id={`payer-${account.eaId}`} value={value.merchant ?? ""} onChange={event => patchForm(account.eaId, { merchant: event.target.value }, fallback)} /></div>
                <div className="space-y-2"><Label htmlFor={`reference-${account.eaId}`}>Check number / wire reference (optional)</Label><Input id={`reference-${account.eaId}`} value={value.checkTransactionNumber ?? ""} onChange={event => patchForm(account.eaId, { checkTransactionNumber: event.target.value }, fallback)} /></div>
                <div className="space-y-2"><Label htmlFor={`date-${account.eaId}`}>Payment date (optional)</Label><Input id={`date-${account.eaId}`} type="date" value={value.paymentDate ?? ""} onChange={event => patchForm(account.eaId, { paymentDate: event.target.value }, fallback)} /></div>
                <div className="space-y-2"><Label htmlFor={`bank-${account.eaId}`}>Originating bank / account nickname (optional)</Label><Input id={`bank-${account.eaId}`} value={value.bankNickname ?? ""} onChange={event => patchForm(account.eaId, { bankNickname: event.target.value }, fallback)} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Do not enter full account or routing numbers, credentials, or card information.</p>
              <div className="space-y-2"><Label htmlFor={`notes-${account.eaId}`}>Notes (optional)</Label><Textarea id={`notes-${account.eaId}`} rows={2} value={value.notes ?? ""} onChange={event => patchForm(account.eaId, { notes: event.target.value }, fallback)} /></div>
              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={submitMutation.isPending} onClick={() => submitMutation.mutate({ eaId: account.eaId, action: "save", remittance: value })}><Save className="mr-2 h-4 w-4" />Save incomplete draft</Button>
                <Button type="button" disabled={submitMutation.isPending || !value.amount.trim() || !value.method || !typeValid || (() => { try { return legalPaymentMinor(value.amount, account.currency) <= 0n; } catch { return true; } })()} onClick={() => submitMutation.mutate({ eaId: account.eaId, action: "submit", remittance: value })}><Send className="mr-2 h-4 w-4" />Submit for review</Button>
              </div>
            </div> : delegated ? null : account.payment ? <p className="text-sm text-muted-foreground">This payment is no longer editable from the upload. Staff can review it in Ledger.</p> : <p className="text-sm text-muted-foreground">{historical ? "This historical upload has no retroactive payment requirement." : data.completed ? "No payment is required for this account." : "Payment details become available after processing is complete."}</p>}
            {!account.payment && !account.draft && <p className="text-sm text-muted-foreground">No receipt is submitted. Pending details never reduce the authoritative balance.</p>}
          </CardContent>
        </Card>;
      })}
    </section>
  </div>;
}

export default LegalConfirmation;
