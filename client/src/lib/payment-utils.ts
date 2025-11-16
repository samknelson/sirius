import type { LedgerPayment, LedgerPaymentType } from "@shared/schema";

export function getPaymentTitle(
  payment: LedgerPayment,
  paymentType?: LedgerPaymentType
): string {
  const parts: string[] = [];

  // Payment type name
  if (paymentType?.name) {
    parts.push(paymentType.name);
  }

  // Date received
  if (payment.dateReceived) {
    const date = new Date(payment.dateReceived);
    parts.push(date.toLocaleDateString());
  }

  // Merchant and Transaction Number
  const details = payment.details as any;
  const merchantAndTransaction: string[] = [];
  
  if (details?.merchant) {
    merchantAndTransaction.push(details.merchant);
  }
  
  if (details?.checkTransactionNumber) {
    merchantAndTransaction.push(`#${details.checkTransactionNumber}`);
  }
  
  if (merchantAndTransaction.length > 0) {
    parts.push(merchantAndTransaction.join(" "));
  }

  // Amount
  const amount = parseFloat(payment.amount);
  parts.push(`$${amount.toFixed(2)}`);

  return parts.join(" - ");
}
