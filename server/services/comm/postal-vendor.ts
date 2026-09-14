import { storage } from "../../storage";
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

export type PostalPluginId = typeof LOB_POSTAL_PLUGIN_ID | typeof LOCAL_POSTAL_PLUGIN_ID;

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

export function postalTarget(configId: string): WcVendorTarget {
  return { configId };
}

export async function postalRequest<N extends WcVendorOperationName>(
  target: PostalPluginId | WcVendorTarget,
  operation: N,
  args: WcVendorOperationArgs<N>,
): Promise<WcVendorOperationResult<N>> {
  const vendor = typeof target === "string"
    ? postalTarget((await getPostalVendorConfig(target))?.id ?? "")
    : "configId" in target || "any" in target
      ? target
      : postalTarget((await getPostalVendorConfig(target.pluginId as PostalPluginId))?.id ?? "");
  if ("configId" in vendor && !vendor.configId) {
    throw new Error(`No postal vendor configuration exists for '${target}'`);
  }
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
