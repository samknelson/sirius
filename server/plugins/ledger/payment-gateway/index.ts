import { z } from "zod";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../../_core";
import { logger } from "../../../logger";
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
  // Payment-gateway configs carry no relational dimensions of their own, but
  // they DO get a subsidiary row in `plugin_configs_payment_gateway`. That
  // table has no columns yet — it exists purely as a type-safe FK target so
  // other tables (e.g. `ledger_accounts.gateway_config_id`) can reference a
  // specific gateway config instead of the polymorphic base. The adapter's
  // `toRows` emits an empty `subsidiary` object so the generic create/update
  // path inserts the row; a boot-time backfill covers pre-existing configs.
  // The editable `secretName` (the NAME of the secret holding the provider's
  // API credentials, never the value) still rides in `data`, mirroring how the
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
      // Empty subsidiary — the FK-target table has no columns yet. Returning an
      // (empty) object is what makes the generic CRUD path call
      // `upsertSubsidiary("payment-gateway", { id })`, so every config has a row
      // and stays visible through the inner-joined generic search.
      subsidiary: {},
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

/**
 * Idempotently ensure every payment-gateway config has a subsidiary row in
 * `plugin_configs_payment_gateway`. The generic search inner-joins that table,
 * so a config without a row would silently vanish from listings. New configs
 * get their row from the adapter's `toRows`; this backfill covers configs that
 * existed before the subsidiary was introduced (e.g. Stripe). Runs at boot
 * after the kind is registered. Re-running is a no-op.
 */
export async function backfillPaymentGatewaySubsidiaries(): Promise<void> {
  const { storage } = await import("../../../storage");
  const configs = await storage.pluginConfigs.getByType("payment-gateway");
  for (const cfg of configs) {
    try {
      const envelope = await storage.pluginConfigs.getWithSubsidiary(cfg.id);
      if (!envelope || envelope.subsidiary) continue; // already has a row
      await storage.pluginConfigs.upsertSubsidiary("payment-gateway", { id: cfg.id });
      logger.info(`Backfilled payment-gateway subsidiary for config ${cfg.id}`, {
        service: "payment-gateway-plugins",
      });
    } catch (error) {
      logger.error(`Failed to backfill payment-gateway subsidiary for config ${cfg.id}`, {
        service: "payment-gateway-plugins",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/stripe";
