import Stripe from "stripe";
import type {
  PaymentGatewayPlugin,
  PaymentGatewayContext,
  CreateCustomerInput,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
} from "../types";
import { registerPaymentGatewayPlugin } from "../registry";

/** Build a Stripe client from the per-config resolved secret. */
function client(ctx: PaymentGatewayContext): Stripe {
  return new Stripe(ctx.apiKey);
}

/** Provider config data may carry a publishable key + payment types. */
function configData(ctx: PaymentGatewayContext): Record<string, unknown> {
  const data = ctx.config.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function dashboardBaseUrl(ctx: PaymentGatewayContext): string {
  return ctx.apiKey.startsWith("sk_test_")
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com";
}

/**
 * Stripe payment gateway. Each `payment-gateway` config row of this plugin
 * names the secret holding the Stripe API credentials (stored as
 * `data.secretName`; resolved from the environment at use-time). Gated on the
 * existing `ledger.stripe` component. Provider-only — no storage/DB access.
 */
export const stripePaymentGatewayPlugin: PaymentGatewayPlugin = {
  id: "stripe",
  name: "Stripe",
  description:
    "Stripe payment gateway. Each configuration names the secret that holds the Stripe API credentials.",
  requiredComponent: "ledger.stripe",
  addComponentId: "stripe:StripeAddPaymentMethod",

  // Catalog of Stripe payment method types the editor offers. Stays here (not
  // in the UI) so the payment-types editor remains provider-agnostic.
  supportedPaymentTypes: [
    { id: "card", name: "Credit/Debit Card", description: "Accept Visa, Mastercard, Amex, and other cards" },
    { id: "us_bank_account", name: "US Bank Account (ACH)", description: "ACH direct debit payments" },
    { id: "cashapp", name: "Cash App Pay", description: "Accept payments via Cash App" },
    { id: "paypal", name: "PayPal", description: "Accept payments via PayPal" },
    { id: "link", name: "Link", description: "Stripe's one-click payment method" },
    { id: "affirm", name: "Affirm", description: "Buy now, pay later with Affirm" },
    { id: "afterpay_clearpay", name: "Afterpay / Clearpay", description: "Buy now, pay later" },
    { id: "klarna", name: "Klarna", description: "Buy now, pay later with Klarna" },
    { id: "alipay", name: "Alipay", description: "Popular payment method in China" },
    { id: "wechat_pay", name: "WeChat Pay", description: "Popular payment method in China" },
    { id: "ideal", name: "iDEAL", description: "Popular payment method in Netherlands" },
    { id: "sepa_debit", name: "SEPA Direct Debit", description: "European bank debits" },
    { id: "bancontact", name: "Bancontact", description: "Popular payment method in Belgium" },
    { id: "giropay", name: "Giropay", description: "Popular payment method in Germany" },
    { id: "eps", name: "EPS", description: "Popular payment method in Austria" },
    { id: "p24", name: "Przelewy24", description: "Popular payment method in Poland" },
    { id: "blik", name: "BLIK", description: "Mobile payment method in Poland" },
    { id: "acss_debit", name: "ACSS Debit", description: "Pre-authorized debit in Canada" },
    { id: "au_becs_debit", name: "BECS Direct Debit", description: "Direct debit in Australia" },
    { id: "bacs_debit", name: "Bacs Direct Debit", description: "Direct debit in UK" },
    { id: "fpx", name: "FPX", description: "Online banking in Malaysia" },
    { id: "grabpay", name: "GrabPay", description: "Popular digital wallet in Southeast Asia" },
    { id: "paynow", name: "PayNow", description: "Real-time payment in Singapore" },
    { id: "promptpay", name: "PromptPay", description: "Real-time payment in Thailand" },
    { id: "pix", name: "Pix", description: "Instant payment method in Brazil" },
    { id: "boleto", name: "Boleto", description: "Cash-based voucher payment in Brazil" },
    { id: "oxxo", name: "OXXO", description: "Cash-based voucher payment in Mexico" },
    { id: "konbini", name: "Konbini", description: "Cash payment at convenience stores in Japan" },
    { id: "customer_balance", name: "Customer Balance", description: "Use customer account balance" },
    { id: "sofort", name: "Sofort", description: "Bank redirect in Europe (deprecated, use Klarna)" },
  ],

  async testConnection(ctx: PaymentGatewayContext): Promise<GatewayConnectionTest> {
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
        testMode: ctx.apiKey.startsWith("sk_test_"),
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

  async createCustomer(
    ctx: PaymentGatewayContext,
    input: CreateCustomerInput,
  ): Promise<GatewayCustomerResult> {
    const customer = await client(ctx).customers.create({
      name: input.name,
      metadata: input.metadata ?? {},
    });
    return { customerRef: customer.id };
  },

  async retrieveCustomer(
    ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<{ exists: boolean }> {
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

  async createSetupSession(
    ctx: PaymentGatewayContext,
    args: { customerRef: string },
  ): Promise<GatewaySetupSession> {
    const data = configData(ctx);
    const paymentTypes = Array.isArray(data.paymentTypes)
      ? (data.paymentTypes as string[])
      : ["card", "us_bank_account"];

    const setupIntent = await client(ctx).setupIntents.create({
      customer: args.customerRef,
      payment_method_types: paymentTypes,
    });

    const publishableKey =
      (typeof data.publishableKey === "string" && data.publishableKey) ||
      process.env.VITE_STRIPE_PUBLIC_KEY ||
      process.env.STRIPE_PUBLISHABLE_KEY ||
      "";

    return {
      clientSecret: setupIntent.client_secret ?? "",
      publicConfig: {
        publishableKey,
        paymentTypes,
      },
    };
  },

  async attachMethod(
    ctx: PaymentGatewayContext,
    args: { customerRef: string; methodToken: string },
  ): Promise<void> {
    await client(ctx).paymentMethods.attach(args.methodToken, {
      customer: args.customerRef,
    });
  },

  async getMethodSummary(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodSummary> {
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

  async getMethodDetails(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodDetails> {
    const pm = await client(ctx).paymentMethods.retrieve(methodRef);
    return {
      paymentMethod: pm,
      providerUrl: `${dashboardBaseUrl(ctx)}/payment_methods/${pm.id}`,
    };
  },

  async detachMethod(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<void> {
    await client(ctx).paymentMethods.detach(methodRef);
  },
};

registerPaymentGatewayPlugin(stripePaymentGatewayPlugin);
