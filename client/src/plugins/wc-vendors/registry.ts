import { createPluginComponentRegistry } from "../_core";
import type { ComponentType } from "react";

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

/**
 * Props for a one-time payment confirmation.  This is intentionally separate
 * from the setup/add-method contract: payment providers can report an
 * intermediate result while the server waits for its webhook.
 */
export interface PaymentGatewayPayProps {
  clientSecret: string;
  publicConfig: Record<string, unknown>;
  amount: string;
  returnUrl: string;
  /** The server already confirmed this saved method; only its next action remains. */
  savedMethod?: boolean;
  onComplete: (
    status: "succeeded" | "processing" | "failed",
    message?: string,
  ) => void;
}

const addGlob = import.meta.glob("./*/*AddPaymentMethod.tsx", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const payGlob = import.meta.glob("./*/*PayComponent.tsx", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

// Fork extension: keep payment confirmation separate from setup components.
const registry = createPluginComponentRegistry<WcVendorAddProps>({
  kind: "wc-vendors",
  glob: addGlob,
});
const payRegistry = createPluginComponentRegistry<PaymentGatewayPayProps>({
  kind: "wc-vendors",
  glob: payGlob,
});

export function hasWcVendorComponent(id: string): boolean {
  return registry.has(id);
}

export function resolveWcVendorComponent(id: string) {
  return registry.resolve(id);
}

export function hasPaymentGatewayPayComponent(id: string): boolean {
  return payRegistry.has(id);
}

export function resolvePaymentGatewayPayComponent(
  id: string,
): ComponentType<PaymentGatewayPayProps> {
  return payRegistry.resolve(id);
}
