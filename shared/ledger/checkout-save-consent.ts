/**
 * Saving a method is a separate, optional authorization from the current
 * payment authorization. Keep this copy stable so the server can validate and
 * snapshot exactly what the payer accepted.
 */
export const CHECKOUT_SAVE_METHOD_CONSENT = {
  version: "checkout-save-v1",
  text: "Save this payment method for future payments. This does not authorize future charges or automatic payments.",
} as const;
