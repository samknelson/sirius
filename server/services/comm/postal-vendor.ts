import { storage } from "../../storage";
import type { PluginConfig } from "@shared/schema";
import { getEnvironmentVariable } from "../../config/env-registry";
import { wcRequest, type WcVendorTarget } from "../webclient";
import type {
  AddressVerificationResult,
  LetterSendResult,
  LetterTrackingEvent,
  PostalAddress,
  PostalTemplate,
  SendLetterParams,
} from "./providers/postal";
import type {
  GatewayConnectionTest,
  WcVendorOperationArgs,
  WcVendorOperationName,
  WcVendorOperationResult,
} from "../../plugins/wc-vendors/types";
import type { PostalVendorTypesLoaded } from "../../plugins/wc-vendors/postal-types";
void (undefined as unknown as PostalVendorTypesLoaded);
import {
  LOB_POSTAL_PLUGIN_ID,
  LOCAL_POSTAL_PLUGIN_ID,
} from "../../plugins/wc-vendors/plugins/postal";
import { getWcVendorPlugin } from "../../plugins/wc-vendors/registry";

export type PostalPluginId = typeof LOB_POSTAL_PLUGIN_ID | typeof LOCAL_POSTAL_PLUGIN_ID;
const POSTAL_VENDOR_LOCK = "wc-vendors:postal-selection";

type LegacyPostalConfig = {
  defaultProvider?: string;
  providers?: Record<string, { settings?: Record<string, unknown> }>;
};

async function legacyPostalConfig(): Promise<LegacyPostalConfig> {
  const variable = await storage.variables.getByName("service_config:postal");
  return variable?.value && typeof variable.value === "object"
    ? variable.value as LegacyPostalConfig
    : {};
}

function isPostalPlugin(config: { pluginKind: string; pluginId: string }): boolean {
  return config.pluginKind === "wc-vendors" &&
    (config.pluginId === LOB_POSTAL_PLUGIN_ID || config.pluginId === LOCAL_POSTAL_PLUGIN_ID);
}

function legacyProviderId(config: LegacyPostalConfig): PostalPluginId | undefined {
  const raw = config.defaultProvider?.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === LOB_POSTAL_PLUGIN_ID) return LOB_POSTAL_PLUGIN_ID;
  if (raw === LOCAL_POSTAL_PLUGIN_ID || raw === "local") return LOCAL_POSTAL_PLUGIN_ID;
  throw new Error(
    `Legacy postal configuration selects unsupported provider '${config.defaultProvider}'. ` +
    "Choose Lob or Local Postal before retrying the migration.",
  );
}

function hasLobEnvironmentCredential(): boolean {
  // Presence only: the effective value may come from deployment env or an
  // in-app DB override, but it is never persisted, logged, or returned.
  const value = getEnvironmentVariable("LOB_API_KEY");
  return typeof value === "string" && value.trim().length > 0;
}

function configData(config: PluginConfig): Record<string, unknown> {
  return config.data && typeof config.data === "object"
    ? { ...(config.data as Record<string, unknown>) }
    : {};
}

async function migrateLegacySettings(
  config: PluginConfig,
  pluginId: PostalPluginId,
  legacy: LegacyPostalConfig,
): Promise<PluginConfig> {
  const settings =
    legacy.providers?.[pluginId]?.settings ??
    (pluginId === LOCAL_POSTAL_PLUGIN_ID ? legacy.providers?.local?.settings : undefined);

  const data = configData(config);
  let changed = false;
  if (data.defaultReturnAddress === undefined && settings?.defaultReturnAddress) {
    data.defaultReturnAddress = settings.defaultReturnAddress;
    changed = true;
  }
  if (
    pluginId === LOB_POSTAL_PLUGIN_ID &&
    (typeof data.secretName !== "string" || !data.secretName.trim())
  ) {
    data.secretName =
      typeof settings?.secretName === "string" && settings.secretName.trim()
        ? settings.secretName.trim()
        : "LOB_API_KEY";
    changed = true;
  }
  if (!changed) return config;
  return (await storage.pluginConfigs.update(config.id, { data })) ?? { ...config, data };
}

/**
 * Bridge installations that still have only the old service_config:postal
 * row. The API key itself is never copied; only the old well-known name is
 * carried forward as the named-secret reference.
 */
