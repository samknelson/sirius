import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PaymentBatchLayout, usePaymentBatchLayout } from "@/components/layouts/PaymentBatchLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Download, AlertCircle, CheckCircle2 } from "lucide-react";
import type { LedgerAccount, File as FileRecord } from "@shared/schema";

interface BatchWithSummary {
  id: string;
  name: string;
  accountId: string;
  batchTotal: string | null;
  expectedPaymentCount: number | null;
  attachmentFileId: string | null;
  paymentsCount?: number;
  paymentsTotal?: string;
}

function formatCurrency(amount: string | number | null | undefined, currencyCode = "USD") {
  if (amount == null || amount === "") return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(num);
}

function BatchDetailsContent() {
  const { batch } = usePaymentBatchLayout();
  // The layout query already returned summary fields too — re-fetch the same key
  // to read them via an enriched type.
  const { data: enriched } = useQuery<BatchWithSummary>({
    queryKey: [`/api/ledger-payment-batches/${batch.id}`],
    enabled: !!batch.id,
  });

  const { data: account } = useQuery<LedgerAccount>({
    queryKey: ["/api/ledger/accounts", batch.accountId],
    enabled: !!batch.accountId,
  });

  const { data: attachment } = useQuery<FileRecord>({
    queryKey: ["/api/files", batch.attachmentFileId],
    queryFn: () => apiRequest("GET", `/api/files/${batch.attachmentFileId}`),
    enabled: !!batch.attachmentFileId,
  });

  const currency = (account as LedgerAccount & { currencyCode?: string })?.currencyCode || "USD";
  const expectedTotal = batch.batchTotal != null ? parseFloat(batch.batchTotal) : null;
  const actualTotal = enriched?.paymentsTotal != null ? parseFloat(enriched.paymentsTotal) : 0;
  const totalDiff = expectedTotal != null ? actualTotal - expectedTotal : null;
  const expectedCount = batch.expectedPaymentCount;
  const actualCount = enriched?.paymentsCount ?? 0;
  const countDiff = expectedCount != null ? actualCount - expectedCount : null;

  const totalReconciled = totalDiff != null && Math.abs(totalDiff) < 0.01;
  const countReconciled = countDiff != null && countDiff === 0;

  // Overall reconciliation badge: exactly one of Unset | Balanced | Over by $X | Under by $X.
  // Count mismatches are surfaced separately in the Payments section below.
  let overallBadge: JSX.Element;
  if (expectedTotal == null) {
    overallBadge = (
      <Badge variant="outline" data-testid="badge-overall-reconciliation">
        Unset
      </Badge>
    );
  } else if (totalReconciled) {
    overallBadge = (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-overall-reconciliation">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Balanced
      </Badge>
    );
  } else if ((totalDiff ?? 0) > 0) {
    overallBadge = (
      <Badge variant="destructive" data-testid="badge-overall-reconciliation">
        <AlertCircle className="h-3 w-3 mr-1" />
        Over by {formatCurrency(Math.abs(totalDiff!), currency)}
      </Badge>
    );
  } else {
    overallBadge = (
      <Badge variant="destructive" data-testid="badge-overall-reconciliation">
        <AlertCircle className="h-3 w-3 mr-1" />
        Under by {formatCurrency(Math.abs(totalDiff!), currency)}
      </Badge>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reconciliation summary */}
      <Card data-testid="card-batch-reconciliation">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Reconciliation</CardTitle>
            {overallBadge}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Total</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums" data-testid="text-actual-total">
                  {formatCurrency(actualTotal, currency)}
                </span>
                <span className="text-sm text-muted-foreground">
                  of {formatCurrency(expectedTotal, currency)}
                </span>
              </div>
              {totalDiff != null && (
                <div className="mt-2 flex items-center gap-2">
                  {totalReconciled ? (
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-total-reconciled">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Reconciled
                    </Badge>
                  ) : (
                    <Badge variant="destructive" data-testid="badge-total-mismatch">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {totalDiff > 0 ? "Over" : "Under"} by {formatCurrency(Math.abs(totalDiff), currency)}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium text-muted-foreground mb-1">Payments</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums" data-testid="text-actual-count">
                  {actualCount}
                </span>
                <span className="text-sm text-muted-foreground">
                  of {expectedCount != null ? expectedCount : "—"}
                </span>
              </div>
              {countDiff != null && (
                <div className="mt-2 flex items-center gap-2">
                  {countReconciled ? (
                    <Badge variant="default" className="bg-green-600 hover:bg-green-700" data-testid="badge-count-reconciled">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Reconciled
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-count-mismatch">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {countDiff > 0 ? "+" : ""}
                      {countDiff} vs expected
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            <Link
              href={`/ledger/payment-batch/${batch.id}/payments`}
              className="text-sm text-primary hover:underline"
              data-testid="link-go-to-payments"
            >
              Manage payments →
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-batch-details">
        <CardHeader>
          <CardTitle>Batch Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-batch-name">{batch.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Account</dt>
              <dd className="mt-1 text-sm" data-testid="text-batch-account">
                {account ? account.name : <span className="text-muted-foreground italic">Loading...</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Batch Total</dt>
              <dd className="mt-1 text-sm" data-testid="text-batch-total">
                {formatCurrency(batch.batchTotal, currency)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Expected Payments</dt>
              <dd className="mt-1 text-sm" data-testid="text-expected-count">
                {batch.expectedPaymentCount != null ? batch.expectedPaymentCount : "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-muted-foreground">Attachment</dt>
              <dd className="mt-2 text-sm space-y-2" data-testid="text-batch-attachment">
                {batch.attachmentFileId ? (
                  <>
                    {attachment?.mimeType?.startsWith("image/") ? (
                      <a
                        href={`/api/files/${batch.attachmentFileId}/download`}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="link-batch-attachment-image"
                      >
                        <img
                          src={`/api/files/${batch.attachmentFileId}/download`}
                          alt={attachment?.fileName || "Batch attachment"}
                          className="max-h-96 max-w-full rounded border bg-muted object-contain"
                          data-testid="img-batch-attachment"
                        />
                      </a>
                    ) : attachment?.mimeType === "application/pdf" ? (
                      <iframe
                        src={`/api/files/${batch.attachmentFileId}/download#view=FitH`}
                        title={attachment?.fileName || "Batch attachment"}
                        className="w-full h-[600px] rounded border bg-muted"
                        data-testid="embed-batch-attachment-pdf"
                      />
                    ) : null}
                    <a
                      href={`/api/files/${batch.attachmentFileId}/download`}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="link-batch-attachment"
                    >
                      <Download className="h-4 w-4" />
                      {attachment?.fileName || "Download attachment"}
                    </a>
                  </>
                ) : (
                  <span className="text-muted-foreground italic">No attachment</span>
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-muted-foreground">Batch ID</dt>
              <dd className="mt-1 text-sm font-mono text-muted-foreground" data-testid="text-batch-id">{batch.id}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PaymentBatchDetailsPage() {
  return (
    <PaymentBatchLayout activeTab="details">
      <BatchDetailsContent />
    </PaymentBatchLayout>
  );
}
