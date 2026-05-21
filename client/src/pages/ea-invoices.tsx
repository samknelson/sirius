import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileText, Loader2, Eye, Download, Info } from "lucide-react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
  chargesSubtotal: string;
  adjustmentsSubtotal: string;
  paymentsReceivedSubtotal: string;
  paymentsAppliedSubtotal: string;
}

interface InvoiceSectionEntry {
  id: string;
  amount: string;
  date: string | null;
  memo: string | null;
  referenceName: string | null;
}

interface InvoiceSection {
  entries: InvoiceSectionEntry[];
  subtotal: string;
}

interface InvoiceDetails {
  month: number;
  year: number;
  sections: {
    charges: InvoiceSection;
    adjustments: InvoiceSection;
    paymentsReceived: InvoiceSection;
    paymentsApplied: InvoiceSection;
  };
}

type SectionKey = "invoicedAmount" | "paymentsApplied";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const SECTION_EXPLAINERS: Record<SectionKey, string> = {
  invoicedAmount: "Charges and adjustments for this statement period.",
  paymentsApplied: "Payments allocated against this statement period. These may have been received in a different period.",
};

function formatAmount(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(num);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No date';
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return 'Invalid date';
  }
}

function amountClass(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num < 0 ? "text-red-600 dark:text-red-400" : "";
}

interface SectionModalState {
  invoice: InvoiceSummary;
  section: SectionKey;
}

