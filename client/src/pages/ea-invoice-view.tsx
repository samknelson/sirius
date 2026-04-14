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

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
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
}

function StatementSection({ title, explainer, section, defaultOpen = false }: StatementSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasEntries = section.entries.length > 0;

  return (
    <Card className="statement-section">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{explainer}</p>
            </div>
            <div className="flex items-center gap-4">
              <span
                className={`text-xl font-bold ${parseFloat(section.subtotal) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
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

      <StatementSection
        title="Charges"
        explainer="Charges incurred during this statement period."
        section={invoiceDetails.sections.charges}
      />

      <StatementSection
        title="Adjustments"
        explainer="Adjustments applied to this statement period."
        section={invoiceDetails.sections.adjustments}
      />

      <StatementSection
        title="Payments Received"
        explainer="Payment transactions recorded during this statement period. These reflect when payments were received, not which statement they are allocated against."
        section={invoiceDetails.sections.paymentsReceived}
      />

      <StatementSection
        title="Payments Applied"
        explainer="Payments allocated against this statement period. These may have been received in a different period."
        section={invoiceDetails.sections.paymentsApplied}
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

export default function EAInvoiceView() {
  return (
    <EALayout activeTab="invoices">
      <EAInvoiceViewContent />
    </EALayout>
  );
}
