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
   * Client component id (`"<plugin-id>:<Component>"`) for the auto-discovered
   * add-a-payment-method form, resolved through the client payment-gateway
   * component registry.
   */
  addComponentId?: string;

  // --- Provider-only behaviour (no storage/DB access) --------------------
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
