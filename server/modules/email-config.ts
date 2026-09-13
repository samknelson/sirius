import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAccess } from "../services/access-policy-evaluator";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";
import { storage } from "../storage";
import { wcRequest } from "../services/webclient";
import {
  emailVendorTarget,
  ensureEmailVendorConfig,
  getEmailVendorConfigs,
  setEmailVendor,
} from "../services/comm/email-vendor";
import {
  LEGACY_LOCAL_EMAIL_PLUGIN_ID,
  LOCAL_EMAIL_PLUGIN_ID,
  SENDGRID_EMAIL_PLUGIN_ID,
} from "../plugins/wc-vendors/plugins/email";
import { getWcVendorPlugin } from "../plugins/wc-vendors";

function providerId(pluginId: string): string {
  return pluginId === LOCAL_EMAIL_PLUGIN_ID ||
    pluginId === LEGACY_LOCAL_EMAIL_PLUGIN_ID
    ? "local"
    : pluginId;
}

async function vendorInfo(config: Awaited<ReturnType<typeof ensureEmailVendorConfig>>) {
  const target = emailVendorTarget(config);
  const plugin = getWcVendorPlugin(config.pluginId);
  const [connection, configuration] = await Promise.all([
    wcRequest({ vendor: target, operation: "test-email-connection", args: undefined }),
    wcRequest({ vendor: target, operation: "get-email-configuration", args: undefined }),
  ]);
  return {
    id: providerId(config.pluginId),
    pluginId: config.pluginId,
    displayName: plugin?.name ?? config.pluginId,
    supportedFeatures:
      config.pluginId === SENDGRID_EMAIL_PLUGIN_ID
        ? ["email", "email-validation", "delivery-status"]
        : ["email-validation"],
    supportsEmail: config.pluginId === SENDGRID_EMAIL_PLUGIN_ID,
    config: configuration.value ?? {
      connected: false,
      error: configuration.error,
    },
    connection: connection.value ?? {
      success: false,
      error: connection.error,
    },
  };
}

export function registerEmailConfigRoutes(app: Express) {
  app.get(
    "/api/config/email",
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const configs = await getEmailVendorConfigs();
        const enabled = configs.filter((config) => config.enabled);
        if (enabled.length > 1) {
          throw new Error(
            `Multiple enabled email vendor configurations found (${enabled
              .map((config) => config.id)
              .join(", ")}). Select a target config ID.`,
          );
        }
        const active = enabled[0];
        const currentProvider = active ? await vendorInfo(active) : null;
        const providers = [
          { id: "sendgrid", displayName: "SendGrid Email", supportedFeatures: ["email", "email-validation", "delivery-status"] },
          { id: "local", displayName: "Local Email", supportedFeatures: ["email-validation"] },
        ];
        res.json({
          defaultProvider: active ? providerId(active.pluginId) : null,
          providers,
          currentProvider,
          configuredVendors: configs.map((config) => ({
            id: config.id,
            pluginId: providerId(config.pluginId),
            enabled: config.enabled,
            name: config.name,
          })),
        });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          message: "Failed to get email configuration",
          error: error?.message,
        });
      }
    },
  );

  app.post(
    "/api/config/email/test",
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const config = await ensureEmailVendorConfig();
        const result = await wcRequest({
          vendor: emailVendorTarget(config),
          operation: "test-email-connection",
          args: undefined,
        });
        if (!result.value) {
          return res.status(500).json({
            success: false,
            error: result.error || "Failed to connect to email provider",
          });
        }
        res.json(result.value);
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          success: false,
          error: error?.message || "Failed to connect to email provider",
        });
      }
    },
  );

  app.put(
    "/api/config/email/provider",
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          providerId: z.string().min(1).optional(),
          configId: z.string().min(1).optional(),
        }).refine(
          (value) => value.providerId || value.configId,
          "Either providerId or configId is required",
        );
        const parsed = schema.parse(req.body);
        const selected = await setEmailVendor(
          parsed.providerId === "local"
            ? LOCAL_EMAIL_PLUGIN_ID
            : parsed.providerId,
          parsed.configId,
        );
        res.json({
          success: true,
          defaultProvider: providerId(selected.pluginId),
        });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({
          message: "Failed to update email provider",
          error: error?.message,
        });
      }
    },
  );

  app.get(
    "/api/config/email/default-from",
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const config = await ensureEmailVendorConfig();
        const result = await wcRequest({
          vendor: emailVendorTarget(config),
          operation: "get-default-from",
          args: undefined,
        });
        res.json({
          defaultFromEmail: result.value?.email,
          defaultFromName: result.value?.name,
        });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          message: "Failed to get default from address",
          error: error?.message,
        });
      }
    },
  );

  app.put(
    "/api/config/email/default-from",
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const schema = z.object({
          email: z.string().email(),
          name: z.string().optional(),
        });
        const { email, name } = schema.parse(req.body);
        const config = await ensureEmailVendorConfig();
        const data = (config.data ?? {}) as Record<string, unknown>;
        await storage.pluginConfigs.update(config.id, {
          data: {
            ...data,
            defaultFromEmail: email,
            defaultFromName: name || undefined,
          },
        });
        res.json({
          success: true,
          defaultFromEmail: email,
          defaultFromName: name,
        });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid request", errors: error.errors });
        }
        res.status(500).json({
          message: "Failed to update default from address",
          error: error?.message,
        });
      }
    },
  );

  app.get(
    "/api/config/sendgrid",
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const configs = await getEmailVendorConfigs();
        const config = configs.find((entry) => entry.pluginId === SENDGRID_EMAIL_PLUGIN_ID);
        if (!config) {
          const active = configs.find((entry) => entry.enabled);
          return res.json({
            connected: false,
            error: "SendGrid is not configured",
            currentProvider: active ? providerId(active.pluginId) : undefined,
          });
        }
        const result = await wcRequest({
          vendor: emailVendorTarget(config),
          operation: "get-email-configuration",
          args: undefined,
        });
        res.json(result.value ?? { connected: false, error: result.error });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.status(500).json({
          message: "Failed to get SendGrid configuration",
          error: error?.message,
        });
      }
    },
  );

  app.post(
    "/api/config/sendgrid/test",
    requireAccess("admin"),
    async (_req: Request, res: Response) => {
      try {
        const configs = await getEmailVendorConfigs();
        const config = configs.find(
          (entry) => entry.pluginId === SENDGRID_EMAIL_PLUGIN_ID && entry.enabled,
        );
        if (!config) {
          return res.json({
            success: false,
            error: "SendGrid is not the active email provider",
          });
        }
        const result = await wcRequest({
          vendor: emailVendorTarget(config),
          operation: "test-email-connection",
          args: undefined,
        });
        res.json(result.value ?? { success: false, error: result.error });
      } catch (error: any) {
        if (sendIfMaintenanceRefusal(res, error)) return;
        res.json({
          success: false,
          error: error?.message || "Failed to connect to SendGrid",
        });
      }
    },
  );
}