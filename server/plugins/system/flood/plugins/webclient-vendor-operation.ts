import { z } from "zod";
import { registerFloodPlugin } from "../registry";
import { floodConfigSchema, floodSettingsSchema, type FloodPlugin } from "../types";
import { wcVendorRegistry } from "../../../wc-vendors/registry";
import { isPluginComponentEnabledSync } from "../../../_core/gating";
import type { JsonSchema } from "@shared/json-schema-form";

export const VENDOR_OPERATION_FLOOD_PLUGIN_ID = "webclient-vendor-operation";
const settings = floodSettingsSchema.extend({
  vendorId: z.string().min(1), operation: z.string().min(1),
});

const plugin: FloodPlugin = {
  id: VENDOR_OPERATION_FLOOD_PLUGIN_ID,
  name: "Webclient vendor operation",
  description: "Best-effort, deployment-wide limits on outbound attempts for a vendor and operation. Cached/local answers consume no budget. Each configuration is independent; all matching rules must allow dispatch.",
  singleton: false,
  defaults: { threshold: 100, windowSeconds: 60 },
  getIdentifier: () => "global",
  matches(data, context) {
    if (!data || typeof data !== "object") return false;
    const target = data as { vendorId?: unknown; operation?: unknown };
    return target.vendorId === context.vendorId && target.operation === context.operation;
  },
  async validateConfig(data) {
    const parsed = settings.safeParse(data);
    if (!parsed.success) return { valid: false, errors: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
    const vendor = wcVendorRegistry.get(parsed.data.vendorId);
    if (!vendor?.service || vendor.hidden || !isPluginComponentEnabledSync(wcVendorRegistry.getMetadata(vendor))) {
      return { valid: false, errors: ["Select an available external vendor."] };
    }
    if (!Object.hasOwn(vendor.operations, parsed.data.operation)) {
      return { valid: false, errors: ["Select an operation supported by this vendor."] };
    }
    return { valid: true };
  },
  configSchema() {
    const vendors = wcVendorRegistry.list().filter(v => v.service);
    // Derive on every manifest read: vendors register later than this plugin.
    return {
      ...floodConfigSchema(plugin),
      required: ["threshold", "windowSeconds", "vendorId", "operation"],
      properties: {
        ...floodConfigSchema(plugin).properties,
        operation: { type: "string", title: "Operation" },
        vendorId: {
          type: "string", title: "Vendor",
          oneOf: vendors.map(v => ({
            const: v.id, title: `${v.name}${vendorAvailable(v) ? "" : " (unavailable)"}`,
          })),
        },
      },
      dependencies: {
        vendorId: {
          oneOf: vendors.map(v => ({
            properties: {
              vendorId: { const: v.id },
              operation: {
                type: "string", title: "Operation",
                oneOf: Object.keys(v.operations).map(op => ({ const: op, title: op })),
              },
            },
          })),
        },
      },
    } as JsonSchema;
  },
  uiSchema() {
    return {
      "ui:order": ["vendorId", "operation", "threshold", "windowSeconds"],
      vendorId: { "ui:enumDisabled": wcVendorRegistry.list().filter(v => !vendorAvailable(v)).map(v => v.id) },
    };
  },
};
function vendorAvailable(vendor: ReturnType<typeof wcVendorRegistry.list>[number]): boolean {
  return Boolean(vendor.service && !vendor.hidden &&
    isPluginComponentEnabledSync(wcVendorRegistry.getMetadata(vendor)));
}
registerFloodPlugin(plugin);
