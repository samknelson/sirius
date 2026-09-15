import Stripe from "stripe";
import type {
  WcVendorPlugin,
  WcVendorContext,
  PaymentTypeOption,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
  GatewayCustomerDetails,
} from "../types";
import { registerWcVendorPlugin } from "../registry";

/** Build a Stripe client from the per-config resolved secret. */
function client(ctx: WcVendorContext): Stripe {
  return new Stripe(ctx.credential.value);
}

/** Provider config data may carry a publishable key + payment types. */
function configData(ctx: WcVendorContext): Record<string, unknown> {
  const data = ctx.config.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function dashboardBaseUrl(ctx: WcVendorContext): string {
  return ctx.credential.value.startsWith("sk_test_")
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";
}

/**
 * Thrown when a gateway config has no payment type that can be saved as a
 * reusable method. Carries a 4xx `statusCode` so the route's error mapper can
 * surface it as an actionable client error instead of a generic 500.
 */
class GatewaySetupError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "GatewaySetupError";
  }
}

/**
 * Catalog of Stripe payment method types the editor offers. Stays here (not in
 * the UI) so the payment-types editor remains provider-agnostic. `setupEligible`
 * marks the types that can be SAVED as a reusable method via the SetupIntent
 * (add-a-payment-method) flow; charge-only types (PayPal, BNPL, single-use
 * redirects, vouchers) are excluded from that flow.
 */
const STRIPE_PAYMENT_TYPES: PaymentTypeOption[] = [
  { id: "card", name: "Credit/Debit Card", description: "Accept Visa, Mastercard, Amex, and other cards", setupEligible: true },
  { id: "us_bank_account", name: "US Bank Account (ACH)", description: "ACH direct debit payments", setupEligible: true },
  { id: "cashapp", name: "Cash App Pay", description: "Accept payments via Cash App", setupEligible: true },
  { id: "paypal", name: "PayPal", description: "Accept payments via PayPal", setupEligible: false },
  { id: "link", name: "Link", description: "Stripe's one-click payment method", setupEligible: true },
  { id: "affirm", name: "Affirm", description: "Buy now, pay later with Affirm", setupEligible: false },
  { id: "afterpay_clearpay", name: "Afterpay / Clearpay", description: "Buy now, pay later", setupEligible: false },
  { id: "klarna", name: "Klarna", description: "Buy now, pay later with Klarna", setupEligible: false },
  { id: "alipay", name: "Alipay", description: "Popular payment method in China", setupEligible: false },
  { id: "wechat_pay", name: "WeChat Pay", description: "Popular payment method in China", setupEligible: false },
  { id: "ideal", name: "iDEAL", description: "Popular payment method in Netherlands", setupEligible: false },
  { id: "sepa_debit", name: "SEPA Direct Debit", description: "European bank debits", setupEligible: true },
  { id: "bancontact", name: "Bancontact", description: "Popular payment method in Belgium", setupEligible: false },
  { id: "giropay", name: "Giropay", description: "Popular payment method in Germany", setupEligible: false },
  { id: "eps", name: "EPS", description: "Popular payment method in Austria", setupEligible: false },
  { id: "p24", name: "Przelewy24", description: "Popular payment method in Poland", setupEligible: false },
  { id: "blik", name: "BLIK", description: "Mobile payment method in Poland", setupEligible: false },
  { id: "acss_debit", name: "ACSS Debit", description: "Pre-authorized debit in Canada", setupEligible: true },
  { id: "au_becs_debit", name: "BECS Direct Debit", description: "Direct debit in Australia", setupEligible: true },
  { id: "bacs_debit", name: "Bacs Direct Debit", description: "Direct debit in UK", setupEligible: true },
  { id: "fpx", name: "FPX", description: "Online banking in Malaysia", setupEligible: false },
  { id: "grabpay", name: "GrabPay", description: "Popular digital wallet in Southeast Asia", setupEligible: false },
  { id: "paynow", name: "PayNow", description: "Real-time payment in Singapore", setupEligible: false },
  { id: "promptpay", name: "PromptPay", description: "Real-time payment in Thailand", setupEligible: false },
  { id: "pix", name: "Pix", description: "Instant payment method in Brazil", setupEligible: false },
  { id: "boleto", name: "Boleto", description: "Cash-based voucher payment in Brazil", setupEligible: false },
  { id: "oxxo", name: "OXXO", description: "Cash-based voucher payment in Mexico", setupEligible: false },
  { id: "konbini", name: "Konbini", description: "Cash payment at convenience stores in Japan", setupEligible: false },
  { id: "customer_balance", name: "Customer Balance", description: "Use customer account balance", setupEligible: false },
  { id: "sofort", name: "Sofort", description: "Bank redirect in Europe (deprecated, use Klarna)", setupEligible: false },
];

