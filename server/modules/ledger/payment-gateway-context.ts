import { storage } from "../../storage";
import { getWcVendorPlugin } from "../../plugins/wc-vendors";
import { wcRequest } from "../../services/webclient";
import { describeWcVendor, type WcVendorDescription } from "../../services/webclient/wc-vendor-context";
import type { WcVendorOperationArgs, WcVendorOperationName, WcVendorOperationResult } from "../../plugins/wc-vendors/types";
import type { CreatePaymentSessionInput } from "../../plugins/wc-vendors/payment-types";

export class GatewayResolutionError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GatewayResolutionError";
  }
}

/**
 * Ledger compatibility facade over per-config WC operations, not a provider
 * registry. Every executable closure below goes through wcRequest. Credentials
 * and provider handlers never leave the WC framework.
 */
export async function resolveGateway(
  gatewayConfigId: string,
  options: { allowDisabled?: boolean } = {},
) {
  const vendor = { configId: gatewayConfigId, ...(options.allowDisabled ? { allowDisabled: true } : {}) };
  const description = await describeWcVendor(vendor);
  const config = await storage.pluginConfigs.get(gatewayConfigId);
  const registered = getWcVendorPlugin(description.pluginId);
  if (!config || !registered) throw new GatewayResolutionError(404, "Payment vendor configuration not found");
  async function request<N extends WcVendorOperationName>(
    operation: N, args: WcVendorOperationArgs<N>,
  ): Promise<WcVendorOperationResult<N>> {
    const result = await wcRequest({ vendor, operation, args });
    if (result.outcome === "success") return result.value as WcVendorOperationResult<N>;
    if (result.cause !== undefined) throw result.cause;
    throw new GatewayResolutionError(503, result.error ?? "The payment vendor did not answer");
  }
  const configuration = await request("payments.configuration.read", undefined);
  // Only non-secret facts cross this boundary.
  const context = { config, webhookSecret: configuration.webhookConfigured };
  const has = (operation: WcVendorOperationName) => !!registered.operations[operation];
  const plugin = {
    id: registered.id, name: registered.name, requiredComponent: registered.requiredComponent,
    addComponentId: registered.addComponentId, payComponentId: registered.payComponentId,
    supportedPaymentTypes: registered.supportedPaymentTypes,
    reusableCheckoutPaymentTypes: registered.reusableCheckoutPaymentTypes,
    isTestMode: (_ctx: unknown) => configuration.isTestMode,
    getCheckoutPaymentTypes: (_ctx: unknown) => configuration.paymentTypes,
    validatePaymentSession: has("payments.session.validate")
      ? (_ctx: unknown, input: CreatePaymentSessionInput, preflight?: { customerWillBeCreated?: boolean }) =>
          request("payments.session.validate", { input, ...preflight })
      : undefined,
    createPaymentSession: has("payments.session.create")
      ? (_ctx: unknown, args: CreatePaymentSessionInput) => request("payments.session.create", args) : undefined,
    createPaymentIntent: has("payments.intent.create")
      ? (_ctx: unknown, args: WcVendorOperationArgs<"payments.intent.create">) => request("payments.intent.create", args) : undefined,
    retrievePaymentIntent: has("payments.intent.retrieve")
      ? (_ctx: unknown, providerRef: string) => request("payments.intent.retrieve", { providerRef }) : undefined,
    retrievePayment: has("payments.payment.retrieve")
      ? (_ctx: unknown, providerRef: string) => request("payments.payment.retrieve", { providerRef }) : undefined,
    cancelPayment: has("payments.payment.cancel")
      ? (_ctx: unknown, providerRef: string, authorization?: { adminAssistedAttemptId: string }) =>
          request("payments.payment.cancel", { providerRef, authorization }) : undefined,
    verifyWebhook: has("payments.webhook.verify")
      ? (_ctx: unknown, rawBody: Buffer, headers: Record<string, string>) =>
          request("payments.webhook.verify", { rawBody, headers }) : undefined,
    getMethodSummary: (_ctx: unknown, methodRef: string) => request("payments.payment-method.summary", { methodRef }),
    attachMethod: has("payments.payment-method.attach")
      ? (_ctx: unknown, args: WcVendorOperationArgs<"payments.payment-method.attach">) =>
          request("payments.payment-method.attach", args) : undefined,
  };
  return { config, plugin, context, configuration, description };
}

export type ResolvedGateway = Awaited<ReturnType<typeof resolveGateway>>;
