import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import type { PostalAddress } from "../services/comm/providers/postal";
import { verifyPostalAddress } from "../services/comm/validators/address-verification";
import {
  getPostalVendorConfig,
  postalRequest,
  postalSupportsOperation,
  resolvePostalPluginId,
  resolvePostalVendorTarget,
  setPostalVendor,
  type PostalPluginId,
} from "../services/comm/postal-vendor";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";
import { requireAccess } from "../services/access-policy-evaluator";

const addressSchema = z.object({
  name: z.string().optional(),
  company: z.string().optional(),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().default("US"),
});

const postalPluginInfo = [
  {
    id: "lob",
    displayName: "Lob",
    supportedFeatures: [
      "address_verification",
      "letter_sending",
      "tracking",
      "certified_mail",
      "registered_mail",
      "color_printing",
      "double_sided",
    ],
  },
  {
    id: "local-postal",
    displayName: "Local (Testing Only)",
    supportedFeatures: ["address_verification"],
  },
];

function configData(config: { data?: unknown } | undefined): Record<string, unknown> {
  return config?.data && typeof config.data === "object"
    ? (config.data as Record<string, unknown>)
    : {};
}

async function updatePostalConfig(
  pluginId: PostalPluginId,
  patch: Record<string, unknown>,
): Promise<void> {
  const config = await getPostalVendorConfig(pluginId);
  if (!config) {
    throw new Error(`No enabled '${pluginId}' postal vendor configuration exists`);
  }
  await storage.pluginConfigs.update(config.id, {
    data: { ...configData(config), ...patch },
  });
}

export function registerPostalConfigRoutes(app: Express) {
  const admin = requireAccess("admin");
  app.get("/api/config/postal", admin, async (_req: Request, res: Response) => {
    try {
      const pluginId = await resolvePostalPluginId();
      const config = await getPostalVendorConfig(pluginId);
      const target = config ? { configId: config.id } : await resolvePostalVendorTarget();
      const connection = await postalRequest(target, "test-connection", undefined);
      const supportsPostal = await postalSupportsOperation(target, "send-letter");
      const data = configData(config);
      res.json({
        defaultProvider: pluginId,
        providers: postalPluginInfo,
        currentProvider: {
          id: pluginId,
          displayName: postalPluginInfo.find((p) => p.id === pluginId)?.displayName ?? pluginId,
          supportedFeatures: postalPluginInfo.find((p) => p.id === pluginId)?.supportedFeatures ?? [],
           supportsPostal,
          config: {
            defaultReturnAddress: data.defaultReturnAddress,
            hasApiKey: pluginId === "lob" ? Boolean(config?.data && (data.secretName || false)) : false,
          },
          connection: {
            success: connection.connected,
            message: connection.connected
              ? `Successfully connected to ${pluginId === "lob" ? "Lob" : "local postal provider"}`
              : undefined,
            error: connection.error?.message,
            details: connection,
          },
        },
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ message: "Failed to get postal configuration", error: error?.message });
    }
  });

  app.post("/api/config/postal/test", admin, async (_req: Request, res: Response) => {
    try {
      const pluginId = await resolvePostalPluginId();
      const target = await resolvePostalVendorTarget();
      const result = await postalRequest(target, "test-connection", undefined);
      if (!result.connected) {
        return res.status(500).json({
          success: false,
          error: result.error?.message,
          details: result,
        });
      }
      res.json({
        success: true,
        message: `Successfully connected to ${pluginId === "lob" ? "Lob" : "local postal provider"}`,
        details: result,
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ success: false, error: error?.message || "Failed to connect to postal provider" });
    }
  });

  app.put("/api/config/postal/provider", admin, async (req: Request, res: Response) => {
    try {
       const { providerId, targetConfigId } = z.object({
         providerId: z.enum(["lob", "local-postal"]).optional(),
         targetConfigId: z.string().min(1).optional(),
      }).parse(req.body);
       if (!providerId && !targetConfigId) {
         return res.status(400).json({
           message: "Either providerId or targetConfigId is required",
         });
       }
       const selected = await setPostalVendor(providerId, targetConfigId);
       res.json({ success: true, defaultProvider: selected.pluginId, configId: selected.id });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update postal provider", error: error?.message });
    }
  });

  app.get("/api/config/postal/return-address", admin, async (_req: Request, res: Response) => {
    try {
      const pluginId = await resolvePostalPluginId();
      const target = await resolvePostalVendorTarget();
      const returnAddress = await postalRequest(target, "get-default-return-address", undefined);
      res.json({ returnAddress });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ message: "Failed to get default return address", error: error?.message });
    }
  });

  app.put("/api/config/postal/return-address", admin, async (req: Request, res: Response) => {
    try {
      const address = addressSchema.parse(req.body) as PostalAddress;
      const pluginId = await resolvePostalPluginId();
      await updatePostalConfig(pluginId, { defaultReturnAddress: address });
      res.json({ success: true, returnAddress: address });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update default return address", error: error?.message });
    }
  });

  app.get("/api/config/lob", admin, async (_req: Request, res: Response) => {
    try {
      const config = await getPostalVendorConfig("lob");
      if (!config) {
        return res.json({ connected: false, error: "Lob is not configured", currentProvider: await resolvePostalPluginId() });
      }
      const data = configData(config);
      const connection = await postalRequest({ configId: config.id }, "test-connection", undefined);
      res.json({
        connected: connection.connected,
        apiKeyConfigured: Boolean(data.secretName),
        isTestMode: connection.testMode || false,
        returnAddress: data.defaultReturnAddress,
        error: connection.error?.message,
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ message: "Failed to get Lob configuration", error: error?.message });
    }
  });

  app.post("/api/config/lob/test", admin, async (_req: Request, res: Response) => {
    try {
      const result = await postalRequest("lob", "test-connection", undefined);
      res.json({
        success: result.connected,
        message: result.connected ? "Successfully connected to Lob API" : undefined,
        error: result.error?.message,
        details: result,
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.json({ success: false, error: error?.message || "Failed to connect to Lob" });
    }
  });

  app.post("/api/config/postal/verify-test-address", admin, async (req: Request, res: Response) => {
    try {
      const address = addressSchema.parse(req.body);
      const pluginId = await resolvePostalPluginId();
      const config = await getPostalVendorConfig(pluginId);
      if (!config) throw new Error(`No configuration exists for postal provider '${pluginId}'`);
      const result = await verifyPostalAddress({ configId: config.id }, address, { mode: "force" });
      res.json(result);
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid address", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to verify address", error: error?.message });
    }
  });
}
