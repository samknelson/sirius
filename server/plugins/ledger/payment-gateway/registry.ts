import { PluginRegistry } from "../../_core";
import type {
  PaymentGatewayPlugin,
  PaymentGatewayManifestEntry,
} from "./types";

export const paymentGatewayRegistry = new PluginRegistry<
  PaymentGatewayPlugin,
  PaymentGatewayManifestEntry
>({
  kind: "payment-gateway",
  getMetadata: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    requiredComponent: p.requiredComponent,
    requiredPolicy: p.requiredPolicy,
    hidden: p.hidden,
  }),
  toManifestEntry: (p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    requiredComponent: p.requiredComponent,
  }),
});

/**
 * Convenience helper used by individual plugin files to self-register at
 * module top level. Mirrors `registerChargePlugin` / `registerClientInjection`.
 */
export function registerPaymentGatewayPlugin(plugin: PaymentGatewayPlugin): void {
  paymentGatewayRegistry.register(plugin);
}

export function getPaymentGatewayPlugin(
  id: string,
): PaymentGatewayPlugin | undefined {
  return paymentGatewayRegistry.get(id);
}
