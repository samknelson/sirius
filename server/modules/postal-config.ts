import type { Express } from "express";
import { z } from "zod";
import { requireAccess } from "../services/access-policy-evaluator";
import { storage } from "../storage";
import { describeWcVendor, WcVendorError } from "../services/webclient/wc-vendor-context";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";
import { registerMessageDefaultsRoutes } from "./message-defaults";

const addressSchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().default("US"),
}).strict();

export function registerPostalConfigRoutes(app: Express) {
  registerMessageDefaultsRoutes(app, "postal");
  // Edit the selected delivery connection, never resurrect legacy service_config.
  app.get("/api/config/postal/return-address", requireAccess("admin"), async (_req, res) => {
    try {
      const selected = await describeWcVendor({ any: true }, "communications.postal.send");
      const config = await storage.pluginConfigs.get(selected.configId);
      const data = config?.data as Record<string, unknown> | undefined;
      return res.set("Cache-Control", "no-store").json({
        configId: selected.configId, configName: selected.configName,
        returnAddress: data?.defaultReturnAddress,
      });
    } catch (error) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      return res.status(error instanceof WcVendorError ? error.status : 500).json({
        message: error instanceof Error ? error.message : "Unable to load return address.",
      });
    }
  });
  app.put("/api/config/postal/return-address", requireAccess("admin"), async (req, res) => {
    try {
      const { configId, returnAddress } = z.object({
        configId: z.string().min(1), returnAddress: addressSchema,
      }).strict().parse(req.body);
      const selected = await describeWcVendor({ any: true }, "communications.postal.send");
      if (selected.configId !== configId) {
        return res.status(409).json({ message: "The postal delivery connection changed. Reload before saving." });
      }
      const config = await storage.pluginConfigs.get(configId);
      if (!config) return res.status(404).json({ message: "Postal connection no longer exists." });
      await storage.pluginConfigs.update(configId, {
        data: { ...(config.data as Record<string, unknown>), defaultReturnAddress: returnAddress },
      });
      return res.json({ configId, returnAddress });
    } catch (error) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      return res.status(error instanceof z.ZodError ? 400 : error instanceof WcVendorError ? error.status : 500).json({
        message: error instanceof Error ? error.message : "Unable to save return address.",
      });
    }
  });
}
