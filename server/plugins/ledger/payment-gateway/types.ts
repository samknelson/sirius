/**
 * Payment-gateway plugin kind (Task #412).
 *
 * A payment gateway is a metadata-only plugin: it declares a provider (e.g.
 * Stripe) that the ledger can route payments through. Each configuration row
 * names the SECRET that holds the provider's API credentials (the secret
 * NAME, never the value) — the value is resolved at use-time from the
 * environment, mirroring how client-injection resolves WEGLOT_API_KEY.
 *
 * This kind carries no relational dimensions, so its config lives entirely in
 * the base `plugin_configs` table; the editable `secretName` rides in `data`.
 */
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
}

export interface PaymentGatewayManifestEntry {
  id: string;
  name: string;
  description?: string;
  requiredComponent?: string;
}
