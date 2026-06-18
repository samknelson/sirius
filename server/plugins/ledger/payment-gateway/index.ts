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
    // Delegate provider-specific config validation (e.g. Stripe's `pk_`
    // publishable-key prefix) to the plugin. The generic create/update path
    // already enforces required per-plugin fields from `configFields`; this
    // covers format checks beyond presence.
    validateConfig: (plugin, config) =>
      plugin.validateConfig
        ? plugin.validateConfig((config ?? {}) as Record<string, unknown>)
        : { valid: true },
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
    pluginKind: "payment-gateway",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      secretName: z.string().min(1, "secretName is required"),
      // Accepted payment method types for this config (e.g. ["card",
      // "us_bank_account"]). Lives in `data`; the provider declares the catalog
      // of valid options. Optional so generic create/update without it leaves
      // any existing value untouched.
      paymentTypes: z.array(z.string()).optional(),
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
        pluginKind: "payment-gateway",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        // Fold `secretName` (and, when supplied, `paymentTypes`) into `data`
        // (the authoritative store for these fields) while preserving any other
        // data the caller supplied. `paymentTypes` is folded conditionally so a
        // generic update that omits it leaves any existing list untouched.
        data: {
          ...(input.data && typeof input.data === "object" ? input.data : {}),
          secretName: input.secretName,
          ...(input.paymentTypes !== undefined
            ? { paymentTypes: input.paymentTypes }
            : {}),
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
      return {
        ...base,
        secretName: (data.secretName as string) ?? "",
        paymentTypes: Array.isArray(data.paymentTypes) ? data.paymentTypes : [],
      };
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
  const configs = await storage.pluginConfigs.getByKind("payment-gateway");
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

/**
 * One-time migration of the legacy global `stripe_payment_methods` variable
 * onto each gateway config's own `data.paymentTypes`. Before this task the
 * accepted payment types lived in a single global variable, which the setup
 * flow read. Now every config carries its own list. This backfill copies the
 * old global value onto any config that has no `paymentTypes` of its own, then
 * deletes the global so it is no longer the source of truth. Runs at boot after
 * the kind is registered; re-running is a no-op (the variable is gone).
 */
export async function backfillPaymentTypesFromGlobal(): Promise<void> {
  const { storage } = await import("../../../storage");
  const variable = await storage.variables.getByName("stripe_payment_methods");
  if (!variable) return; // already migrated / never set

  const legacyTypes = Array.isArray(variable.value)
    ? (variable.value as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  let allSucceeded = true;

  if (legacyTypes.length > 0) {
    // The legacy variable was Stripe-specific, so only seed Stripe configs that
    // do not already carry their own list. Other providers must not inherit a
    // Stripe payment-type list.
    const configs = (await storage.pluginConfigs.getByKind("payment-gateway"))
      .filter((cfg) => cfg.pluginId === "stripe");
    for (const cfg of configs) {
      const data = (cfg.data ?? {}) as Record<string, unknown>;
      if (Array.isArray(data.paymentTypes) && data.paymentTypes.length > 0) {
        continue; // config already has its own list
      }
      try {
        await storage.pluginConfigs.update(cfg.id, {
          data: { ...data, paymentTypes: legacyTypes },
        });
        logger.info(
          `Backfilled payment types onto gateway config ${cfg.id} from legacy global variable`,
          { service: "payment-gateway-plugins" },
        );
      } catch (error) {
        allSucceeded = false;
        logger.error(`Failed to backfill payment types for config ${cfg.id}`, {
          service: "payment-gateway-plugins",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Only retire the global variable once every targeted config was seeded. If
  // any update failed we keep it so the next boot can retry — deleting it early
  // would lose the only remaining source of truth for the failed configs.
  if (!allSucceeded) {
    logger.warn(
      "Keeping legacy stripe_payment_methods variable: some configs failed to backfill; will retry on next boot",
      { service: "payment-gateway-plugins" },
    );
    return;
  }

  await storage.variables.delete(variable.id);
  logger.info("Retired legacy stripe_payment_methods global variable", {
    service: "payment-gateway-plugins",
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/stripe";
import "./plugins/dummy";