/** Ids from the catalog that are valid for the save-a-method (SetupIntent) flow. */
const SETUP_ELIGIBLE_TYPE_IDS = new Set(
  STRIPE_PAYMENT_TYPES.filter((t) => t.setupEligible).map((t) => t.id),
);

/**
 * Stripe payment gateway. Each `wc-vendors` config row of this plugin
 * names the secret holding the Stripe API credentials (stored as
 * `data.secretName`; resolved from the environment at use-time). Gated on the
 * existing `ledger.stripe` component. Provider-only — no storage/DB access.
 */
// Not exported: the only supported handle on this plugin is the one the registry
// hands out, whose operations are already on the web client framework. An
// exported literal would be the same plugin with the refusal missing.
const stripeWcVendorPlugin: WcVendorPlugin = {
  id: "stripe",
  name: "Stripe",
  description:
    "Stripe payment gateway. Each configuration names the secret that holds the Stripe API credentials.",
  requiredComponent: "ledger.stripe",
  addComponentId: "stripe:StripeAddPaymentMethod",
  credential: {
    secretName: "required",
    setupGuidance:
      "The named secret must contain one Stripe secret API key, for example sk_test_<your-key> or sk_live_<your-key>.",
  },

  // The publishable key the browser needs to load Stripe Elements. Stored in
  // the config's `data` json (no schema change). Required: there is no env
  // fallback anymore, so a Stripe config without it cannot collect a card.
  configFields: [
    {
      name: "publishableKey",
      label: "Publishable Key",
      type: "string",
      required: true,
    },
  ],

  // Presence of the publishable key is enforced generically (configFields
  // `required`); here we add the Stripe-specific format check. A test/live key
  // always starts with `pk_`, never the secret `sk_`/`rk_` prefixes.
  validateConfig(data: Record<string, unknown>) {
    const key =
      typeof data.publishableKey === "string" ? data.publishableKey.trim() : "";
    if (key && !key.startsWith("pk_")) {
      return {
        valid: false,
        errors: ['Publishable Key must start with "pk_".'],
      };
    }
    return { valid: true };
  },

  // Catalog of Stripe payment method types the editor offers (defined at module
  // scope so the setup flow can share the `setupEligible` markers).
  supportedPaymentTypes: STRIPE_PAYMENT_TYPES,

  // Stripe as the maintenance guard and the web client framework name it.
  // Declaring it is what puts every operation below on the framework.
  service: "Stripe",

  operations: {
    "service.test-connection": {
      description: "test connection",
      // Nothing is recorded, and an operator diagnosing a credential on a
      // read-only connection is exactly who needs this to still work.
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      async run(ctx): Promise<GatewayConnectionTest> {
        try {
          const c = client(ctx);
          const account = await c.accounts.retrieve();
          const balance = await c.balance.retrieve();
          return {
            connected: true,
            account: {
              id: account.id,
              email: account.email,
              country: account.country,
              defaultCurrency: account.default_currency,
              type: account.type,
              capabilities: [
                { label: "Charges Enabled", enabled: !!account.charges_enabled },
                { label: "Payouts Enabled", enabled: !!account.payouts_enabled },
                { label: "Details Submitted", enabled: !!account.details_submitted },
              ],
            },
            balances: [
              ...balance.available.map((b) => ({
                label: "Available",
                amount: b.amount,
                currency: b.currency,
              })),
              ...balance.pending.map((b) => ({
                label: "Pending",
                amount: b.amount,
                currency: b.currency,
              })),
            ],
            testMode: ctx.credential.value.startsWith("sk_test_"),
          };
        } catch (error: any) {
          return {
            connected: false,
            error: {
              message: error.message || "Failed to connect to Stripe",
              type: error.type,
              code: error.code,
            },
          };
        }
      },
    },

    "payments.customer.create": {
      description: "create a customer",
      // A customer created at Stripe and not written down here is created
      // again on the next request, leaving an orphan behind each time.
      needsWritableDatabase: true,
      async run(ctx, input): Promise<GatewayCustomerResult> {
        const customer = await client(ctx).customers.create({
          name: input.name,
          metadata: input.metadata ?? {},
        });
        return { customerRef: customer.id };
      },
    },

    "payments.customer.retrieve": {
      description: "check a customer still exists",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            customerRef: {
              type: "string",
              title: "Customer reference",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["customerRef"],
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx, { customerRef }): Promise<{ exists: boolean }> {
        try {
          const customer = await client(ctx).customers.retrieve(customerRef);
          return { exists: !(customer as Stripe.DeletedCustomer).deleted };
        } catch (error: any) {
          if (error.code === "resource_missing") {
            return { exists: false };
          }
          throw error;
        }
      },
    },

    "payments.customer.details": {
      description: "read customer details",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            customerRef: {
              type: "string",
              title: "Customer reference",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["customerRef"],
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx, { customerRef }): Promise<GatewayCustomerDetails> {
        const customer = (await client(ctx).customers.retrieve(
          customerRef,
        )) as Stripe.Customer | Stripe.DeletedCustomer;
        if ((customer as Stripe.DeletedCustomer).deleted) {
          const err: any = new Error("Customer has been deleted at Stripe");
          err.code = "resource_missing";
          throw err;
        }
        const c = customer as Stripe.Customer;
        return {
          id: c.id,
          name: c.name ?? null,
          email: c.email ?? null,
          created: c.created ?? null,
          currency: c.currency ?? null,
          balance: c.balance ?? null,
          delinquent: c.delinquent ?? null,
          providerUrl: `${dashboardBaseUrl(ctx)}/customers/${c.id}`,
        };
      },
    },

    "payments.setup-session.create": {
      description: "start collecting a payment method",
      // This opens a flow that ends in a stored payment method. Letting
      // somebody type their card details knowing the result cannot be saved
      // wastes their time and leaves a dangling SetupIntent at Stripe.
      needsWritableDatabase: true,
      async run(ctx, args): Promise<GatewaySetupSession> {
        const data = configData(ctx);
        const configured = Array.isArray(data.paymentTypes)
          ? (data.paymentTypes as string[])
          : ["card", "us_bank_account"];
        // Only types that can be SAVED as a reusable method work on a
        // SetupIntent. If the config carries any charge-only type (PayPal,
        // BNPL, vouchers, single-use redirects), fail with a clear, actionable
        // error that NAMES the offending type(s) instead of letting Stripe
        // reject the call with an opaque 500. The gateway configuration editor
        // prevents creating this state going forward; this guard covers configs
        // saved before that.
        const ineligible = configured.filter((t) => !SETUP_ELIGIBLE_TYPE_IDS.has(t));
        if (ineligible.length > 0) {
          throw new GatewaySetupError(
            `These payment types can't be saved as a reusable payment method: ${ineligible.join(", ")}. Edit the gateway configuration and keep a card or bank account type.`,
          );
        }
        if (configured.length === 0) {
          throw new GatewaySetupError(
            "This gateway has no payment types that can be saved as a reusable payment method. Edit the gateway configuration and enable a card or bank account type.",
          );
        }
        const paymentTypes = configured;

        const setupIntent = await client(ctx).setupIntents.create({
          customer: args.customerRef,
          payment_method_types: paymentTypes,
        });

        // Single source of truth: the publishable key lives only in the config
        // `data` (entered via the admin form). No environment-variable fallback.
        const publishableKey =
          typeof data.publishableKey === "string" ? data.publishableKey : "";

        return {
          clientSecret: setupIntent.client_secret ?? "",
          publicConfig: {
            publishableKey,
            paymentTypes,
          },
        };
      },
    },

    "payments.payment-method.attach": {
      description: "attach a payment method",
      // The method is attached at Stripe and then recorded here; an attach
      // that cannot be recorded is a method nobody can ever use or remove.
      needsWritableDatabase: true,
      async run(ctx, args): Promise<void> {
        await client(ctx).paymentMethods.attach(args.methodToken, {
          customer: args.customerRef,
        });
      },
    },

    "payments.payment-method.summary": {
      description: "read a payment method summary",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            methodRef: {
              type: "string",
              title: "Payment method reference",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["methodRef"],
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx, { methodRef }): Promise<GatewayMethodSummary> {
        const pm = await client(ctx).paymentMethods.retrieve(methodRef);
        return {
          type: pm.type,
          card: pm.card
            ? {
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
              }
            : null,
          us_bank_account: pm.us_bank_account
            ? {
                bank_name: pm.us_bank_account.bank_name,
                last4: pm.us_bank_account.last4,
                account_holder_type: pm.us_bank_account.account_holder_type,
                account_type: pm.us_bank_account.account_type,
              }
            : null,
          billing_details: pm.billing_details,
        };
      },
    },

    "payments.payment-method.details": {
      description: "read payment method details",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            methodRef: {
              type: "string",
              title: "Payment method reference",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["methodRef"],
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx, { methodRef }): Promise<GatewayMethodDetails> {
        const pm = await client(ctx).paymentMethods.retrieve(methodRef);
        return {
          paymentMethod: pm,
          providerUrl: `${dashboardBaseUrl(ctx)}/payment_methods/${pm.id}`,
        };
      },
    },

    "payments.payment-method.detach": {
      description: "remove a payment method",
      // Detaching at Stripe without deleting the row here leaves a stored
      // method pointing at nothing, which the list then reports as missing.
      needsWritableDatabase: true,
      async run(ctx, { methodRef }): Promise<void> {
        await client(ctx).paymentMethods.detach(methodRef);
      },
    },
  },
};

registerWcVendorPlugin(stripeWcVendorPlugin);
