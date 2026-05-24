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
  | "client-injection";
