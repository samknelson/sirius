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
import {
  BTU_CARDCHECK_PLUGIN_ID,
  LEGACY_BTU_CHROMIUM_PATH,
  LEGACY_BTU_SITE_URL,
} from "./plugins/btu-cardcheck";
import {
  listEnvironmentVariables,
  registerEnvironmentVariable,
} from "../../config/env-registry";

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
      // Operation assignments are configuration data, rather than a second
      // registry or a relational table. Validate them against the live
      // plugin declaration so an assignment can never make `any` dispatch to
      // an operation this plugin cannot actually run.
      if (data.operations !== undefined) {
        if (
          !Array.isArray(data.operations) ||
          data.operations.some(
            (operation) => typeof operation !== "string" || !operation.trim(),
          )
        ) {
          return {
            valid: false,
            errors: ["Assigned operations must be a list of operation IDs."],
          };
        }
        const supported = new Set(Object.keys(vendor.operations));
        const unsupported = data.operations.filter(
          (operation): operation is string =>
            typeof operation === "string" && !supported.has(operation),
        );
        if (unsupported.length > 0) {
          return {
            valid: false,
            errors: [
              `Unsupported operation assignment(s) for "${vendor.name}": ` +
                `${unsupported.join(", ")}. ` +
                `Supported: ${Array.from(supported).join(", ") || "(none)"}.`,
            ],
          };
        }
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
      // The generic editor sends this envelope field at the top level; the
      // adapter folds it into data.operations below. A comma-separated string
      // is accepted as well because the generic static multi-select uses a
      // string while it is in the form state.
      operations: z.preprocess(
        (value) =>
          typeof value === "string"
            ? value.split(",").map((operation) => operation.trim()).filter(Boolean)
            : value,
        z.array(z.string().min(1)).nullable().optional(),
      ),
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
      if (input.operations === null) {
        delete data.operations;
      } else if (input.operations !== undefined) {
        data.operations = Array.from(
          new Set(input.operations.map((operation: string) => operation.trim())),
        );
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
        // Keep an unassigned config absent at the data/API boundary. Besides
        // making "absent means none" explicit, this lets a partial generic
        // update preserve existing assignments when it does not mention them.
        ...(Array.isArray(data.operations) ? { operations: data.operations } : {}),
      };
    },
    envelopeFields: [
      { name: "secretName", label: "Secret Name", type: "string" },
      {
        name: "operations",
        label: "Assigned operations",
        type: "string",
        multiple: true,
        options: {
          choices: Array.from(
            new Map(
              wcVendorRegistry.list().flatMap((plugin) =>
                Object.entries(plugin.operations).map(([value, operation]) => [
                  value,
                  {
                    value,
                    label: `${plugin.name}: ${operation?.description ?? value}`,
                  },
                ] as const),
              ),
            ).values(),
          ),
        },
      },
    ],
    envelopeFieldsForPlugin: (plugin) => {
      const credential = (plugin as RegisteredWcVendorPlugin).credential;
      const requirement = credential.secretName;
      const vendor = plugin as RegisteredWcVendorPlugin;
      const fields: import("../_core").PluginConfigEnvelopeField[] = [{
        name: "operations",
        label: "Assigned operations",
        type: "string",
        multiple: true,
        options: {
          choices: Object.entries(vendor.operations).flatMap(
            ([value, operation]) =>
              operation
                ? [{ value, label: operation.description }]
                : [],
          ),
        },
      }];
      if (requirement !== "none") {
        fields.unshift({
          name: "secretName",
          label: "Secret Name",
          type: "string",
          required: requirement === "required",
          description: credential.setupGuidance,
          example: credential.setupExample,
        });
      }
      return fields;
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

const CIVIC_CONFIG_MIGRATION_LOCK = "wc-vendors:civic-config-migration";

export interface LegacyCivicConfigPlanInput {
  existingPluginIds: ReadonlySet<string>;
  availableSecretNames: ReadonlySet<string>;
  configuredGoogleSecretName?: string;
}

export interface LegacyCivicConfigPlan {
  configs: Array<{
    pluginId: "google-geocoding" | "openstates" | "census-geocoder";
    name: string;
    secretName?: string;
  }>;
  ambiguousGoogleSecretNames: string[];
}

/** Pure migration decision; separated so every fail-closed branch is testable. */
export function planLegacyCivicWcVendorConfigs(
  input: LegacyCivicConfigPlanInput,
): LegacyCivicConfigPlan {
  const configs: LegacyCivicConfigPlan["configs"] = [];
  const has = (pluginId: string) => input.existingPluginIds.has(pluginId);
  let ambiguousGoogleSecretNames: string[] = [];

  if (!has("google-geocoding")) {
    const candidates = Array.from(new Set([
      input.configuredGoogleSecretName?.trim(),
      "GOOGLE_MAPS_API_KEY",
      "GOOGLE_CIVICS_API_KEY",
    ].filter((name): name is string =>
      Boolean(name) && input.availableSecretNames.has(name as string),
    )));
    if (candidates.length === 1) {
      configs.push({
        pluginId: "google-geocoding",
        name: "Google Geocoding",
        secretName: candidates[0],
      });
    } else if (candidates.length > 1) {
      ambiguousGoogleSecretNames = candidates;
    }
  }
  if (
    !has("openstates") &&
    input.availableSecretNames.has("OPEN_STATES_API_KEY")
  ) {
    configs.push({
      pluginId: "openstates",
      name: "OpenStates",
      secretName: "OPEN_STATES_API_KEY",
    });
  }
  if (!has("census-geocoder")) {
    configs.push({
      pluginId: "census-geocoder",
      name: "US Census Geocoder",
    });
  }
  return { configs, ambiguousGoogleSecretNames };
}

/**
 * Convert the three legacy environment-backed civic connections into normal
 * wc-vendor configurations. Only secret NAMES are persisted. Existing rows
 * always win, including disabled and ambiguous sets: boot must never rewrite
 * an administrator's connection choices.
 */
export async function migrateLegacyCivicWcVendorConfigs(): Promise<void> {
  const { storage } = await import("../../storage");
  const { withFrameworkWrite } = await import("../../middleware/request-context");

  await withFrameworkWrite(() =>
    storage.advisoryLock.withTransactionLock(CIVIC_CONFIG_MIGRATION_LOCK, async () => {
      const existingRows = await storage.pluginConfigs.getByKind("wc-vendors");
      const existingPluginIds = new Set(existingRows.map((row) => row.pluginId));
      const addressConfig = await storage.variables.getByName("address_validation_config");
      const addressValue =
        addressConfig?.value && typeof addressConfig.value === "object"
          ? addressConfig.value as Record<string, unknown>
          : {};
      const google =
        addressValue.google && typeof addressValue.google === "object"
          ? addressValue.google as Record<string, unknown>
          : {};
      const configuredName =
        typeof google.apiKeyName === "string" ? google.apiKeyName.trim() : "";
      if (configuredName) {
        registerEnvironmentVariable({
          name: configuredName,
          description: "Legacy Google Maps key available for a Google Geocoding connection.",
          secret: true,
          category: "core",
          changeTakesEffect: "immediate",
        });
      }

      const available = new Set(
        listEnvironmentVariables().filter((entry) => entry.isSet).map((entry) => entry.name),
      );
      const plan = planLegacyCivicWcVendorConfigs({
        existingPluginIds,
        availableSecretNames: available,
        configuredGoogleSecretName: configuredName,
      });

      for (const config of plan.configs) {
        const row = await storage.pluginConfigs.create({
          pluginKind: "wc-vendors",
          pluginId: config.pluginId,
          enabled: true,
          name: config.name,
          ordering: 0,
          data: config.secretName ? { secretName: config.secretName } : {},
        });
        await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: row.id });
      }

      if (plan.ambiguousGoogleSecretNames.length > 1) {
        logger.error(
          "Google Geocoding connection was not migrated because several legacy credential names are active",
          {
            service: "wc-vendor-plugins",
            secretNames: plan.ambiguousGoogleSecretNames,
          },
        );
      }
    }),
  );
}

