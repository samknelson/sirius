import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Eye, Download } from "lucide-react";
import { useParams } from "wouter";
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
}

interface LedgerEntryWithDetails {
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
}

interface InvoiceDetails {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
  entries: LedgerEntryWithDetails[];
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

function EAInvoicesContent() {
  const { id } = useParams<{ id: string }>();
  const [selectedInvoice, setSelectedInvoice] = useState<{ month: number; year: number } | null>(null);

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
                <TableHead className="text-right">Invoice Balance</TableHead>
                <TableHead className="text-right">Outgoing Balance</TableHead>
                <TableHead className="text-right">Entries</TableHead>
                <TableHead>Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow 
                  key={`${invoice.year}-${invoice.month}`}
                  data-testid={`row-invoice-${invoice.year}-${invoice.month}`}
                >
                  <TableCell data-testid={`cell-period-${invoice.year}-${invoice.month}`}>
                    {MONTH_NAMES[invoice.month - 1]} {invoice.year}
                  </TableCell>
                  <TableCell 
                    className={`text-right ${parseFloat(invoice.incomingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid={`cell-incoming-${invoice.year}-${invoice.month}`}
                  >
                    {formatAmount(invoice.incomingBalance)}
                  </TableCell>
                  <TableCell 
                    className={`text-right ${parseFloat(invoice.invoiceBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid={`cell-invoice-${invoice.year}-${invoice.month}`}
                  >
                    {formatAmount(invoice.invoiceBalance)}
                  </TableCell>
                  <TableCell 
                    className={`text-right ${parseFloat(invoice.outgoingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid={`cell-outgoing-${invoice.year}-${invoice.month}`}
                  >
                    {formatAmount(invoice.outgoingBalance)}
                  </TableCell>
                  <TableCell 
                    className="text-right"
                    data-testid={`cell-count-${invoice.year}-${invoice.month}`}
                  >
                    {invoice.entryCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedInvoice({ month: invoice.month, year: invoice.year })}
                        data-testid={`button-view-${invoice.year}-${invoice.month}`}
                      >
                        <Eye className="h-4 w-4" />
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
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!selectedInvoice} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          {selectedInvoice && (
            <InvoiceDetailsModal
              eaId={id!}
              month={selectedInvoice.month}
              year={selectedInvoice.year}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface InvoiceDetailsModalProps {
  eaId: string;
  month: number;
  year: number;
}

function InvoiceDetailsModal({ eaId, month, year }: InvoiceDetailsModalProps) {
  const { data: invoiceDetails, isLoading, error } = useQuery<InvoiceDetails>({
    queryKey: [`/api/ledger/ea/${eaId}/invoices/${month}/${year}`],
    enabled: !!eaId && !!month && !!year,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Failed to load invoice details</p>
        <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
      </div>
    );
  }

  if (!invoiceDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Invoice not found</p>
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Invoice: {MONTH_NAMES[invoiceDetails.month - 1]} {invoiceDetails.year}
        </DialogTitle>
      </DialogHeader>

      {invoiceDetails.invoiceHeader && (
        <div 
          className="mb-4" 
          data-testid="invoice-header"
          dangerouslySetInnerHTML={{ __html: invoiceDetails.invoiceHeader }}
        />
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Incoming Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div 
              className={`text-2xl font-bold ${parseFloat(invoiceDetails.incomingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`balance-incoming-${year}-${month}`}
            >
              {formatAmount(invoiceDetails.incomingBalance)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Invoice Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div 
              className={`text-2xl font-bold ${parseFloat(invoiceDetails.invoiceBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`balance-invoice-${year}-${month}`}
            >
              {formatAmount(invoiceDetails.invoiceBalance)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outgoing Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div 
              className={`text-2xl font-bold ${parseFloat(invoiceDetails.outgoingBalance) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
              data-testid={`balance-outgoing-${year}-${month}`}
            >
              {formatAmount(invoiceDetails.outgoingBalance)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ledger Entries</CardTitle>
          <CardDescription>
            {invoiceDetails.entryCount} {invoiceDetails.entryCount === 1 ? 'entry' : 'entries'} for this month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invoiceDetails.entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground" data-testid="text-no-entries">
                No ledger entries found for this invoice
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Memo</TableHead>
                    <TableHead>Entity Type</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoiceDetails.entries.map((entry) => {
                    const formattedDate = entry.date 
                      ? (() => {
                          try {
                            return new Date(entry.date).toLocaleDateString();
                          } catch {
                            return 'Invalid date';
                          }
                        })()
                      : 'No date';
                    
                    return (
                      <TableRow key={entry.id} data-testid={`entry-row-${entry.id}`}>
                        <TableCell data-testid={`entry-date-${entry.id}`}>
                          {formattedDate}
                        </TableCell>
                        <TableCell 
                          className={`text-right ${parseFloat(entry.amount) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                          data-testid={`entry-amount-${entry.id}`}
                        >
                          {formatAmount(entry.amount)}
                        </TableCell>
                        <TableCell data-testid={`entry-memo-${entry.id}`}>
                          {entry.memo || '-'}
                        </TableCell>
                        <TableCell className="capitalize" data-testid={`entry-entity-type-${entry.id}`}>
                          {entry.entityType}
                        </TableCell>
                        <TableCell data-testid={`entry-entity-name-${entry.id}`}>
                          {entry.entityName || '-'}
                        </TableCell>
                        <TableCell data-testid={`entry-reference-${entry.id}`}>
                          {entry.referenceName || '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {invoiceDetails.invoiceFooter && (
        <div 
          className="mt-4" 
          data-testid="invoice-footer"
          dangerouslySetInnerHTML={{ __html: invoiceDetails.invoiceFooter }}
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
