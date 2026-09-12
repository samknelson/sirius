/**
 * Webclient-vendor plugin kind.
 *
 * A plugin of this kind declares an outside system (e.g. Stripe) that the site
 * calls through the web client framework. Each configuration row names the
 * SECRET that holds the vendor's API credentials (the secret NAME, never the
 * value) — the value is resolved at use-time from the environment, mirroring
 * how client-injection resolves WEGLOT_API_KEY.
 *
 * Beyond metadata, the plugin owns the VENDOR-ONLY behaviour: the operations it
 * declares are pure vendor API calls that receive a resolved context carrying
 * the per-config API key and the config row, and they MUST NOT touch storage or
 * the database. All persistence (e.g. customer mappings and payment-method rows
 * for a payment vendor) is done by the calling module via `storage.*`.
 *
 * The payload types below named `Gateway*` describe the payment-gateway
 * operations specifically — they are the shapes those operations exchange, not
 * framework vocabulary, so they keep their payment names.
 *
 * This kind carries no relational dimensions, so its config lives entirely in
 * the base `plugin_configs` table; the editable `secretName` rides in `data`.
 */
import type { PluginConfig } from "@shared/schema";
import type {
  BasePluginMetadata,
  PluginConfigEnvelopeField,
  PluginValidationResult,
} from "../../_core";
// Type-only: the vendor vocabulary is the web client framework's, and the
// framework's is the maintenance guard's. Naming a service here that those two
// do not know is exactly the split this import prevents.
import type { WcService } from "../../../services/webclient/types";

/**
 * Resolved per-operation context handed to every provider method. Built by the
 * generic module's credential resolver from a gateway config.
 */
export interface WcVendorContext {
  /** Provider API secret value, resolved from `config.data.secretName`. */
  apiKey: string;
  /** The gateway config row driving this operation (carries `data`). */
  config: PluginConfig;
}

export interface CreateCustomerInput {
  /** Human-readable customer name (e.g. the entity's name). */
  name: string;
  /** Opaque provider metadata (e.g. entity id / sirius id). */
  metadata?: Record<string, string>;
}

export interface GatewayCustomerResult {
  /** Opaque provider customer reference (e.g. Stripe `cus_...`). */
  customerRef: string;
}

export interface GatewaySetupSession {
  /** Client secret the provider's client SDK needs to collect a method. */
  clientSecret: string;
  /**
   * Provider public config the client add-form needs (e.g. publishable key,
   * available payment types). Kept opaque so the page stays provider-agnostic.
   */
  publicConfig: Record<string, unknown>;
}

export interface GatewayMethodSummary {
  type: string;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  us_bank_account?: {
    bank_name: string | null;
    last4: string | null;
    account_holder_type: string | null;
    account_type: string | null;
  } | null;
  billing_details?: unknown;
}

export interface GatewayMethodDetails {
  /** Full provider payment-method object. */
  paymentMethod: unknown;
  /** Optional deep link into the provider dashboard. */
  providerUrl?: string;
}

/**
 * Normalized provider-customer detail used by the generic customer view. Kept
 * provider-agnostic so the page can render any gateway's customer without
 * provider-specific knowledge. Providers map their native customer shape here.
 */
export interface GatewayCustomerDetails {
  /** Opaque provider customer reference (e.g. Stripe `cus_...`). */
  id: string;
  name: string | null;
  email: string | null;
  /** Unix epoch seconds the customer was created, when known. */
  created: number | null;
  currency: string | null;
  /** Minor-unit balance (e.g. cents), when known. */
  balance: number | null;
  delinquent: boolean | null;
  /** Optional deep link into the provider dashboard. */
  providerUrl?: string;
}

/**
 * Normalized result of a provider connection test. Kept provider-agnostic so
 * the admin test page can render any gateway's health without provider-specific
 * knowledge. Providers map their native account/balance shapes into this.
 */
