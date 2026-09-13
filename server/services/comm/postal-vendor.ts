import { storage } from "../../storage";
import type { PluginConfig } from "@shared/schema";
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

function isPostalPlugin(config: { pluginKind: string; pluginId: string }): boolean {
  return config.pluginKind === "wc-vendors" &&
    (config.pluginId === LOB_POSTAL_PLUGIN_ID || config.pluginId === LOCAL_POSTAL_PLUGIN_ID);
}

/**
 * Return the single canonical postal wc-vendor selection.
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

  throw new Error("No enabled postal wc-vendor configuration exists.");
}

export async function ensurePostalVendorConfig(): Promise<PluginConfig> {
  return storage.advisoryLock.withTransactionLock(
    POSTAL_VENDOR_LOCK,
    ensurePostalVendorConfigLocked,
  );
}

/**
 * Select the configured postal vendor without consulting legacy provider data.
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
  const configs = await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", pluginId);
  if (configs.length > 1) {
    throw new Error(
      `Ambiguous postal provider '${pluginId}': multiple configs exist ` +
      `(${configs.map((config) => config.id).join(", ")}).`,
    );
  }
  return configs[0];
}

export async function getPostalVendorConfigs(): Promise<PluginConfig[]> {
  return (await storage.pluginConfigs.getByKind("wc-vendors")).filter(isPostalPlugin);
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
      if (!pluginId) {
        selected = await ensurePostalVendorConfigLocked();
        configs = (await storage.pluginConfigs.getByKind("wc-vendors")).filter(isPostalPlugin);
      }
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
