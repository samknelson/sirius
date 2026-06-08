import type { PaymentGatewayPlugin } from "../types";
import { registerPaymentGatewayPlugin } from "../registry";

/**
 * Stripe payment gateway. Metadata-only: each `payment-gateway` config row of
 * this plugin names the secret holding the Stripe API credentials (stored as
 * `data.secretName`; resolved from the environment at use-time). Gated on the
 * existing `ledger.stripe` component.
 */
export const stripePaymentGatewayPlugin: PaymentGatewayPlugin = {
  id: "stripe",
  name: "Stripe",
  description:
    "Stripe payment gateway. Each configuration names the secret that holds the Stripe API credentials.",
  requiredComponent: "ledger.stripe",
};

registerPaymentGatewayPlugin(stripePaymentGatewayPlugin);
