import { createPluginComponentRegistry } from "../_core";

/**
 * Props passed to every wc-vendors "add a payment method" component.
 * The page stays provider-agnostic: it hands the component the collection
 * `clientSecret` and the provider's `publicConfig` (e.g. a publishable key)
 * returned by the generic setup endpoint, and receives an opaque method token
 * back via `onSuccess`.
 */
export interface WcVendorAddProps {
  clientSecret: string;
  publicConfig: Record<string, unknown>;
  onSuccess: (methodToken: string) => void;
  onCancel: () => void;
}

const registry = createPluginComponentRegistry<WcVendorAddProps>({
  kind: "wc-vendors",
  glob: import.meta.glob("./*/*.tsx", { eager: true }) as Record<
    string,
    Record<string, unknown>
  >,
});

export function hasWcVendorComponent(id: string): boolean {
  return registry.has(id);
}

export function resolveWcVendorComponent(id: string) {
  return registry.resolve(id);
}
