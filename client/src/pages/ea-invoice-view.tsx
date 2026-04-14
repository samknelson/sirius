import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileText, Loader2, ArrowLeft, Printer, ChevronDown, ChevronRight } from "lucide-react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

interface InvoiceSectionEntry {
  id: string;
  amount: string;
  date: string | null;
  memo: string | null;
  eaId: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceName: string | null;
  entityType: string;
  entityId: string;
  entityName: string | null;
  eaAccountId: string;
  eaAccountName: string | null;
  paymentTypeCategory?: string | null;
  paymentStatementMonth?: number | null;
  paymentStatementYear?: number | null;
}

interface InvoiceSection {
  entries: InvoiceSectionEntry[];
  subtotal: string;
}

interface InvoiceDetails {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
  entries: InvoiceSectionEntry[];
  sections: {
    charges: InvoiceSection;
    adjustments: InvoiceSection;
    paymentsReceived: InvoiceSection;
    paymentsApplied: InvoiceSection;
  };
  invoiceHeader?: string | null;
  invoiceFooter?: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

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

interface StatementSectionProps {
  title: string;
  explainer: string;
  section: InvoiceSection;
  defaultOpen?: boolean;
  indent?: boolean;
}

function StatementSection({ title, explainer, section, defaultOpen = false, indent = false }: StatementSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasEntries = section.entries.length > 0;

  return (
    <Card className={`statement-section ${indent ? "ml-4 border-l-2 border-l-muted" : ""}`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className={indent ? "text-base" : "text-lg"}>{title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{explainer}</p>
            </div>
            <div className="flex items-center gap-4">
              <span
                className={`${indent ? "text-lg" : "text-xl"} font-bold ${parseFloat(section.subtotal) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                data-testid={`subtotal-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {formatAmount(section.subtotal)}
              </span>
              {hasEntries && (
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="print-hidden">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              )}
            </div>
          </div>
        </CardHeader>
        {hasEntries && (
          <CollapsibleContent forceMount className={`statement-section-content ${!open ? "hidden print:block" : ""}`}>
            <CardContent className="pt-0">
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
                    {section.entries.map((entry) => (
                      <TableRow key={entry.id} data-testid={`entry-row-${entry.id}`}>
                        <TableCell>{formatDate(entry.date)}</TableCell>
                        <TableCell
                          className={`text-right ${parseFloat(entry.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                        >
                          {formatAmount(entry.amount)}
                        </TableCell>
                        <TableCell>{entry.memo || '-'}</TableCell>
                        <TableCell>{entry.referenceName || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </CollapsibleContent>
        )}
      </Collapsible>
    </Card>
  );
}

function EAInvoiceViewContent() {
  const { id, month, year } = useParams<{ id: string; month: string; year: string }>();

  const { data: invoiceDetails, isLoading, error } = useQuery<InvoiceDetails>({
    queryKey: [`/api/ledger/ea/${id}/invoices/${month}/${year}`],
    enabled: !!id && !!month && !!year,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !invoiceDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">
          {error ? "Failed to load statement details" : "Statement not found"}
        </p>
        <Link href={`/ea/${id}/invoices`}>
          <Button variant="outline" className="mt-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Invoices
          </Button>
        </Link>
      </div>
    );
  }

  const chargesAmt = parseFloat(invoiceDetails.sections.charges.subtotal);
  const adjustmentsAmt = parseFloat(invoiceDetails.sections.adjustments.subtotal);
  const invoicedAmount = chargesAmt + adjustmentsAmt;
  const paymentsAppliedAmt = parseFloat(invoiceDetails.sections.paymentsApplied.subtotal);
  const difference = invoicedAmount + paymentsAppliedAmt;

  return (
    <div className="statement-page space-y-4">
      <div className="flex items-center justify-between print-hidden">
        <Link href={`/ea/${id}/invoices`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Invoices
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      <div className="statement-title">
        <h2 className="text-2xl font-bold">
          Statement: {MONTH_NAMES[invoiceDetails.month - 1]} {invoiceDetails.year}
        </h2>
      </div>

      {invoiceDetails.invoiceHeader && (
        <div
          className="mb-2"
          data-testid="invoice-header"
          dangerouslySetInnerHTML={{ __html: invoiceDetails.invoiceHeader }}
        />
      )}

      <Card className="statement-section">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">Incoming Balance</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Balance carried forward from prior periods.</p>
            </div>
            <span
              className={`text-xl font-bold ${parseFloat(invoiceDetails.incomingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid="incoming-balance"
            >
              {formatAmount(invoiceDetails.incomingBalance)}
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card className="statement-section">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">Invoiced Amount</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Charges and adjustments for this statement period.</p>
            </div>
            <span
              className={`text-xl font-bold ${invoicedAmount < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid="invoiced-amount"
            >
              {formatAmount(invoicedAmount)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <StatementSection
            title="Charges"
            explainer="Charges incurred during this statement period."
            section={invoiceDetails.sections.charges}
            indent
          />

          <StatementSection
            title="Adjustments"
            explainer="Adjustments applied to this statement period."
            section={invoiceDetails.sections.adjustments}
            indent
          />
        </CardContent>
      </Card>

      <StatementSection
        title="Payments Received"
        explainer="Payment transactions recorded during this statement period. These reflect when payments were received, not which statement they are allocated against."
        section={invoiceDetails.sections.paymentsReceived}
      />

      <Card className="border-2 border-primary/20 statement-section">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Outgoing Balance</CardTitle>
            <span
              className={`text-2xl font-bold ${parseFloat(invoiceDetails.outgoingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid="outgoing-balance"
            >
              {formatAmount(invoiceDetails.outgoingBalance)}
            </span>
          </div>
        </CardHeader>
      </Card>

      <div className="border-t border-border pt-4 mt-4">
        <Card className="statement-section bg-muted/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <CardTitle className="text-lg">Payments Applied</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Payments allocated against this statement period. These may have been received in a different period.
                </p>
              </div>
              <span
                className={`text-xl font-bold ${paymentsAppliedAmt < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                data-testid="subtotal-payments-applied"
              >
                {formatAmount(paymentsAppliedAmt)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {invoiceDetails.sections.paymentsApplied.entries.length > 0 && (
              <PaymentsAppliedDetail section={invoiceDetails.sections.paymentsApplied} />
            )}

            <div className="rounded-md border bg-background p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Invoiced Amount</span>
                <span className="text-sm font-medium">{formatAmount(invoicedAmount)}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Payments Applied</span>
                <span className={`text-sm font-medium ${paymentsAppliedAmt < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {formatAmount(paymentsAppliedAmt)}
                </span>
              </div>
              <div className="border-t pt-2 flex items-center justify-between">
                <span className="text-sm font-medium">Remaining</span>
                <span className={`text-base font-bold ${difference < 0 ? "text-red-600 dark:text-red-400" : difference === 0 ? "text-green-600 dark:text-green-400" : ""}`}>
                  {formatAmount(difference)}
                </span>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              These payments are shown on this invoice for informational and reconciliation purposes. Payments are applied
              to your account as of the date they are received, and you will see them included in that statement
              period's balance in the "Payments Received" section of that statement. Also, please note: per the funds
              collections policies, payments are always credited to the oldest outstanding balance when calculating
              interest &amp; penalties.
            </p>
          </CardContent>
        </Card>
      </div>

      {invoiceDetails.invoiceFooter && (
        <div
          className="mt-2"
          data-testid="invoice-footer"
          dangerouslySetInnerHTML={{ __html: invoiceDetails.invoiceFooter }}
        />
      )}
    </div>
  );
}

function PaymentsAppliedDetail({ section }: { section: InvoiceSection }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="print-hidden">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="ml-1 text-sm">{section.entries.length} {section.entries.length === 1 ? 'transaction' : 'transactions'}</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent forceMount className={`statement-section-content ${!open ? "hidden print:block" : ""}`}>
        <div className="rounded-md border mt-2">
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
              {section.entries.map((entry) => (
                <TableRow key={entry.id} data-testid={`entry-row-${entry.id}`}>
                  <TableCell>{formatDate(entry.date)}</TableCell>
                  <TableCell
                    className={`text-right ${parseFloat(entry.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                  >
                    {formatAmount(entry.amount)}
                  </TableCell>
                  <TableCell>{entry.memo || '-'}</TableCell>
                  <TableCell>{entry.referenceName || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function EAInvoiceView() {
  return (
    <EALayout activeTab="invoices">
      <EAInvoiceViewContent />
    </EALayout>
  );
}