async function ensurePostalVendorConfigLocked(): Promise<PluginConfig> {
  const configs = (await storage.pluginConfigs.getByKind("wc-vendors")).filter(isPostalPlugin);
  const enabled = configs.filter((config) => config.enabled);

  // An enabled wc-vendor row is an established administrator selection. It
  // must win over stale legacy settings and environment defaults forever.
  if (enabled.length > 1) {
    throw new Error(
      `Ambiguous postal vendor selection: multiple configs are enabled ` +
      `(${enabled.map((config) => config.id).join(", ")}). Disable all but one.`,
    );
  }
  if (enabled.length === 1) return enabled[0];

  const legacy = await legacyPostalConfig();
  const preferred = legacyProviderId(legacy) ??
    (hasLobEnvironmentCredential() ? LOB_POSTAL_PLUGIN_ID : undefined);

  if (preferred) {
    const matching = configs.filter((config) => config.pluginId === preferred);
    if (matching.length > 1) {
      throw new Error(
        `Ambiguous legacy postal migration: provider '${preferred}' has multiple configs ` +
        `(${matching.map((config) => config.id).join(", ")}). Disable all but one before retrying.`,
      );
    }
    let selected = matching[0];
    if (!selected) {
      selected = await storage.pluginConfigs.create({
        pluginKind: "wc-vendors",
        pluginId: preferred,
        enabled: false,
        name: preferred === LOB_POSTAL_PLUGIN_ID ? "Lob Postal" : "Local Postal",
        ordering: 0,
        data: {},
      });
      await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: selected.id });
    }
    selected = await migrateLegacySettings(selected, preferred, legacy);
    for (const config of configs) {
      if (config.id !== selected.id && config.enabled) {
        await storage.pluginConfigs.update(config.id, { enabled: false });
      }
    }
    if (!selected.enabled) {
      selected =
        (await storage.pluginConfigs.update(selected.id, { enabled: true })) ??
        { ...selected, enabled: true };
    }
    return selected;
  }

  if (configs.length === 1) {
    return (
      (await storage.pluginConfigs.update(configs[0].id, { enabled: true })) ??
      { ...configs[0], enabled: true }
    );
  }
  if (configs.length > 1) {
    throw new Error(
      `Ambiguous postal vendor selection: no config is enabled and multiple configs exist ` +
      `(${configs.map((config) => config.id).join(", ")}). Enable exactly one.`,
    );
  }

  const created = await storage.pluginConfigs.create({
    pluginKind: "wc-vendors",
    pluginId: LOCAL_POSTAL_PLUGIN_ID,
    enabled: true,
    name: "Local Postal",
    ordering: 0,
    data: {},
  });
  await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: created.id });
  return created;
}

export async function ensurePostalVendorConfig(): Promise<PluginConfig> {
  return storage.advisoryLock.withTransactionLock(
    POSTAL_VENDOR_LOCK,
    ensurePostalVendorConfigLocked,
  );
}

/**
 * Select the configured postal vendor without consulting the legacy Comm
 * provider registry. A legacy selection is migrated first; without one, an
 * existing enabled config is preserved and a fresh installation gets Local
 * Postal. Ambiguous rows fail before any request can be addressed.
 */
export async function resolvePostalPluginId(): Promise<PostalPluginId> {
  const config = await ensurePostalVendorConfig();
  return config.pluginId as PostalPluginId;
}

export async function resolvePostalVendorTarget(): Promise<WcVendorTarget> {
  const config = await ensurePostalVendorConfig();
  return postalTarget(config.id);
}

export async function getPostalVendorConfig(pluginId: PostalPluginId) {
  await ensurePostalVendorConfig();
  const configs = await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", pluginId);
  if (configs.length > 1) {
    throw new Error(
      `Ambiguous postal provider '${pluginId}': multiple configs exist ` +
      `(${configs.map((config) => config.id).join(", ")}).`,
    );
  }
  return configs[0];
}

