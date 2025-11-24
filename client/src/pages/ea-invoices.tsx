import { EALayout } from "@/components/layouts/EALayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Loader2 } from "lucide-react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface InvoiceSummary {
  month: number;
  year: number;
  totalAmount: string;
  entryCount: number;
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
                <TableHead>Month</TableHead>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead className="text-right">Entries</TableHead>
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
                  <TableCell data-testid={`cell-month-${invoice.year}-${invoice.month}`}>
                    {MONTH_NAMES[invoice.month - 1]}
                  </TableCell>
                  <TableCell data-testid={`cell-year-${invoice.year}-${invoice.month}`}>
                    {invoice.year}
                  </TableCell>
                  <TableCell 
                    className={`text-right ${parseFloat(invoice.totalAmount) < 0 ? "text-red-600 dark:text-red-400" : ""}`}
                    data-testid={`cell-amount-${invoice.year}-${invoice.month}`}
                  >
                    {formatAmount(invoice.totalAmount)}
                  </TableCell>
                  <TableCell 
                    className="text-right"
                    data-testid={`cell-count-${invoice.year}-${invoice.month}`}
                  >
                    {invoice.entryCount}
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
