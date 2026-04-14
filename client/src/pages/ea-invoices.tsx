import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, Eye, Download } from "lucide-react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
  incomingBalance: string;
  invoiceBalance: string;
  outgoingBalance: string;
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
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EAInvoices() {
  return (
    <EALayout activeTab="invoices">
      <EAInvoicesContent />
    </EALayout>
  );
}