export async function setPostalVendor(
  pluginId?: PostalPluginId,
  targetConfigId?: string,
): Promise<PluginConfig> {
  return storage.advisoryLock.withTransactionLock(POSTAL_VENDOR_LOCK, async () => {
    let configs = (await storage.pluginConfigs.getByKind("wc-vendors")).filter(isPostalPlugin);
    let selected = targetConfigId
      ? configs.find((config) => config.id === targetConfigId)
      : undefined;
    if (targetConfigId && !selected) {
      throw new Error(`Postal vendor configuration '${targetConfigId}' was not found.`);
    }
    if (selected && pluginId && selected.pluginId !== pluginId) {
      throw new Error(
        `Postal vendor configuration '${targetConfigId}' is '${selected.pluginId}', ` +
        `not requested provider '${pluginId}'.`,
      );
    }

    if (!selected && !targetConfigId) {
      selected = await ensurePostalVendorConfigLocked();
      configs = (await storage.pluginConfigs.getByKind("wc-vendors")).filter(isPostalPlugin);
      if (pluginId && selected.pluginId !== pluginId) selected = undefined;
    }

    if (!selected && pluginId) {
      const matches = configs.filter((config) => config.pluginId === pluginId);
      if (matches.length > 1) {
        throw new Error(
          `Multiple postal vendor configurations exist for '${pluginId}' ` +
          `(${matches.map((config) => config.id).join(", ")}); select a target config ID.`,
        );
      }
      selected = matches[0];
    }
    if (!selected && pluginId) {
      selected = await storage.pluginConfigs.create({
        pluginKind: "wc-vendors",
        pluginId,
        enabled: false,
        name: pluginId === LOB_POSTAL_PLUGIN_ID ? "Lob Postal" : "Local Postal",
        ordering: 0,
        data: pluginId === LOB_POSTAL_PLUGIN_ID
          ? { secretName: "LOB_API_KEY" }
          : {},
      });
      await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: selected.id });
      configs.push(selected);
    }
    if (!selected) {
      throw new Error("A postal provider or target configuration ID is required.");
    }

    for (const config of configs) {
      if (config.id !== selected.id && config.enabled) {
        await storage.pluginConfigs.update(config.id, { enabled: false });
      }
    }
    if (!selected.enabled) {
      selected =
        (await storage.pluginConfigs.update(selected.id, { enabled: true })) ??
        { ...selected, enabled: true };
    }
    return selected;
  });
}

export function postalTarget(configId: string): WcVendorTarget {
  return { configId };
}

export async function postalPluginIdForTarget(
  target: WcVendorTarget,
): Promise<PostalPluginId> {
  if ("pluginId" in target) {
    if (target.pluginId !== LOB_POSTAL_PLUGIN_ID && target.pluginId !== LOCAL_POSTAL_PLUGIN_ID) {
      throw new Error(`Unknown postal vendor plugin '${target.pluginId}'`);
    }
    return target.pluginId;
  }
  const config = await storage.pluginConfigs.get(target.configId);
  if (!config || !isPostalPlugin(config)) {
    throw new Error(`Config '${target.configId}' is not a postal vendor configuration`);
  }
  return config.pluginId as PostalPluginId;
}

export async function postalSupportsOperation(
  target: WcVendorTarget,
  operation: WcVendorOperationName,
): Promise<boolean> {
  const pluginId = await postalPluginIdForTarget(target);
  const plugin = getWcVendorPlugin(pluginId);
  return Boolean(plugin && operation in plugin.operations);
}

export async function postalRequest<N extends WcVendorOperationName>(
  target: PostalPluginId | WcVendorTarget,
  operation: N,
  args: WcVendorOperationArgs<N>,
): Promise<WcVendorOperationResult<N>> {
  const vendor = typeof target === "string"
    ? postalTarget((await getPostalVendorConfig(target))?.id ?? "")
    : "configId" in target
      ? target
      : postalTarget((await getPostalVendorConfig(target.pluginId as PostalPluginId))?.id ?? "");
  if (!vendor.configId) throw new Error(`No postal vendor configuration exists for '${target}'`);
  const result = await wcRequest({
    vendor,
    operation,
    args,
  });
  if (result.outcome !== "success") {
    if (result.cause !== undefined) throw result.cause;
    throw new Error(result.error || "Postal vendor did not answer");
  }
  return result.value as WcVendorOperationResult<N>;
}

export type PostalTestResult = GatewayConnectionTest;
export type PostalVerifyResult = AddressVerificationResult;
export type PostalSendResult = LetterSendResult;
export type PostalStatusResult = { status: string; trackingEvents: LetterTrackingEvent[] };
export type PostalTemplatesResult = PostalTemplate[];
export type PostalSendParams = SendLetterParams;
export type { PostalAddress };
