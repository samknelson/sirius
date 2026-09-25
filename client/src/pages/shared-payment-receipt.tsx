import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Receipt = {
  id: string; entityType: string; entityId: string; eaId: string;
  amount: string; currency: string; status: string; failureMessage?: string | null;
  ledgerPaymentId?: string | null;
  paymentStatus?: string | null; dateReceived?: string | null; dateCleared?: string | null;
};
const terminal = new Set(["failed", "canceled", "expired"]);

export default function SharedPaymentReceipt() {
  const { sessionId } = useParams<{ sessionId: string }>();
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
            awaitingConfirmation ? <p>This payment still needs payment details, confirmation, or verification with the provider. No payment has been posted. Return to the original secure confirmation step if it is still open. This attempt may reserve part of your available balance; if you cannot continue, contact support with the confirmation number before starting another payment.</p> :
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
          {pending && <Button variant="outline" onClick={() => void receipt.refetch()} disabled={receipt.isFetching}>Check status</Button>}
        </CardContent></Card>}
  </main>;
}