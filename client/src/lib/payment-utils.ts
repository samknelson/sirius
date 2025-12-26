import type { LedgerPayment, LedgerPaymentType } from "@shared/schema";
import { formatAmount } from "@shared/currency";

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

  // Amount with currency formatting
  const amount = parseFloat(payment.amount);
  const currencyCode = paymentType?.currencyCode || 'USD';
  parts.push(formatAmount(amount, currencyCode));

  return parts.join(" - ");
}
