/**
 * Shared base shape for every plugin kind's metadata. Concrete kinds
 * (dashboard, dispatch eligibility, ledger charge, trust eligibility)
 * extend this with their domain-specific fields, but the registry
 * scaffolding (component gating, access-policy gating, manifest
 * exposure) only depends on these fields.
 *
 * The canonical field name for component gating is `requiredComponent`
 * (NOT `componentId` or `requiresComponent` — those legacy spellings
 * were collapsed in Task #208).
 */
export interface BasePluginMetadata {
  id: string;
  name: string;
  description: string;
  /** Component-feature-flag gate. Plugin is hidden / unavailable when off. */
  requiredComponent?: string;
  /** Access-policy gate. User must satisfy this policy. */
  requiredPolicy?: string;
  /** Hide from default manifest listings (still registered/usable). */
  hidden?: boolean;
  /**
   * Opt-in: allow this plugin to run its own read-only queries directly via
   * `storage.readOnly.query(...)` instead of a bespoke storage method. When
   * true the storage-encapsulation check permits `readOnly.query` (and the
   * schema-table imports it needs) inside the plugin's file. Mutations still
   * MUST go through the storage layer regardless of this flag. Default-off.
   */
  needsReadOnlyDb?: boolean;
  /**
   * Marks the plugin as a singleton: exactly one config row may exist for it
   * (keyed by plugin kind + plugin id). The generic CRUD routes refuse to
   * create a second row or delete the existing one, and the boot-time
   * singleton seeder creates the single row from the kind adapter's
   * `seedDefault`. Used by cron plugins, whose scheduled job IS the config.
   */
  singleton?: boolean;
}

/**
 * Registered plugin kinds. Adding a new kind is just adding a string
 * here and calling `registerPluginKind` with its registry + formatter.
 */
export type PluginKind =
  | "dashboard"
  | "dispatch-eligibility"
  | "charge"
  | "trust-eligibility"
  | "client-injection"
  | "payment-gateway"
  | "event-notifier"
  | "cron"
  | "denorm";
