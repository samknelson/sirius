import { Link, useLocation, useSearch } from "wouter";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Account = { eaId: string; accountName: string; balance: string; available: string; currency: string };

function WorkerPaymentAccounts() {
  const { worker } = useWorkerLayout();
  const requested = new URLSearchParams(useSearch()).get("eaId");
  const [, navigate] = useLocation();
  const accounts = useQuery<Account[]>({
    queryKey: ["worker-online-pay-accounts", worker.id],
    queryFn: () => apiRequest("GET", `/api/ledger/pay-accounts/worker/${worker.id}`),
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (requested && accounts.data?.some(account => account.eaId === requested)) {
      navigate(`/pay/${encodeURIComponent(requested)}`, { replace: true });
    }
  }, [requested, accounts.data, navigate]);
  return <div className="mx-auto max-w-xl space-y-4">
    <h1 className="text-2xl font-semibold">Choose an account to pay</h1>
    {accounts.isLoading ? <p role="status">Loading payment accounts…</p> :
      accounts.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(accounts.error, "Unable to load payment accounts.")} <Button variant="link" onClick={() => void accounts.refetch()}>Retry</Button></AlertDescription></Alert> :
      accounts.data?.length === 0 ? <p>There are no accounts enabled for online payment. Contact staff if you expected to see one.</p> :
      accounts.data?.map(account => <Card key={account.eaId}><CardHeader><CardTitle className="text-lg">{account.accountName}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p>Posted balance: {account.balance} {account.currency}</p>
        <p>Pending: {(Number(account.balance) - Number(account.available)).toFixed(2)} {account.currency}</p>
        <p>Available to pay: {account.available} {account.currency}</p>
        {Number(account.available) > 0
          ? <Button asChild><Link href={`/pay/${encodeURIComponent(account.eaId)}`}>Pay this account</Link></Button>
          : <p>No amount is currently available to pay.</p>}
      </CardContent></Card>)}
    {requested && accounts.data && !accounts.data.some(account => account.eaId === requested) &&
      <Alert variant="destructive"><AlertDescription>The requested account is not available for online payment. Choose an enabled account above.</AlertDescription></Alert>}
  </div>;
}

export default function WorkerLedgerPaymentPage() {
  return <WorkerLayout activeTab="accounts"><WorkerPaymentAccounts /></WorkerLayout>;
}