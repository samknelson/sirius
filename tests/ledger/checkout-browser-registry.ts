// Browser fixture deliberately has no payment provider. A compatible saved
// method makes the real checkout reviewable without loading Stripe scripts.
export function hasPaymentGatewayPayComponent(_id: string): boolean {
  return false;
}

export function resolvePaymentGatewayPayComponent(_id: string): never {
  throw new Error("Payment provider must not load in the checkout fixture");
}