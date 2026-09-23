import { z } from "zod";

/**
 * Provider method types supported by the first online-checkout contract.
 * Redirect, voucher, BNPL and other charge-only methods stay disabled until
 * their settlement and consent semantics are designed explicitly.
 */
export const ONLINE_PAYMENT_METHOD_TYPES = ["card", "us_bank_account"] as const;
export const onlinePaymentMethodTypeSchema = z.enum(ONLINE_PAYMENT_METHOD_TYPES);
export type OnlinePaymentMethodType = z.infer<typeof onlinePaymentMethodTypeSchema>;

export const ONLINE_PAYMENT_PAYER_TYPES = ["worker", "employer"] as const;
export const onlinePaymentPayerTypeSchema = z.enum(ONLINE_PAYMENT_PAYER_TYPES);
export type OnlinePaymentPayerType = z.infer<typeof onlinePaymentPayerTypeSchema>;

export const DEFAULT_ONLINE_PAYMENT_SETTINGS = {
  enabled: false,
  payerTypes: [...ONLINE_PAYMENT_PAYER_TYPES],
  allowPartial: true,
  minAmount: 1,
} as const;

/**
 * Per-ledger-account checkout controls. Defaults are applied whenever an
 * onlinePayments block is written, with checkout disabled unless an
 * administrator deliberately enables it.
 */
export const onlinePaymentSettingsSchema = z.object({
  enabled: z.boolean().default(DEFAULT_ONLINE_PAYMENT_SETTINGS.enabled),
  payerTypes: z.array(onlinePaymentPayerTypeSchema)
    .max(ONLINE_PAYMENT_PAYER_TYPES.length)
    .transform((types) => Array.from(new Set(types)))
    .default([...DEFAULT_ONLINE_PAYMENT_SETTINGS.payerTypes]),
  allowPartial: z.boolean().default(DEFAULT_ONLINE_PAYMENT_SETTINGS.allowPartial),
  minAmount: z.number()
    .finite()
    .multipleOf(0.01)
    .min(1)
    .default(DEFAULT_ONLINE_PAYMENT_SETTINGS.minAmount),
  paymentTypes: z.array(onlinePaymentMethodTypeSchema)
    .min(1)
    .max(ONLINE_PAYMENT_METHOD_TYPES.length)
    .transform((types) => Array.from(new Set(types)))
    .optional(),
}).strict();

export type OnlinePaymentSettings = z.infer<typeof onlinePaymentSettingsSchema>;

/**
 * Stable option ids used when a successful provider payment is posted to the
 * ledger. Migrations seed these exact ids; code must not select a payment type
 * by mutable display name or list order.
 */
export const ONLINE_LEDGER_PAYMENT_TYPE_IDS = {
  card: "online-card",
  ach: "online-bank-ach",
} as const;

export function ledgerPaymentTypeIdForProviderMethod(
  methodType: OnlinePaymentMethodType,
): string {
  return methodType === "us_bank_account"
    ? ONLINE_LEDGER_PAYMENT_TYPE_IDS.ach
    : ONLINE_LEDGER_PAYMENT_TYPE_IDS.card;
}

export const ONLINE_PAYMENT_AUTHORIZATION_VARIABLE =
  "ledger.online_payment_authorizations";

const authorizationTextSchema = z.object({
  version: z.string().trim().min(1),
  text: z.string().trim().min(1),
}).strict();

/**
 * Current authorization language is configuration, not source-code copy.
 * Checkout stores the selected version and rendered text with the consent so
 * later edits never rewrite what a payer accepted.
 */
export const onlinePaymentAuthorizationTextsSchema = z.object({
  consumer: authorizationTextSchema,
  business: authorizationTextSchema,
}).strict();

export type OnlinePaymentAuthorizationTexts = z.infer<
  typeof onlinePaymentAuthorizationTextsSchema
>;