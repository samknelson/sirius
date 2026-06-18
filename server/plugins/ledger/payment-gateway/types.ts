/**
 * Payment-gateway plugin kind (Task #412).
 *
 * A payment gateway declares a provider (e.g. Stripe) that the ledger can route
 * payments through. Each configuration row names the SECRET that holds the
 * provider's API credentials (the secret NAME, never the value) — the value is
 * resolved at use-time from the environment, mirroring how client-injection
 * resolves WEGLOT_API_KEY.
 *
 * Beyond metadata, the plugin owns the PROVIDER-ONLY behaviour for managing
 * payment methods (create customer, create a collection session, attach, fetch
 * details, detach). These methods are pure provider API calls: they receive a
 * resolved context carrying the per-config API key and the config row, and they
 * MUST NOT touch storage or the database. All persistence (customer mappings,
 * payment-method rows) is done by the generic module via `storage.*`.
 *
 * This kind carries no relational dimensions, so its config lives entirely in
 * the base `plugin_configs` table; the editable `secretName` rides in `data`.
 */
import type { PluginConfig } from "@shared/schema";
import type {
  PluginConfigEnvelopeField,
  PluginValidationResult,
} from "../../_core";

/**
 * Resolved per-operation context handed to every provider method. Built by the
 * generic module's credential resolver from a gateway config.
 */
export interface PaymentGatewayContext {
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

export interface PaymentGatewayPlugin {
  id: string;
  name: string;
  description?: string;
  /** Component-feature-flag gate (e.g. "ledger.stripe"). */
  requiredComponent?: string;
  /** Access-policy gate. */
  requiredPolicy?: string;
  /** Hide from default manifest listings (still registered/usable). */
  hidden?: boolean;
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
   * add-a-payment-method form, resolved through the client payment-gateway
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
  /** Test the provider connection using this config's resolved credentials. */
  testConnection(ctx: PaymentGatewayContext): Promise<GatewayConnectionTest>;
  /** Create a provider customer for an entity. */
  createCustomer(
    ctx: PaymentGatewayContext,
    input: CreateCustomerInput,
  ): Promise<GatewayCustomerResult>;
  /** Verify an existing provider customer still exists (best-effort). */
  retrieveCustomer?(
    ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<{ exists: boolean }>;
  /** Fetch normalized provider-customer detail for the customer view. */
  getCustomerDetails(
    ctx: PaymentGatewayContext,
    customerRef: string,
  ): Promise<GatewayCustomerDetails>;
  /** Create a session for collecting a new payment method. */
  createSetupSession(
    ctx: PaymentGatewayContext,
    args: { customerRef: string },
  ): Promise<GatewaySetupSession>;
  /** Attach a collected method token to the provider customer. */
  attachMethod(
    ctx: PaymentGatewayContext,
    args: { customerRef: string; methodToken: string },
  ): Promise<void>;
  /** Fetch a compact summary used to enrich the list view. */
  getMethodSummary(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodSummary>;
  /** Fetch the full provider method object for the details view. */
  getMethodDetails(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<GatewayMethodDetails>;
  /** Detach a method from the provider customer. */
  detachMethod(
    ctx: PaymentGatewayContext,
    methodRef: string,
  ): Promise<void>;
}

export interface PaymentGatewayManifestEntry {
  id: string;
  name: string;
  description?: string;
  requiredComponent?: string;
  addComponentId?: string;
}
