import { createHash } from "node:crypto";
import { getEnvironmentVariable, registerEnvironmentVariable } from "../../config/env-registry";
import { registerWcVendorPlugin } from "./registry";
import type { PaymentGatewayContext, PaymentVendorImplementation } from "./payment-types";
import type { WcVendorContext, WcVendorPlugin } from "./types";

/** Provider-local declarations only. The returned registry handle has no runners. */
export function definePaymentVendor(
  implementation: PaymentVendorImplementation,
  service?: WcVendorPlugin["service"],
): void {
  const manualRead = (field: string) => ({
    argsSchema: {
      type: "object" as const,
      properties: { [field]: {
        type: "string" as const, minLength: 1, pattern: "\\S",
        title: field === "customerRef" ? "Customer reference" : "Payment method reference",
      } },
      required: [field], additionalProperties: false,
    },
    effect: "read" as const,
  });
  function context(ctx: WcVendorContext): PaymentGatewayContext {
    const data = ctx.config.data as Record<string, unknown> | null;
    const name = typeof data?.webhookSecretName === "string" ? data.webhookSecretName.trim() : "";
    let webhookSecret: string | undefined;
    if (name) {
      registerEnvironmentVariable({
        name, description: `Webhook signing secret for vendor config '${ctx.config.id}'.`,
        secret: true, category: "webclient", changeTakesEffect: "immediate",
      });
      webhookSecret = getEnvironmentVariable(name);
    }
    return { apiKey: ctx.credential.value, config: ctx.config, webhookSecret };
  }
  const p = implementation;
  // Destructure explicitly: no executable provider methods escape registration.
  const plugin: WcVendorPlugin = {
    id: p.id, name: p.name, description: p.description,
    requiredComponent: p.requiredComponent, requiredPolicy: p.requiredPolicy,
    addComponentId: p.addComponentId, payComponentId: p.payComponentId,
    configFields: p.configFields, validateConfig: p.validateConfig,
    supportedPaymentTypes: p.supportedPaymentTypes,
    reusableCheckoutPaymentTypes: p.reusableCheckoutPaymentTypes,
    service,
    credential: {
      secretName: p.requiresSecret === false ? "optional" : "required",
      setupGuidance: service === "Stripe" ? "The named secret must contain one Stripe secret API key, for example sk_test_<your-key> or sk_live_<your-key>." : undefined,
    },
    operations: {
      "payments.configuration.read": {
        description: "check payment configuration", needsWritableDatabase: false, externalSideEffect: false,
        async run(ctx) {
          const c = context(ctx);
          return {
            isTestMode: p.isTestMode?.(c) === true,
            paymentTypes: p.getCheckoutPaymentTypes?.(c) ?? [],
            webhookConfigured: !!p.verifyWebhook && (p.requiresSecret === false || !!c.webhookSecret),
            fingerprint: createHash("sha256").update(JSON.stringify([
              p.id, c.config.id, c.apiKey,
              (c.config.data as Record<string, unknown> | null)?.publishableKey,
            ])).digest("hex"),
          };
        },
      },
      "payments.session.validate": {
        description: "validate payment prerequisites", needsWritableDatabase: false, externalSideEffect: false,
        async run(ctx, args) { p.validatePaymentSession?.(context(ctx), args.input, args); },
      },
      ...(p.createPaymentSession ? {
        "payments.session.create": {
          description: "create a payment session", needsWritableDatabase: true, externalSideEffect: true,
          async run(ctx, args) { return p.createPaymentSession!(context(ctx), args); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      ...(p.createPaymentIntent ? {
        "payments.intent.create": {
          description: "create a payment", needsWritableDatabase: true, externalSideEffect: true,
          async run(ctx, args) { return p.createPaymentIntent!(context(ctx), args); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      ...(p.retrievePaymentIntent ? {
        "payments.intent.retrieve": {
          description: "retrieve a payment intent", needsWritableDatabase: false,
          async run(ctx, { providerRef }) { return p.retrievePaymentIntent!(context(ctx), providerRef); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      ...(p.retrievePayment ? {
        "payments.payment.retrieve": {
          description: "retrieve a payment", needsWritableDatabase: false,
          async run(ctx, { providerRef }) { return p.retrievePayment!(context(ctx), providerRef); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      ...(p.cancelPayment ? {
        "payments.payment.cancel": {
          description: "cancel a payment", needsWritableDatabase: true, externalSideEffect: true,
          async run(ctx, { providerRef, authorization }) { return p.cancelPayment!(context(ctx), providerRef, authorization); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      ...(p.verifyWebhook ? {
        "payments.webhook.verify": {
          description: "verify a payment webhook", needsWritableDatabase: false, externalSideEffect: false,
          async run(ctx, { rawBody, headers }) { return p.verifyWebhook!(context(ctx), rawBody, headers); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      "service.test-connection": {
        description: "test connection", needsWritableDatabase: false,
        manualRun: { argsSchema: { type: "object", properties: {}, additionalProperties: false }, effect: "read" },
        async run(ctx) { return p.testConnection(context(ctx)); },
      },
      "payments.customer.create": {
        description: "create a customer", needsWritableDatabase: true, externalSideEffect: true,
        async run(ctx, args) { return p.createCustomer(context(ctx), args); },
      },
      ...(p.retrieveCustomer ? {
        "payments.customer.retrieve": {
          description: "check a customer still exists", needsWritableDatabase: false,
          manualRun: manualRead("customerRef"),
          async run(ctx, { customerRef }) { return p.retrieveCustomer!(context(ctx), customerRef); },
        },
      } satisfies WcVendorPlugin["operations"] : {}),
      "payments.customer.details": {
        description: "read customer details", needsWritableDatabase: false,
        manualRun: manualRead("customerRef"),
        async run(ctx, { customerRef }) { return p.getCustomerDetails(context(ctx), customerRef); },
      },
      "payments.setup-session.create": {
        description: "start collecting a payment method", needsWritableDatabase: true, externalSideEffect: true,
        async run(ctx, args) { return p.createSetupSession(context(ctx), args); },
      },
      "payments.payment-method.attach": {
        description: "attach a payment method", needsWritableDatabase: true, externalSideEffect: true,
        async run(ctx, args) { return p.attachMethod(context(ctx), args); },
      },
      "payments.payment-method.summary": {
        description: "read a payment method summary", needsWritableDatabase: false,
        manualRun: manualRead("methodRef"),
        async run(ctx, { methodRef }) { return p.getMethodSummary(context(ctx), methodRef); },
      },
      "payments.payment-method.details": {
        description: "read payment method details", needsWritableDatabase: false,
        manualRun: manualRead("methodRef"),
        async run(ctx, { methodRef }) { return p.getMethodDetails(context(ctx), methodRef); },
      },
      "payments.payment-method.detach": {
        description: "remove a payment method", needsWritableDatabase: true, externalSideEffect: true,
        async run(ctx, { methodRef }) { return p.detachMethod(context(ctx), methodRef); },
      },
    },
  };
  registerWcVendorPlugin(plugin);
}
