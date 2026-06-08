import { z } from "zod";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { paymentGatewayRegistry } from "./registry";

export {
  paymentGatewayRegistry,
  registerPaymentGatewayPlugin,
  getPaymentGatewayPlugin,
} from "./registry";
export type * from "./types";

let kindRegistered = false;
export function registerPaymentGatewayPluginKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "payment-gateway",
    registry: paymentGatewayRegistry,
    label: "Payment Gateways",
    description:
      "Payment gateway providers (e.g. Stripe). Each configuration names the secret that holds its API credentials.",
    // Mirror the charge kind's gating: ledger component + admin policy.
    requiredComponent: "ledger",
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  // Payment-gateway configs carry no relational dimensions, so they live
  // entirely in the base table — the adapter declares no subsidiary. The
  // editable `secretName` (the NAME of the secret holding the provider's API
  // credentials, never the value) rides in `data`, mirroring how the
  // trust-eligibility adapter relocates `appliesTo` into `data`.
  registerPluginConfigAdapter({
    pluginType: "payment-gateway",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      secretName: z.string().min(1, "secretName is required"),
    }),
    // No `secretName` filter: it lives in `data` and the generic search
    // dispatcher only filters base columns + subsidiary tables, so declaring
    // one here would be silently ignored. The base filters (pluginId, enabled,
    // siriusId) are sufficient for this kind.
    searchParamsSchema: z.object({
      ...baseSearchSchemaShape,
    }),
    toRows: (input) => ({
      base: {
        pluginType: "payment-gateway",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        // Fold `secretName` into `data` (the authoritative store for this
        // field) while preserving any other data the caller supplied.
        data: {
          ...(input.data && typeof input.data === "object" ? input.data : {}),
          secretName: input.secretName,
        },
      },
    }),
    // Lift `data.secretName` back to the top-level flat shape clients send, so
    // round-tripping a config (read -> PATCH) keeps the field populated.
    hydrate: (envelope) => {
      const base = { ...envelope.config } as Record<string, unknown>;
      const data = (base.data ?? {}) as Record<string, unknown>;
      return { ...base, secretName: (data.secretName as string) ?? "" };
    },
    envelopeFields: [
      { name: "secretName", label: "Secret Name", type: "string", required: true },
    ],
  });
  kindRegistered = true;
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/stripe";
