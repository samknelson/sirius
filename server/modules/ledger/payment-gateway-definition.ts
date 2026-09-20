import type {
  RegisteredWcVendorPlugin,
  WcVendorOperationName,
} from "../../plugins/wc-vendors/types";

/**
 * The operations a vendor must implement before ledger surfaces may treat it
 * as a payment gateway. Kept in a dependency-light leaf so the vendor config
 * adapter can use the same definition without importing ledger route/storage
 * code back into the plugin registry.
 */
export const PAYMENT_GATEWAY_OPERATIONS: readonly WcVendorOperationName[] = [
  "payments.customer.create",
  "payments.customer.retrieve",
  "payments.customer.details",
  "payments.setup-session.create",
  "payments.payment-method.attach",
  "payments.payment-method.summary",
  "payments.payment-method.details",
  "payments.payment-method.detach",
];

/** True when the plugin declares every operation the ledger's payment flows call. */
export function isPaymentGatewayPlugin(
  plugin: Pick<RegisteredWcVendorPlugin, "operations">,
): boolean {
  return PAYMENT_GATEWAY_OPERATIONS.every(
    (name) => plugin.operations[name] !== undefined,
  );
}