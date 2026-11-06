// Administrator attestation, never a substitute for the worker's own consent.
export const ADMIN_PAYMENT_CONFIRMATION = {
  version: "admin-on-behalf-v1",
  text: "I am authorized to make this payment on the worker's behalf. I understand that confirming with the payment provider can charge real funds.",
} as const;
