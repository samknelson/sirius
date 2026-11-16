import { z } from "zod";

export const checkoutStateSchema = z.enum([
  "created", "requires_action", "processing", "succeeded", "failed", "canceled", "expired",
]);

/** Server-owned, bounded state, never a provider event inbox or raw response. */
export const paymentLifecycleSchema = z.object({
  version: z.literal(1),
  saveMethod: z.boolean(),
  consent: z.unknown().nullable(),
  statementSelection: z.array(z.object({
    invoiceNumber: z.string().max(200),
    amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  }).strict()).max(500),
  metadata: z.record(z.unknown()),
  reservationExpiresAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  lastProviderEventCreated: z.number().int().nullable(),
  failureMessage: z.string().max(1000).nullable(),
  failureCode: z.string().max(200).nullable(),
}).strict().superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 512_000)
    ctx.addIssue({ code: "custom", message: "Checkout snapshot exceeds its size limit" });
});

export type PaymentLifecycle = z.infer<typeof paymentLifecycleSchema>;

/** Private service projection of a payment; not a second persisted entity. */
export interface CheckoutPayment {
  id: string;
  workerId: string | null;
  accountId: string;
  entityType: string;
  entityId: string;
  createdByUserId: string | null;
  ledgerEaId: string;
  gatewayConfigId: string;
  paymentMethodId: string | null;
  providerIntentRef: string | null;
  idempotencyKey: string;
  amount: string;
  currency: string;
  status: z.infer<typeof checkoutStateSchema>;
  saveMethod: boolean;
  consent: unknown;
  statementSelection: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
  reservationExpiresAt: Date | null;
  lastProviderEventCreated: number | null;
  failureMessage: string | null;
  failureCode: string | null;
  metadata: unknown;
  /** Compatibility receipt indicator: same id, absent until receipt. */
  ledgerPaymentId: string | null;
}

export type CreateCheckoutPayment = Pick<CheckoutPayment,
  "ledgerEaId" | "gatewayConfigId" | "idempotencyKey" | "amount" | "currency"> &
  Partial<Omit<CheckoutPayment, "id" | "ledgerPaymentId">>;

export const PRIVATE_PAYMENT_FIELDS = [
  "checkoutState", "checkoutKey", "checkoutProviderRef", "checkoutGatewayId",
  "checkoutAccountId", "checkoutWorkerId", "checkoutCreatorId", "checkoutMethodId",
  "checkoutCurrency", "checkoutData", "checkoutCreatedAt", "checkoutUpdatedAt",
] as const;

/** Runtime projection, including extra joined fields. Never just a TS omit. */
export function publicPayment<T extends object>(row: T): Omit<T, typeof PRIVATE_PAYMENT_FIELDS[number]> {
  const result = { ...row } as Record<string, unknown>;
  for (const key of PRIVATE_PAYMENT_FIELDS) delete result[key];
  return result as Omit<T, typeof PRIVATE_PAYMENT_FIELDS[number]>;
}
