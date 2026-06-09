import { randomBytes } from "crypto";
import type {
  PaymentGatewayPlugin,
  PaymentGatewayContext,
  CreateCustomerInput,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
  GatewayCustomerDetails,
} from "../types";
import { registerPaymentGatewayPlugin } from "../registry";

/**
 * Opaque method-reference format shared with the client add-form. The token
 * carries ONLY the non-sensitive card descriptor (brand, last 4, expiry) plus a
 * random nonce — never the full PAN or the CVC. The client encodes it and the
 * server decodes it here to enrich the list/detail views.
 */
const DUMMY_METHOD_PREFIX = "dummy_pm_";

/**
 * The exact, allowed key set for a decoded dummy token. Anything else (e.g. a
 * `pan`, `number`, or `cvc` field) is rejected so sensitive card data can never
 * be persisted, even if a crafted client bypasses the UI.
 */
const ALLOWED_TOKEN_KEYS = ["brand", "last4", "expMonth", "expYear", "nonce"];

/** Brands the client's detector can emit; anything else is rejected. */
const ALLOWED_BRANDS = [
  "visa",
  "mastercard",
  "amex",
  "discover",
  "diners",
  "jcb",
  "card",
];

interface DummyCardMeta {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/**
 * Strictly decode and validate an opaque dummy method reference. Throws on any
 * deviation from the expected `{brand,last4,expMonth,expYear,nonce}` shape —
 * including unexpected keys — so a payload carrying a full PAN or CVC is
 * refused before it can ever be stored. This is the server-side guarantee
 * behind "store only brand/expiry/last 4, never the PAN or CVC".
 */
function decodeMethodRef(methodRef: string): DummyCardMeta {
  if (typeof methodRef !== "string" || !methodRef.startsWith(DUMMY_METHOD_PREFIX)) {
    throw new Error("Malformed dummy payment-method reference");
  }
  const encoded = methodRef.slice(DUMMY_METHOD_PREFIX.length);
  // Cap the payload size: a legitimate token is tiny; an oversized one is a
  // red flag (e.g. an attempt to smuggle extra data).
  if (encoded.length === 0 || encoded.length > 512) {
    throw new Error("Malformed dummy payment-method reference");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new Error("Malformed dummy payment-method reference");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Malformed dummy payment-method reference");
  }

  const obj = parsed as Record<string, unknown>;
  // Reject any unexpected field (a PAN/CVC could only ride in as an extra key
  // or by abusing an allowed one — both are blocked here).
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_TOKEN_KEYS.includes(key)) {
      throw new Error("Dummy payment-method reference has unexpected fields");
    }
  }

  const { brand, last4, expMonth, expYear, nonce } = obj;
  if (typeof brand !== "string" || !ALLOWED_BRANDS.includes(brand)) {
    throw new Error("Dummy payment-method reference has an invalid brand");
  }
  if (typeof last4 !== "string" || !/^\d{4}$/.test(last4)) {
    throw new Error("Dummy payment-method reference has an invalid last4");
  }
  if (
    typeof expMonth !== "number" ||
    !Number.isInteger(expMonth) ||
    expMonth < 1 ||
    expMonth > 12
  ) {
    throw new Error("Dummy payment-method reference has an invalid expiry month");
  }
  if (
    typeof expYear !== "number" ||
    !Number.isInteger(expYear) ||
    expYear < 2000 ||
    expYear > 2100
  ) {
    throw new Error("Dummy payment-method reference has an invalid expiry year");
  }
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 64) {
    throw new Error("Dummy payment-method reference has an invalid nonce");
  }

  return { brand, last4, expMonth, expYear };
}

/**
 * Dummy payment gateway for testing the full payment-method lifecycle without
 * real provider credentials. It is stateless: there is no remote provider, so
 * every "provider" call is synthesized in-process. Customers get a stable
 * synthetic reference (the generic module persists the mapping), and method
 * details are decoded straight out of the opaque token the client produced.
 *
 * Gated on the `ledger.dummy_gateway` component. The matching config names a
 * `DUMMY_GATEWAY` secret to exercise the secret-naming path, but the plugin
 * opts out of requiring it (`requiresSecret: false`), so the gateway resolves
 * whether or not the env var is set. Provider-only — no storage/DB access.
 */
export const dummyPaymentGatewayPlugin: PaymentGatewayPlugin = {
  id: "dummy",
  name: "Dummy (Testing)",
  description:
    "A fake payment gateway for testing the full payment lifecycle without a real provider. Stores only the card brand, expiry, and last 4 digits.",
  requiredComponent: "ledger.dummy_gateway",
  addComponentId: "dummy:DummyAddPaymentMethod",
  // No real credentials needed — works even when DUMMY_GATEWAY is unset.
  requiresSecret: false,

  supportedPaymentTypes: [
    {
      id: "card",
      name: "Credit/Debit Card",
      description: "Hand-typed test card (no real charges are made)",
    },
  ],

  async testConnection(_ctx: PaymentGatewayContext): Promise<GatewayConnectionTest> {
    return {
      connected: true,
      account: {
        id: "dummy_account",
        type: "test",
        defaultCurrency: "usd",
        capabilities: [{ label: "Test Mode", enabled: true }],
      },
      testMode: true,
    };
  },

  async createCustomer(
    _ctx: PaymentGatewayContext,
    _input: CreateCustomerInput,
  ): Promise<GatewayCustomerResult> {
    return { customerRef: `dummy_cus_${randomBytes(8).toString("hex")}` };
  },

  async retrieveCustomer(
    _ctx: PaymentGatewayContext,
    _customerRef: string,
  ): Promise<{ exists: boolean }> {
    // The dummy gateway never loses customers.
    return { exists: true };
  },

  async getCustomerDetails(
    _ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<GatewayCustomerDetails> {
    return {
      id: customerRef,
      name: null,
      email: null,
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      balance: 0,
      delinquent: false,
    };
  },

  async createSetupSession(
    _ctx: PaymentGatewayContext,
    _args: { customerRef: string },
  ): Promise<GatewaySetupSession> {
    // The client add-form collects the card itself and ignores the secret, so
    // the session payload is purely a placeholder.
    return {
      clientSecret: `dummy_setup_${randomBytes(8).toString("hex")}`,
      publicConfig: { gateway: "dummy" },
    };
  },

  async attachMethod(
    _ctx: PaymentGatewayContext,
    args: { customerRef: string; methodToken: string },
  ): Promise<void> {
    // There is no remote provider to attach to, but this hook runs BEFORE the
    // generic module persists the token, so it is the enforcement point: reject
    // anything that isn't a clean brand/expiry/last4 token. This guarantees a
    // full PAN or CVC can never be stored, even from a crafted client.
    decodeMethodRef(args.methodToken);
  },

  async getMethodSummary(
    _ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodSummary> {
    const card = decodeMethodRef(methodRef);
    return {
      type: "card",
      card: {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
      },
      billing_details: { name: null, email: null },
    };
  },

  async getMethodDetails(
    _ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodDetails> {
    const card = decodeMethodRef(methodRef);
    return {
      paymentMethod: {
        id: methodRef,
        type: "card",
        card: {
          brand: card.brand,
          last4: card.last4,
          exp_month: card.expMonth,
          exp_year: card.expYear,
        },
      },
    };
  },

  async detachMethod(
    _ctx: PaymentGatewayContext,
    _methodRef: string,
  ): Promise<void> {
    // Nothing to detach on a stateless dummy provider.
  },
};

registerPaymentGatewayPlugin(dummyPaymentGatewayPlugin);
