// Fixture provider exercises handoff without contacting Stripe or collecting credentials.
import { createElement } from "react";
import type { PaymentGatewayPayProps } from "../../client/src/plugins/payment-gateway/registry";
export function hasPaymentGatewayPayComponent(_id: string): boolean {
  return true;
}

export function resolvePaymentGatewayPayComponent(_id: string) {
  return ({ publicConfig, onComplete }: PaymentGatewayPayProps) =>
    createElement("div", { "data-testid": "fixture-provider" },
      `Secure ${String((publicConfig.paymentTypes as string[])?.[0])} entry`,
      createElement("button", { onClick: () => onComplete("processing") }, "Confirm provider payment"));
}