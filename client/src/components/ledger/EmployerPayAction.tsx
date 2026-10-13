import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export type EmployerCheckout = {
  available: string;
  pendingCheckouts?: { id: string; status: string }[];
  invoices: { invoiceNumber: string; month: number; year: number; invoiceBalance: string }[];
};

export function EmployerPayAction({ eaId, checkout, invoiceNumber }: {
  eaId: string;
  checkout?: EmployerCheckout;
  invoiceNumber?: string;
}) {
  if (!checkout) return null;
  if (Number(checkout.available) <= 0) {
    if (invoiceNumber || !checkout.pendingCheckouts?.length) return null;
    return <Button asChild size="sm" variant="outline" className="print-hidden">
      <Link href={`/pay/${encodeURIComponent(eaId)}`}>Check payment status</Link>
    </Button>;
  }
  if (invoiceNumber && !checkout.invoices.some(invoice =>
    invoice.invoiceNumber === invoiceNumber && Number(invoice.invoiceBalance) > 0)) return null;
  const url = `/pay/${encodeURIComponent(eaId)}${invoiceNumber ? `?invoice=${encodeURIComponent(invoiceNumber)}` : ""}`;
  return <Button asChild size="sm" className="print-hidden">
    <Link href={url}>{invoiceNumber ? "Pay this invoice" : "Pay online"}</Link>
  </Button>;
}