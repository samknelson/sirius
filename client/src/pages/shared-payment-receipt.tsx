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
};
const terminal = new Set(["succeeded", "failed", "canceled", "expired"]);

export default function SharedPaymentReceipt() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const receipt = useQuery<Receipt>({
    queryKey: ["checkout-receipt", sessionId],
    queryFn: () => apiRequest("GET", `/api/ledger/checkout/sessions/${encodeURIComponent(sessionId)}`),
    refetchInterval: query => terminal.has(query.state.data?.status ?? "") ? false : 5000,
    refetchOnMount: "always",
  });
  const value = receipt.data;
  const posted = value?.status === "succeeded" && !!value.ledgerPaymentId;
  const pending = value && !posted && !["failed", "canceled", "expired"].includes(value.status);
  return <main className="mx-auto w-full max-w-xl space-y-4 p-4" aria-live="polite">
    <h1 className="text-2xl font-semibold">Payment receipt</h1>
    {receipt.isLoading ? <p role="status">Checking payment status…</p> :
      receipt.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(receipt.error, "Unable to check payment status.")} <Button variant="link" onClick={() => void receipt.refetch()}>Retry</Button></AlertDescription></Alert> :
      value && <Card><CardHeader><CardTitle>{posted ? "Payment posted" : pending ? "Payment processing" :
        value.status === "failed" ? "Payment failed" : value.status === "canceled" ? "Payment canceled" : "Payment expired"}</CardTitle></CardHeader>
        <CardContent className="space-y-4 break-words text-sm">
          <p>Amount: {new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(Number(value.amount))}</p>
          <p>Confirmation: {value.id}</p>
          {posted ? <p>Your payment has been recorded in the ledger.</p> :
            pending ? <p>Funds have not yet been posted. Bank (ACH) payments can take several business days to settle. Your available balance accounts for payments already processing; check back here for an update.</p> :
            <p>{value.failureMessage || "No payment was posted. You can start a new checkout without reusing payment details."}</p>}
          <div className="flex flex-wrap gap-3">
            {posted && value.ledgerPaymentId && <Link className="underline" href={`/ledger/payment/${encodeURIComponent(value.ledgerPaymentId)}`}>View ledger payment</Link>}
            <Link className="underline" href={`/ea/${encodeURIComponent(value.eaId)}`}>View account</Link>
            {value.entityType === "worker" && <Link className="underline" href={`/workers/${encodeURIComponent(value.entityId)}/ledger/accounts`}>Worker accounts</Link>}
            {(value.status === "failed" || value.status === "canceled" || value.status === "expired") &&
              <Link className="underline" href={`/pay/${encodeURIComponent(value.eaId)}`}>Try again</Link>}
          </div>
          {pending && <Button variant="outline" onClick={() => void receipt.refetch()} disabled={receipt.isFetching}>Check status</Button>}
        </CardContent></Card>}
  </main>;
}