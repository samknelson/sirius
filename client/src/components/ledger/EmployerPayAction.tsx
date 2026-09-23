import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export type EmployerCheckout = {
  available: string;
  invoices: { invoiceNumber: string; month: number; year: number; invoiceBalance: string }[];
};

export function EmployerPayAction({ eaId, checkout, invoiceNumber }: {
  eaId: string;
  checkout?: EmployerCheckout;
  invoiceNumber?: string;
}) {
  if (!checkout || Number(checkout.available) <= 0) return null;
  if (invoiceNumber && !checkout.invoices.some(invoice =>
    invoice.invoiceNumber === invoiceNumber && Number(invoice.invoiceBalance) > 0)) return null;
  const url = `/pay/${encodeURIComponent(eaId)}${invoiceNumber ? `?invoice=${encodeURIComponent(invoiceNumber)}` : ""}`;
  return <Button asChild size="sm" className="print-hidden">
    <Link href={url}>{invoiceNumber ? "Pay this invoice" : "Pay online"}</Link>
  </Button>;
}