const BTU_SCRAPE_CONFIG_MIGRATION_LOCK = "wc-vendors:btu-scrape-config-migration";

export function planLegacyBtuScrapeWcVendorConfig(input: {
  hasExistingConfig: boolean;
  username?: string;
  passwordSecretIsSet: boolean;
}): Record<string, unknown> | null {
  if (input.hasExistingConfig || !input.username?.trim() || !input.passwordSecretIsSet) {
    return null;
  }
  return {
    secretName: "BTU_SCRAPER_PASSWORD",
    siteUrl: LEGACY_BTU_SITE_URL,
    username: input.username.trim(),
    chromiumPath: LEGACY_BTU_CHROMIUM_PATH,
  };
}

/** Seed the canonical BTU connection without ever reading or persisting its password. */
export async function migrateLegacyBtuScrapeWcVendorConfig(): Promise<void> {
  const { storage } = await import("../../storage");
  const { withFrameworkWrite } = await import("../../middleware/request-context");
  const { getEnvironmentVariable } = await import("../../config/env-registry");
  await withFrameworkWrite(() =>
    storage.advisoryLock.withTransactionLock(
      BTU_SCRAPE_CONFIG_MIGRATION_LOCK,
      async () => {
        const existing = await storage.pluginConfigs.getByKindAndPlugin(
          "wc-vendors",
          BTU_CARDCHECK_PLUGIN_ID,
        );
        const passwordMeta = listEnvironmentVariables().find(
          (entry) => entry.name === "BTU_SCRAPER_PASSWORD",
        );
        const data = planLegacyBtuScrapeWcVendorConfig({
          hasExistingConfig: existing.length > 0,
          username: getEnvironmentVariable("BTU_SCRAPER_USERNAME"),
          passwordSecretIsSet: passwordMeta?.isSet === true,
        });
        if (!data) return;
        const row = await storage.pluginConfigs.create({
          pluginKind: "wc-vendors",
          pluginId: BTU_CARDCHECK_PLUGIN_ID,
          enabled: true,
          name: "BTU Card Check",
          ordering: 0,
          data,
        });
        await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: row.id });
      },
    ),
  );
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/stripe";
import "./plugins/dummy";
import "./plugins/sitespecific-t631";
import "./plugins/sitespecific-freeman-edls-migrate";
import "./plugins/sitespecific-freeman-authorization";
import "./plugins/postal";
import "./plugins/email";
import "./plugins/sms-twilio";
import "./plugins/sms-local";
import "./plugins/google-geocoding";
import "./plugins/openstates";
import "./plugins/census-geocoder";
