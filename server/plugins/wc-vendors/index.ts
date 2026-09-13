import { z } from "zod";
import {
  registerPluginKind,
  registerPluginConfigAdapter,
  baseConfigSchemaShape,
  baseSearchSchemaShape,
} from "../_core";
import { logger } from "../../logger";
import { wcVendorRegistry } from "./registry";
import type { RegisteredWcVendorPlugin } from "./types";

export {
  wcVendorRegistry,
  registerWcVendorPlugin,
  getWcVendorPlugin,
  getWcVendorOperationManifest,
} from "./registry";
export type * from "./types";

let kindRegistered = false;
export function registerWcVendorPluginKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "wc-vendors",
    registry: wcVendorRegistry,
    label: "Webclient Vendors",
    description:
      "Outside systems this site calls through the web client framework (e.g. Stripe). Each configuration names the secret that holds its API credentials.",
    // No kind-wide component gate, deliberately. A webclient vendor is any
    // outside system this site calls, so the kind cannot belong to one
    // domain's component: a site with the ledger switched off may still call
    // vendors that have nothing to do with payments. Gating is per-plugin
    // instead — each plugin declares its own `requiredComponent` (Stripe wants
    // `ledger.stripe`), and the routes below enforce it on the resolved
    // plugin. This mirrors the `web-service` kind, the other component-neutral
    // kind. Do not reintroduce a gate here or in the generic config router.
    requiredPolicy: "admin",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
    // Delegate provider-specific config validation (e.g. Stripe's `pk_`
    // publishable-key prefix) to the plugin. The generic create/update path
    // already enforces required per-plugin fields from `configFields`; this
    // covers format checks beyond presence.
    validateConfig: (plugin, config) => {
      const vendor = plugin as RegisteredWcVendorPlugin;
      const data = (config ?? {}) as Record<string, unknown>;
      const secretName =
        typeof data.secretName === "string" ? data.secretName.trim() : "";
      if (vendor.credential.secretName === "required" && !secretName) {
        return { valid: false, errors: ["Secret Name is required."] };
      }
      return vendor.validateConfig
        ? vendor.validateConfig(data)
        : { valid: true };
    },
  });
  // Webclient-vendor configs carry no relational dimensions of their own, but
  // they DO get a subsidiary row in `plugin_configs_wc_vendors`. That
  // table has no columns yet — it exists purely as a type-safe FK target so
  // other tables (e.g. `ledger_accounts.gateway_config_id`) can reference a
  // specific vendor config instead of the polymorphic base. The adapter's
  // `toRows` emits an empty `subsidiary` object so the generic create/update
  // path inserts the row; a boot-time backfill covers pre-existing configs.
  // The editable `secretName` (the NAME of the secret holding the provider's
  // API credentials, never the value) still rides in `data`, mirroring how the
  // trust-eligibility adapter relocates `appliesTo` into `data`.
  registerPluginConfigAdapter({
    pluginKind: "wc-vendors",
    configSchema: z.object({
      ...baseConfigSchemaShape,
      secretName: z.string().nullable().optional(),
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
    toRows: (input) => {
      const data: Record<string, unknown> = {
        ...(input.data && typeof input.data === "object" ? input.data : {}),
      };
      const requirement = wcVendorRegistry.get(input.pluginId)?.credential.secretName;
      if (requirement === "none" || input.secretName === null) {
        delete data.secretName;
      } else if (input.secretName !== undefined) {
        data.secretName = input.secretName;
      }
      if (input.paymentTypes !== undefined) {
        data.paymentTypes = input.paymentTypes;
      }

      return {
        base: {
        pluginKind: "wc-vendors",
        pluginId: input.pluginId,
        enabled: input.enabled,
        name: input.name,
        ordering: input.ordering,
        // Fold `secretName` (and, when supplied, `paymentTypes`) into `data`
        // (the authoritative store for these fields) while preserving any other
        // data the caller supplied. `paymentTypes` is folded conditionally so a
        // generic update that omits it leaves any existing list untouched.
          data,
        },
      // Empty subsidiary — the FK-target table has no columns yet. Returning an
      // (empty) object is what makes the generic CRUD path call
      // `upsertSubsidiary("wc-vendors", { id })`, so every config has a row
      // and stays visible through the inner-joined generic search.
        subsidiary: {},
      };
    },
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
      { name: "secretName", label: "Secret Name", type: "string" },
    ],
    envelopeFieldsForPlugin: (plugin) => {
      const credential = (plugin as RegisteredWcVendorPlugin).credential;
      const requirement = credential.secretName;
      if (requirement === "none") return [];
      return [{
        name: "secretName",
        label: "Secret Name",
        type: "string",
        required: requirement === "required",
        description: credential.setupGuidance,
        example: credential.setupExample,
      }];
    },
  });
  kindRegistered = true;
}

/**
 * Idempotently ensure every wc-vendors config has a subsidiary row in
 * `plugin_configs_wc_vendors`. The generic search inner-joins that table,
 * so a config without a row would silently vanish from listings. New configs
 * get their row from the adapter's `toRows`; this backfill covers configs that
 * existed before the subsidiary was introduced (e.g. Stripe). Runs at boot
 * after the kind is registered. Re-running is a no-op.
 */
export async function backfillWcVendorSubsidiaries(): Promise<void> {
  const { storage } = await import("../../storage");
  const { withFrameworkWrite } = await import("../../middleware/request-context");
  const configs = await storage.pluginConfigs.getByKind("wc-vendors");
  for (const cfg of configs) {
    try {
      const envelope = await storage.pluginConfigs.getWithSubsidiary(cfg.id);
      if (!envelope || envelope.subsidiary) continue; // already has a row
      // Backfilling a missing subsidiary row is the framework's own doing
      // (see `withFrameworkWrite`): no person, and no audit entry per boot.
      await withFrameworkWrite(() =>
        storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: cfg.id }),
      );
      logger.info(`Backfilled wc-vendors subsidiary for config ${cfg.id}`, {
        service: "wc-vendor-plugins",
      });
    } catch (error) {
      logger.error(`Failed to backfill wc-vendors subsidiary for config ${cfg.id}`, {
        service: "wc-vendor-plugins",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/stripe";
import "./plugins/dummy";
import "./plugins/sitespecific-t631";
import "./plugins/sitespecific-freeman-edls-migrate";