function SectionDetailModal({ state, onClose, eaId }: { state: SectionModalState; onClose: () => void; eaId: string }) {
  const { invoice, section } = state;

  const { data: details, isLoading } = useQuery<InvoiceDetails>({
    queryKey: [`/api/ledger/ea/${eaId}/invoices/${invoice.month}/${invoice.year}`],
  });

  const title = section === "invoicedAmount" ? "Invoiced Amount"
    : section === "paymentsReceived" ? "Payments Received"
    : "Payments Applied";

  const periodLabel = `${MONTH_NAMES[invoice.month - 1]} ${invoice.year}`;

  function renderEntryTable(entries: InvoiceSectionEntry[], subtotal: string, label?: string) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Memo</TableHead>
              <TableHead>Reference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">
                  No {label?.toLowerCase() || "entries"} for this period.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell className={`text-right ${amountClass(entry.amount)}`}>
                    {formatAmount(entry.amount)}
                  </TableCell>
                  <TableCell>{entry.memo || '-'}</TableCell>
                  <TableCell>{entry.referenceName || '-'}</TableCell>
                </TableRow>
              ))
            )}
            <TableRow className="bg-muted/50 font-medium">
              <TableCell colSpan={1}>{label || "Subtotal"}</TableCell>
              <TableCell className={`text-right ${amountClass(subtotal)}`}>
                {formatAmount(subtotal)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title} — {periodLabel}</DialogTitle>
          <DialogDescription>{SECTION_EXPLAINERS[section]}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !details ? (
          <p className="py-4 text-sm text-muted-foreground">Failed to load details.</p>
        ) : section === "invoicedAmount" ? (
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-2">Charges</h4>
              <p className="text-xs text-muted-foreground mb-2">Charges incurred during this statement period.</p>
              {renderEntryTable(details.sections.charges.entries, details.sections.charges.subtotal, "Charges")}
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-2">Adjustments</h4>
              <p className="text-xs text-muted-foreground mb-2">Adjustments applied to this statement period.</p>
              {renderEntryTable(details.sections.adjustments.entries, details.sections.adjustments.subtotal, "Adjustments")}
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Invoiced Amount Total</span>
                <span className={`text-base font-bold ${amountClass(
                  parseFloat(details.sections.charges.subtotal) + parseFloat(details.sections.adjustments.subtotal)
                )}`}>
                  {formatAmount(parseFloat(details.sections.charges.subtotal) + parseFloat(details.sections.adjustments.subtotal))}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {renderEntryTable(details.sections.paymentsApplied.entries, details.sections.paymentsApplied.subtotal, "Payments Applied")}
            <p className="text-xs text-muted-foreground leading-relaxed">
              These payments are shown on this invoice for informational and reconciliation purposes. Per the funds
              collections policies, payments are always credited to the oldest outstanding balance when calculating
              interest &amp; penalties.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClickableAmountCell({
  amount,
  onClick,
  testId,
  className,
}: {
  amount: string;
  onClick: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <TableCell
      className={`text-right cursor-pointer hover:bg-muted/50 transition-colors ${amountClass(amount)} ${className || ""}`}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="underline decoration-dotted underline-offset-2">
        {formatAmount(amount)}
      </span>
    </TableCell>
  );
}

function EAInvoicesContent() {
  const { id } = useParams<{ id: string }>();
  const [modalState, setModalState] = useState<SectionModalState | null>(null);

  const { data: invoices, isLoading } = useQuery<InvoiceSummary[]>({
    queryKey: [`/api/ledger/ea/${id}/invoices`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Monthly invoices for this account entry</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>Monthly invoices for this account entry</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground" data-testid="text-no-invoices">
              No invoices found. Invoices will appear once there are ledger entries for this account.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            Monthly invoices generated from ledger entries ({invoices.length} total)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Incoming Balance</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1" title="Charges + Adjustments combined">
                      Invoiced Amount
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </span>
                  </TableHead>
                  <TableHead className="text-right">Outgoing Balance</TableHead>
                  <TableHead className="text-right border-l-2 border-border">Payments Applied</TableHead>
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-1" title="Invoiced Amount + Payments Applied (positive = underpaid)">
                      Invoice Balance
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </span>
                  </TableHead>
                  <TableHead>Tools</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const invoicedAmount = (
                    parseFloat(invoice.chargesSubtotal) + parseFloat(invoice.adjustmentsSubtotal)
                  ).toFixed(2);

                  return (
                    <TableRow
                      key={`${invoice.year}-${invoice.month}`}
                      data-testid={`row-invoice-${invoice.year}-${invoice.month}`}
                    >
                      <TableCell data-testid={`cell-period-${invoice.year}-${invoice.month}`}>
                        {MONTH_NAMES[invoice.month - 1]} {invoice.year}
                      </TableCell>
                      <TableCell
                        className={`text-right ${amountClass(invoice.incomingBalance)}`}
                        data-testid={`cell-incoming-${invoice.year}-${invoice.month}`}
                      >
                        {formatAmount(invoice.incomingBalance)}
                      </TableCell>
                      <ClickableAmountCell
                        amount={invoicedAmount}
                        onClick={() => setModalState({ invoice, section: "invoicedAmount" })}
                        testId={`cell-invoiced-${invoice.year}-${invoice.month}`}
                      />
                      <TableCell
                        className={`text-right ${amountClass(invoice.outgoingBalance)}`}
                        data-testid={`cell-outgoing-${invoice.year}-${invoice.month}`}
                      >
                        {formatAmount(invoice.outgoingBalance)}
                      </TableCell>
                      <ClickableAmountCell
                        amount={invoice.paymentsAppliedSubtotal}
                        onClick={() => setModalState({ invoice, section: "paymentsApplied" })}
                        testId={`cell-applied-${invoice.year}-${invoice.month}`}
                        className="border-l-2 border-border"
                      />
                      {(() => {
                        const invoiceBalance = (
                          parseFloat(invoicedAmount) + parseFloat(invoice.paymentsAppliedSubtotal)
                        ).toFixed(2);
                        const balanceNum = parseFloat(invoiceBalance);
                        return (
                          <TableCell
                            className={`text-right font-medium ${balanceNum > 0.005 ? "text-amber-600 dark:text-amber-400" : balanceNum < -0.005 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                            data-testid={`cell-balance-${invoice.year}-${invoice.month}`}
                          >
                            {formatAmount(invoiceBalance)}
                          </TableCell>
                        );
                      })()}
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            data-testid={`button-view-${invoice.year}-${invoice.month}`}
                          >
                            <Link href={`/ea/${id}/invoices/${invoice.month}/${invoice.year}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            data-testid={`button-download-${invoice.year}-${invoice.month}`}
                          >
                            <a
                              href={`/api/ledger/ea/${id}/invoices/${invoice.month}/${invoice.year}/pdf`}
                              download
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {modalState && (
        <SectionDetailModal
          state={modalState}
          onClose={() => setModalState(null)}
          eaId={id!}
        />
      )}
    </>
  );
}

export default function EAInvoices() {
  return (
    <EALayout activeTab="invoices">
      <EAInvoicesContent />
    </EALayout>
  );
}
