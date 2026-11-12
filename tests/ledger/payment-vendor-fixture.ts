import { vi } from "vitest";
import type { PaymentVendorImplementation } from "../../server/plugins/wc-vendors/payment-types";

// Provider contract suites exercise the pure declarations. Production callers
// cannot import these runners: only WC's registry receives them.
const providers = vi.hoisted(() => new Map<string, PaymentVendorImplementation>());
vi.mock("../../server/plugins/wc-vendors/payment-vendor", () => ({
  definePaymentVendor: (provider: PaymentVendorImplementation) => providers.set(provider.id, provider),
}));
await import("../../server/plugins/wc-vendors/plugins/stripe");
await import("../../server/plugins/wc-vendors/plugins/dummy");
export const stripePaymentGatewayPlugin = providers.get("stripe")!;
export const dummyPaymentGatewayPlugin = providers.get("dummy")!;

export async function fixtureWcRequest(provider: any, context: unknown, operation: string, args: any) {
  const methods: Record<string, [string, unknown]> = {
    "payments.customer.create": ["createCustomer", args],
    "payments.customer.retrieve": ["retrieveCustomer", args.customerRef],
    "payments.customer.details": ["getCustomerDetails", args.customerRef],
    "payments.setup-session.create": ["createSetupSession", args],
    "payments.payment-method.attach": ["attachMethod", args],
    "payments.payment-method.detach": ["detachMethod", args.methodRef],
    "payments.payment-method.summary": ["getMethodSummary", args.methodRef],
    "payments.payment-method.details": ["getMethodDetails", args.methodRef],
  };
  const [method, input] = methods[operation];
  try { return { outcome: "success", value: await provider[method](context, input) }; }
  catch (cause) { return { outcome: "failure", cause }; }
}
