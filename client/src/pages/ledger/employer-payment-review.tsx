import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import type { LedgerPayment } from "@shared/schema";
import { paymentStatusLabel } from "@shared/legal-payment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";

type ReviewPayment = LedgerPayment & { employerName: string | null; accountName: string; currency: string };
interface ReviewResponse { data: ReviewPayment[]; total: number }
const PAGE_SIZE = 25;

export default function EmployerPaymentReviewPage() {
  usePageTitle("Employer Payment Review");
  const [offset, setOffset] = useState(0);
  const url = `/api/ledger/payments/employer-review?limit=${PAGE_SIZE}&offset=${offset}`;
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ReviewResponse>({ queryKey: [url], staleTime: 0, queryFn: () => apiRequest("GET", url) });
  const payments = data?.data ?? [];
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const safeText = (value: unknown) => typeof value === "string" && value.trim() ? value : null;

  return <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-sm font-medium text-muted-foreground">Ledger · Staff review</p><h1 className="mt-1 text-2xl font-semibold">Employer payment receipts</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Verify each receipt before clearing it. Employer-submitted payments are pending and are not credited to the account.</p></div>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </header>
    {isLoading ? <Card><CardHeader><Skeleton className="h-6 w-52" /><Skeleton className="h-4 w-72" /></CardHeader><CardContent className="space-y-3">{[0, 1, 2].map(row => <Skeleton key={row} className="h-24 w-full" />)}</CardContent></Card>
      : isError ? <Card><CardHeader><CardTitle>Receipts could not be loaded</CardTitle><CardDescription>{getApiErrorMessage(error, "Try again in a moment.")}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card>
      : payments.length === 0 ? <Card><CardContent className="py-12 text-center"><h2 className="font-semibold">No employer receipts to review</h2><p className="mt-1 text-sm text-muted-foreground">New employer-submitted receipts will appear here.</p></CardContent></Card>
      : <>
        <div className="space-y-3">{payments.map(payment => {
          const details = payment.details && typeof payment.details === "object" ? payment.details as Record<string, unknown> : {};
          const uploadPath = payment.uploadWizardId ? `/wizards/${encodeURIComponent(payment.uploadWizardId)}` : null;
          const method = safeText(details.method) ?? payment.paymentType;
          return <Card key={payment.id}><CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{payment.employerName || "Employer not identified"}</h2><Badge variant="secondary">{paymentStatusLabel(payment.status)}</Badge></div>
              <p className="text-sm text-muted-foreground">{payment.accountName} · <span className="font-medium text-foreground">{new Intl.NumberFormat(undefined, { style: "currency", currency: payment.currency }).format(Number(payment.amount))} {payment.currency}</span> · {method}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {safeText(details.merchant) && <span>Payer: {String(details.merchant)}</span>}
                {safeText(details.checkTransactionNumber) && <span>Reference: {String(details.checkTransactionNumber)}</span>}
                {safeText(details.timing) && <span>{details.timing === "already_sent" ? "Reported sent" : "Planned"}</span>}
                {safeText(details.paymentDate) && <span>Date: {String(details.paymentDate)}</span>}
                {safeText(details.bankNickname) && <span>Bank: {String(details.bankNickname)}</span>}
              </div>
              {safeText(details.notes) && <p className="break-words text-sm">{String(details.notes)}</p>}
              {uploadPath && <Link href={uploadPath} className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"><ExternalLink className="h-3.5 w-3.5" />Related upload</Link>}
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end"><Link href={`/ledger/payment/${payment.id}/edit`} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">Review, edit, clear or cancel</Link><Link href={`/ledger/payment/${payment.id}`} className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-primary hover:underline">Details <ExternalLink className="h-3.5 w-3.5" /></Link></div>
          </CardContent></Card>;
        })}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">Showing {offset + 1}–{Math.min(offset + payments.length, data?.total ?? 0)} of {data?.total ?? 0} receipts · page {pageNumber} of {pageCount}</p>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={offset === 0 || isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ArrowLeft className="mr-2 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= (data?.total ?? 0) || isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>Next<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
        </div>
      </>}
  </main>;
}
