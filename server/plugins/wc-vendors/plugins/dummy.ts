import { randomBytes } from "crypto";
import type {
  WcVendorPlugin,
  GatewayCustomerResult,
  GatewaySetupSession,
  GatewayMethodSummary,
  GatewayMethodDetails,
  GatewayConnectionTest,
  GatewayCustomerDetails,
} from "../types";
import { registerWcVendorPlugin } from "../registry";

/**
 * Opaque method-reference format shared with the client add-form. The token
 * carries ONLY the non-sensitive card descriptor (brand, last 4, expiry) —
 * never the full PAN or the CVC, and no free-form field that could smuggle
 * one. The client encodes it and the server decodes it here to enrich the
 * list/detail views.
 */
const DUMMY_METHOD_PREFIX = "dummy_pm_";

/**
 * The exact, allowed key set for a decoded dummy token. Anything else (e.g. a
 * `pan`, `number`, `cvc`, or a free-form `nonce` field) is rejected so sensitive
 * card data can never be persisted, even if a crafted client bypasses the UI.
 * Every allowed field below is strictly bounded (brand allowlist, 4-digit
 * last4, calendar-range expiry), so none can carry a full card number.
 */
const ALLOWED_TOKEN_KEYS = ["brand", "last4", "expMonth", "expYear"];

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

  const { brand, last4, expMonth, expYear } = obj;
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
 * does not expose a secret-name field. Provider-only — no storage/DB access.
 */
// Not exported, for the same reason as the Stripe plugin: the registry is the
// only supported handle on a gateway plugin.
const dummyWcVendorPlugin: WcVendorPlugin = {
  id: "dummy",
  name: "Dummy (Testing)",
  description:
    "A fake payment gateway for testing the full payment lifecycle without a real provider. Stores only the card brand, expiry, and last 4 digits.",
  requiredComponent: "ledger.dummy_gateway",
  addComponentId: "dummy:DummyAddPaymentMethod",
  credential: { secretName: "none" },

  supportedPaymentTypes: [
    {
      id: "card",
      name: "Credit/Debit Card",
      description: "Hand-typed test card (no real charges are made)",
    },
  ],

  // No `service`: there is no outside system here. Every answer below is
  // synthesized in this process, so there is no call to refuse during
  // maintenance and nothing to count on the web client figures. Naming a
  // vendor would put a service the site does not talk to into the one list the
  // maintenance guard and the framework share.
  //
  // `needsWritableDatabase` is still declared on each operation, because it
  // describes the operation rather than the transport, and it becomes live the
  // moment a plugin of this shape does name a service.

  operations: {
    "test-connection": {
      description: "test connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      async run(): Promise<GatewayConnectionTest> {
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
    },

    "create-customer": {
      description: "create a customer",
      needsWritableDatabase: true,
      async run(): Promise<GatewayCustomerResult> {
        return { customerRef: `dummy_cus_${randomBytes(8).toString("hex")}` };
      },
    },

    "retrieve-customer": {
      description: "check a customer still exists",
      needsWritableDatabase: false,
      async run(): Promise<{ exists: boolean }> {
        // The dummy gateway never loses customers.
        return { exists: true };
      },
    },

    "get-customer-details": {
      description: "read customer details",
      needsWritableDatabase: false,
      async run(_ctx, { customerRef }): Promise<GatewayCustomerDetails> {
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
    },

    "create-setup-session": {
      description: "start collecting a payment method",
      needsWritableDatabase: true,
      async run(): Promise<GatewaySetupSession> {
        // The client add-form collects the card itself and ignores the secret,
        // so the session payload is purely a placeholder.
        return {
          clientSecret: `dummy_setup_${randomBytes(8).toString("hex")}`,
          publicConfig: { gateway: "dummy" },
        };
      },
    },

    "attach-method": {
      description: "attach a payment method",
      needsWritableDatabase: true,
      async run(_ctx, args): Promise<void> {
        // There is no remote provider to attach to, but this runs BEFORE the
        // generic module persists the token, so it is the enforcement point:
        // reject anything that isn't a clean brand/expiry/last4 token. This
        // guarantees a full PAN or CVC can never be stored, even from a
        // crafted client.
        decodeMethodRef(args.methodToken);
      },
    },

    "get-method-summary": {
      description: "read a payment method summary",
      needsWritableDatabase: false,
      async run(_ctx, { methodRef }): Promise<GatewayMethodSummary> {
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
    },

    "get-method-details": {
      description: "read payment method details",
      needsWritableDatabase: false,
      async run(_ctx, { methodRef }): Promise<GatewayMethodDetails> {
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
    },

    "detach-method": {
      description: "remove a payment method",
      needsWritableDatabase: true,
      async run(): Promise<void> {
        // Nothing to detach on a stateless dummy provider.
      },
    },
  },
};

registerWcVendorPlugin(dummyWcVendorPlugin);
