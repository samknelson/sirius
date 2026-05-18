import type { Request } from "express";
import type { PluginRegistry } from "./registry";

/**
 * Registry of plugin kinds. The unified `/api/plugins/:kind/manifest`
 * endpoint looks up kinds here and delegates to the appropriate
 * `PluginRegistry` instance.
 *
 * Each kind opts in by calling `registerPluginKind(kind, registry, opts)`
 * once during boot.
 */
export interface PluginKindRegistration<TPlugin = unknown, TEntry = unknown> {
  kind: string;
  registry: PluginRegistry<TPlugin, TEntry>;
  /**
   * Kind-level component gate. If set, the entire manifest endpoint
   * 403s when the component is disabled. Mirrors the legacy
   * `requireComponent(...)` middleware that protected the per-kind
   * manifest endpoints before Task #208.
   */
  requiredComponent?: string;
  /**
   * Kind-level access-policy gate. If set, the manifest endpoint
   * 403s when the current user does not satisfy the policy. Mirrors
   * the legacy `requireAccess('admin')` middleware that protected
   * the charge / dispatch-eligibility / trust-eligibility manifest
   * endpoints. The dashboard manifest intentionally omits this so
   * every authenticated user can list their dashboard widgets.
   */
  requiredPolicy?: string;
  /**
   * Optional sort function applied to manifest entries before they are
   * returned to the caller. Defaults to alphabetical by `id`.
   */
  sortEntries?: (a: TEntry, b: TEntry) => number;
  /**
   * Optional post-processor for the final manifest array (e.g. to
   * inject runtime fields like "enabled" pulled from variables).
   */
  decorateEntries?: (entries: TEntry[], req: Request) => Promise<TEntry[]> | TEntry[];
}

const KINDS = new Map<string, PluginKindRegistration<any, any>>();

export function registerPluginKind<TPlugin, TEntry>(
  registration: PluginKindRegistration<TPlugin, TEntry>,
): void {
  if (KINDS.has(registration.kind)) {
    throw new Error(`Plugin kind '${registration.kind}' already registered`);
  }
  KINDS.set(registration.kind, registration);
}

export function getPluginKind(kind: string): PluginKindRegistration | undefined {
  return KINDS.get(kind);
}

export function listPluginKinds(): string[] {
  return Array.from(KINDS.keys());
}