export interface GatewayConnectionTest {
  /** True when the provider credentials authenticated successfully. */
  connected: boolean;
  /** Provider account summary (present when connected). */
  account?: {
    id: string;
    email?: string | null;
    country?: string | null;
    defaultCurrency?: string | null;
    type?: string | null;
    /** Named capability flags (e.g. "Charges Enabled"). */
    capabilities?: { label: string; enabled: boolean }[];
  };
  /** Labeled balance lines (e.g. Available / Pending per currency). */
  balances?: { label: string; amount: number; currency: string }[];
  /** True when the credential targets a non-production/test environment. */
  testMode?: boolean;
  /** Populated when the connection failed. */
  error?: { message: string; type?: string; code?: string };
}

/**
 * A single selectable payment method type in a provider's catalog. `id` is the
 * value stored on the config (e.g. "card"); `name`/`description` are display
 * text for the editor.
 */
export interface PaymentTypeOption {
  id: string;
  name: string;
  description?: string;
  /**
   * Whether this payment type can be SAVED as a reusable payment method via the
   * add-a-payment-method (SetupIntent) flow. Charge-only types (PayPal, BNPL,
   * vouchers, single-use redirects) set this to `false` so that flow never
   * offers or sends them to the provider. Omitted/`undefined` is treated as
   * eligible, so providers that don't distinguish keep working unchanged.
   */
  setupEligible?: boolean;
}

/**
 * What a plugin of this kind can be asked to do, and the shape of each
 * operation's arguments and result.
 *
 * An interface rather than a closed union, so a vendor that does something
 * this file has never heard of declares its own entry by merging into it:
 *
 *   declare module "…/wc-vendors/types" {
 *     interface WcVendorOperations {
 *       "send-sms": { args: { to: string; body: string }; result: { sid: string } };
 *     }
 *   }
 *
 * Nothing here is required of a plugin. The kind used to mandate nine payment
 * methods, which is the reason it could only ever hold payment providers: a
 * vendor with no customers and no payment methods had to stub eight of them to
 * register at all. A plugin now declares the operations it has and stays
 * silent about the rest, and a caller asking for one it does not declare is
 * told so.
 */
export interface WcVendorOperations {
  "test-connection": { args: void; result: GatewayConnectionTest };
  "create-customer": { args: CreateCustomerInput; result: GatewayCustomerResult };
  "retrieve-customer": { args: { customerRef: string }; result: { exists: boolean } };
  "get-customer-details": { args: { customerRef: string }; result: GatewayCustomerDetails };
  "create-setup-session": { args: { customerRef: string }; result: GatewaySetupSession };
  "attach-method": {
    args: { customerRef: string; methodToken: string };
    result: void;
  };
  "get-method-summary": { args: { methodRef: string }; result: GatewayMethodSummary };
  "get-method-details": { args: { methodRef: string }; result: GatewayMethodDetails };
  "detach-method": { args: { methodRef: string }; result: void };
}

export type WcVendorOperationName = keyof WcVendorOperations;
export type WcVendorOperationArgs<N extends WcVendorOperationName> =
  WcVendorOperations[N]["args"];
export type WcVendorOperationResult<N extends WcVendorOperationName> =
  WcVendorOperations[N]["result"];

/** One operation a plugin declares: how to do it, and how it must be gated. */
export interface WcVendorOperation<N extends WcVendorOperationName = WcVendorOperationName> {
  /**
   * What is being attempted, in plain words — the second half of "Stripe is
   * unavailable: the site is in maintenance mode (attempted: …)".
   */
  operation: string;
  /**
   * Whether the vendor may be asked when the answer cannot be written down.
   *
   * Per operation, because the two halves of any vendor want opposite answers.
   * Anything that creates or destroys something at the vendor must not fire
   * when the record of it cannot be saved: a customer created and forgotten is
   * created again next time, and a method detached but not deleted leaves a
   * row pointing at nothing. A read, a status check or a connection test has
   * nothing to record, and refusing one on a read-only connection would take
   * away the diagnosis an operator is in the middle of.
   */
  needsWritableDatabase: boolean;
  /**
   * Do it. Pure provider work: no storage and no database access — all
   * persistence belongs to the calling module.
   */
  run(
    ctx: WcVendorContext,
    args: WcVendorOperationArgs<N>,
  ): Promise<WcVendorOperationResult<N>>;
}

