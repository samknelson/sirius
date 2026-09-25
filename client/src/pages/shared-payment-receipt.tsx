import { useParams, Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Receipt = {
  id: string; entityType: string; entityId: string; eaId: string;
  amount: string; currency: string; status: string; failureMessage?: string | null;
  canCancel?: boolean;
  ledgerPaymentId?: string | null;
  paymentStatus?: string | null; dateReceived?: string | null; dateCleared?: string | null;
};
const terminal = new Set(["failed", "canceled", "expired"]);

export default function SharedPaymentReceipt() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const queryClient = useQueryClient();
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const receipt = useQuery<Receipt>({
    queryKey: ["checkout-receipt", sessionId],
    queryFn: () => apiRequest("GET", `/api/ledger/checkout/sessions/${encodeURIComponent(sessionId)}`),
    refetchInterval: query => {
      const data = query.state.data;
      return terminal.has(data?.status ?? "") || (data?.status === "succeeded" && !!data.ledgerPaymentId) ? false : 5000;
    },
    refetchOnMount: "always",
  });
  const value = receipt.data;
  const posted = value?.status === "succeeded" && value.paymentStatus === "cleared";
  const ledgerPending = value?.paymentStatus === "pending";
  const pending = value && !posted && !["failed", "canceled", "expired"].includes(value.status);
  const awaitingConfirmation = value?.status === "created" || value?.status === "requires_action";
  const awaitingPosting = value?.status === "succeeded" && !posted;
  const abandon = async () => {
    if (!value?.canCancel || canceling) return;
    setCanceling(true); setCancelError("");
    try {
      const result: Receipt = await apiRequest("POST", `/api/ledger/checkout/sessions/${encodeURIComponent(sessionId)}/cancel`);
      if (result.status !== "canceled") throw new Error("Provider cancellation was not confirmed. Check the status before starting another payment.");
      queryClient.setQueryData(["checkout-receipt", sessionId], result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["worker-online-pay-accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["checkout"] }),
      ]);
    } catch (cause) {
      setCancelError(getApiErrorMessage(cause, "Could not confirm cancellation. Your balance remains reserved; check status or contact support."));
      await receipt.refetch();
    } finally { setCanceling(false); }
  };
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4" aria-live="polite">
    <h1 className="text-2xl font-semibold">Payment receipt</h1>
    {receipt.isLoading ? <p role="status">Checking payment status…</p> :
      receipt.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(receipt.error, "Unable to check payment status.")} <Button variant="link" onClick={() => void receipt.refetch()}>Retry</Button></AlertDescription></Alert> :
       value && <Card><CardHeader><CardTitle>{posted ? "Payment cleared" :
         value.status === "created" ? "Awaiting payment details or confirmation" :
         value.status === "requires_action" ? "Awaiting payment confirmation" :
         awaitingPosting ? "Payment confirmed — awaiting ledger posting" :
          ledgerPending ? "Payment pending" : value.status === "processing" ? "Payment processing" : pending ? "Payment status unavailable" :
        value.status === "failed" ? "Payment failed" : value.status === "canceled" ? "Payment canceled" : "Payment expired"}</CardTitle></CardHeader>
        <CardContent className="space-y-4 break-words text-sm">
          <p>Amount: {new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(Number(value.amount))}</p>
          <p>Confirmation: {value.id}</p>
           {value.ledgerPaymentId && <p>Ledger status: {value.paymentStatus === "pending" ? "Pending" : value.paymentStatus === "cleared" ? "Cleared" : value.paymentStatus === "canceled" ? "Canceled" : value.paymentStatus === "error" ? "Failed" : "Unavailable"}</p>}
           {value.dateReceived && <p>Received: {new Date(value.dateReceived).toLocaleString()}</p>}
           <p>Cleared: {value.dateCleared ? new Date(value.dateCleared).toLocaleString() : "Not yet cleared"}</p>
          {posted ? <p>Your payment has been recorded in the ledger.</p> :
             awaitingConfirmation ? <p>This payment still needs payment details, confirmation, or verification with the provider. No payment has been posted. Return to the original secure confirmation step if it is still open. This attempt reserves your available balance. If an abandon option is shown below, it only releases the reservation after the provider confirms cancellation. Leaving this page does not cancel it.</p> :
            awaitingPosting ? <p>The provider has confirmed this payment, but it has not yet been recorded in the ledger. Do not pay again; check back here for the ledger posting.</p> :
            value.status === "processing" ? <p>Funds have not yet been posted. Bank (ACH) payments can take several business days to settle. Your available balance accounts for payments already processing; check back here for an update.</p> :
            pending ? <p>The payment status could not be determined. Do not start another payment; contact support with the confirmation number.</p> :
            <p>{value.failureMessage || "No payment was posted. You can start a new checkout without reusing payment details."}</p>}
          <div className="flex flex-wrap gap-3">
             {value.ledgerPaymentId && <Link className="underline" href={`/ledger/payment/${encodeURIComponent(value.ledgerPaymentId)}`}>View ledger payment</Link>}
            <Link className="underline" href={`/ea/${encodeURIComponent(value.eaId)}`}>View account</Link>
            {value.entityType === "worker" && <Link className="underline" href={`/workers/${encodeURIComponent(value.entityId)}/ledger/accounts`}>Worker accounts</Link>}
            {(value.status === "failed" || value.status === "canceled" || value.status === "expired") &&
              <Link className="underline" href={`/pay/${encodeURIComponent(value.eaId)}`}>Try again</Link>}
          </div>
           {awaitingConfirmation && value.canCancel && <Button variant="destructive" disabled={canceling} onClick={() => void abandon()}>{canceling ? "Confirming cancellation…" : "Abandon this payment"}</Button>}
           {awaitingConfirmation && !value.canCancel && <p>Cancellation is unavailable here. Contact support with the confirmation number; do not start another payment until its status is known.</p>}
           {cancelError && <Alert variant="destructive" role="alert"><AlertDescription>{cancelError}</AlertDescription></Alert>}
          {pending && <Button variant="outline" onClick={() => void receipt.refetch()} disabled={receipt.isFetching}>Check status</Button>}
        </CardContent></Card>}
  </main>;
}