export type WcVendorOperationMap = {
  [N in WcVendorOperationName]?: WcVendorOperation<N>;
};

export interface WcVendorPlugin extends BasePluginMetadata {
  /**
   * Whether resolving this gateway requires the named credential secret to be
   * present in the environment. Defaults to `true` (the historical behaviour:
   * a missing secret yields a 503). A provider that needs no real credentials
   * — e.g. the in-app "dummy" testing gateway — sets this to `false`, so the
   * config may still name a secret without the gateway breaking when it is
   * unset. When `false`, the resolved `context.apiKey` is an empty string if
   * the secret is absent.
   */
  requiresSecret?: boolean;
  /**
   * Client component id (`"<plugin-id>:<Component>"`) for the auto-discovered
   * add-a-payment-method form, resolved through the client wc-vendors
   * component registry.
   */
  addComponentId?: string;
  /**
   * Catalog of payment method types this provider supports, surfaced to the
   * provider-generic payment-types editor. The admin picks from this list per
   * config; the chosen ids are stored on the config's `data.paymentTypes` and
   * drive the setup flow. Kept on the plugin so the editor stays
   * provider-agnostic (no hardcoded provider knowledge in the UI).
   */
  supportedPaymentTypes?: PaymentTypeOption[];

  /**
   * Per-plugin configuration fields. Rendered by the generic admin config form
   * once this plugin is selected and stored inside the config's `data` json
   * (no schema change). Reuses the shared field descriptor
   * (name/label/type/required). The generic create/update path enforces
   * `required`; provider-specific format checks (e.g. Stripe's `pk_` prefix)
   * belong in {@link validateConfig}. A provider with no extra fields (e.g. the
   * dummy gateway) simply omits this.
   */
  configFields?: PluginConfigEnvelopeField[];
  /**
   * Optional provider-specific validation of the config `data` beyond the
   * generic required-field check (which the unified routes apply from
   * {@link configFields}). Return `{ valid: false, errors }` to reject the
   * save. Used by Stripe to require a `pk_`-prefixed publishable key.
   */
  validateConfig?(data: Record<string, unknown>): PluginValidationResult;

  // --- Provider-only behaviour (no storage/DB access) --------------------
  /**
   * The outside system this plugin talks to, in the vocabulary the maintenance
   * guard and the web client framework share.
   *
   * Naming one puts every operation this plugin declares on the framework: the
   * call is refused during maintenance, gated on a writable database when the
   * operation says so, and counted on the web client usage figures.
   *
   * Omitting it says there is no outside system — the in-app testing gateway
   * synthesizes every answer in-process. There is nothing to refuse, nothing to
   * count, and no vendor to name; inventing one would put a service the site
   * does not talk to into the one list the guard and the framework share.
   */
  service?: WcService;

  /**
   * What this plugin can do. Declared, not implemented-or-stubbed: see
   * {@link WcVendorOperations}.
   *
   * What a plugin file writes here is the bare handler. What a caller gets
   * back from the registry is that handler already wrapped in the web client
   * framework, because `registerWcVendorPlugin` registers a plugin whose
   * operations it has wrapped — so the refusal and the count hold however the
   * handler is reached, including by reaching into this map. Callers should
   * still go through `wcVendorRequest`, which resolves the credential to pass
   * as the context and answers for an operation the plugin does not declare,
   * but nothing about the maintenance guarantee rests on their doing so.
   */
  operations: WcVendorOperationMap;
}

export interface WcVendorManifestEntry {
  id: string;
  name: string;
  description?: string;
  requiredComponent?: string;
  addComponentId?: string;
}
