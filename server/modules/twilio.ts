import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAccess } from "../services/access-policy-evaluator";
import { z } from "zod";
import { storage } from "../storage";
import { sendIfMaintenanceRefusal } from "../services/maintenance-flag";
import { wcRequest } from "../services/webclient";
import {
  ensureSmsVendorConfig,
  ensureSmsVendorTarget,
  getSmsVendorConfigs,
  resolveSmsVendor,
  SmsVendorConfigurationError,
} from "../services/comm/sms-vendor";
import type { GatewayConnectionTest } from "../plugins/wc-vendors/types";

const SMS_PROVIDERS = [
  {
    id: "twilio",
    displayName: "Twilio SMS",
    supportedFeatures: ["sms", "phone-validation", "phone-lookup", "delivery-status"],
  },
  {
    id: "sms-local",
    displayName: "Local SMS",
    supportedFeatures: ["phone-validation"],
  },
] as const;

type LegacyConnectionResult = {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
};

function connectionResult(result: GatewayConnectionTest): LegacyConnectionResult {
  return {
    success: result.connected,
    message: result.connected ? "SMS provider connected" : undefined,
    error: result.error?.message,
    details: result.account
      ? {
          accountSid: result.account.id,
          accountName: result.account.email,
          status: result.account.type,
        }
      : undefined,
  };
}

async function testSmsVendor(vendor: Awaited<ReturnType<typeof resolveSmsVendor>>) {
  const result = await wcRequest({
    vendor: vendor.target,
    operation: "test-connection",
    args: undefined,
  });
  return connectionResult(
    result.value ?? {
      connected: false,
      error: { message: result.error || "SMS provider did not answer" },
    },
  );
}

async function readTwilioConfiguration(
  vendor: Awaited<ReturnType<typeof resolveSmsVendor>>,
): Promise<Record<string, unknown>> {
  if (vendor.pluginId !== "twilio") return {};
  const result = await wcRequest({
    vendor: vendor.target,
    operation: "read-configuration",
    args: undefined,
  });
  return result.value ?? {
    connected: false,
    error: result.error || "Failed to get Twilio configuration",
  };
}

async function updateSelectedProvider(providerId: string): Promise<void> {
  const selected = providerId === "local" ? "sms-local" : providerId;
  if (selected !== "twilio" && selected !== "sms-local") {
    throw new Error(`Provider '${providerId}' is not registered for SMS`);
  }

  try {
    await ensureSmsVendorConfig();
  } catch (error) {
    // A target may be the only remaining row after an older cleanup. Let the
    // target-first path below create the requested row rather than disabling
    // that last row or returning success with no enabled provider.
    if (!(error instanceof SmsVendorConfigurationError)) throw error;
  }
  // Create/validate the destination before entering the switch transaction.
  // If credentials are unavailable, the current provider remains enabled.
  const target = await ensureSmsVendorTarget(selected);
  const { runInTransaction, getClient } = await import("../storage/transaction-context");
  await runInTransaction(async () => {
    await getClient().execute(
      sql`select pg_advisory_xact_lock(hashtext('wc-vendors:sms-selection'))`,
    );
    const configs = await Promise.all(
      ["twilio", "sms-local"].map(async (pluginId) => ({
        pluginId,
        configs: await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", pluginId),
      })),
    );
    const matching = configs.flatMap(({ pluginId, configs: rows }) =>
      rows.map((config) => ({ pluginId, config })),
    );
    if (matching.length === 0) {
      throw new Error("No SMS wc-vendor configuration exists");
    }
    for (const { config } of matching) {
      await storage.pluginConfigs.update(config.id, {
        enabled: config.id === target.id,
      });
    }
  });
}

async function updateTwilioFromNumber(phoneNumber: string): Promise<void> {
  const vendor = await resolveSmsVendor();
  if (vendor.pluginId !== "twilio" || !("configId" in vendor.target)) {
    throw new Error("Twilio is not the active SMS vendor");
  }
  const configId = vendor.target.configId;
  if (!configId) throw new Error("Twilio vendor configuration not found");
  const config = await storage.pluginConfigs.get(configId);
  if (!config) throw new Error("Twilio vendor configuration not found");
  const data =
    config.data && typeof config.data === "object"
      ? (config.data as Record<string, unknown>)
      : {};
  await storage.pluginConfigs.update(config.id, {
    data: { ...data, fromNumber: phoneNumber },
  });
}

async function getDefaultFromNumber(): Promise<string | undefined> {
  const vendor = await resolveSmsVendor();
  if (vendor.pluginId !== "twilio") return undefined;
  const configuration = await readTwilioConfiguration(vendor);
  return typeof configuration.defaultFromNumber === "string"
    ? configuration.defaultFromNumber
    : undefined;
}

function sendConnection(res: Response, result: LegacyConnectionResult): void {
  res.json(result);
}

export function registerTwilioRoutes(app: Express) {
  app.get("/api/config/sms", requireAccess("admin"), async (_req, res) => {
    try {
      const configs = await getSmsVendorConfigs();
      const enabled = configs.filter((config) => config.enabled);
      if (enabled.length > 1) {
        throw new SmsVendorConfigurationError(
          `Multiple enabled SMS wc-vendor configurations found (${enabled
            .map((config) => config.id)
            .join(", ")}).`,
        );
      }
      const config = enabled[0];
      if (!config) {
        return res.json({
          defaultProvider: null,
          providers: SMS_PROVIDERS,
          currentProvider: null,
        });
      }
      const vendor = {
        target: { configId: config.id },
        pluginId: config.pluginId as "twilio" | "sms-local",
        config,
      };
      const connection = await testSmsVendor(vendor);
      const configuration =
        vendor.pluginId === "twilio" ? await readTwilioConfiguration(vendor) : {
          connected: true,
          provider: "sms-local",
          capabilities: ["phone-validation"],
        };
      const provider = SMS_PROVIDERS.find((entry) => entry.id === vendor.pluginId)!;
      res.json({
        defaultProvider: vendor.pluginId,
        providers: SMS_PROVIDERS,
        currentProvider: {
          ...provider,
          supportsSms: vendor.pluginId === "twilio",
          config: configuration,
          connection,
        },
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({
        message: "Failed to get SMS configuration",
        error: error?.message,
      });
    }
  });

  app.post("/api/config/sms/test", requireAccess("admin"), async (_req, res) => {
    try {
      sendConnection(res, await testSmsVendor(await resolveSmsVendor()));
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      sendConnection(res, {
        success: false,
        error: error?.message || "Failed to connect to SMS provider",
      });
    }
  });

  app.put("/api/config/sms/provider", requireAccess("admin"), async (req, res) => {
    try {
      const { providerId } = z.object({ providerId: z.string().min(1) }).parse(req.body);
      await updateSelectedProvider(providerId);
      res.json({ success: true, defaultProvider: providerId });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      if (error instanceof SmsVendorConfigurationError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({
        message: "Failed to update SMS provider",
        error: error?.message,
      });
    }
  });

  async function listPhoneNumbers(res: Response, errorMessage: string): Promise<void> {
    try {
      const vendor = await resolveSmsVendor();
      if (vendor.pluginId !== "twilio") {
        res.json([]);
        return;
      }
      const result = await wcRequest({
        vendor: vendor.target,
        operation: "list-phone-numbers",
        args: undefined,
      });
      if (result.value) {
        res.json(result.value);
        return;
      }
      res.status(500).json({ message: errorMessage, error: result.error });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({ message: errorMessage, error: error?.message });
    }
  }

  app.get("/api/config/sms/phone-numbers", requireAccess("admin"), async (_req, res) => {
    await listPhoneNumbers(res, "Failed to fetch phone numbers");
  });

  app.put("/api/config/sms/default-phone", requireAccess("admin"), async (req, res) => {
    try {
      const { phoneNumber } = z.object({ phoneNumber: z.string().min(1) }).parse(req.body);
      await updateTwilioFromNumber(phoneNumber);
      res.json({ success: true, defaultPhoneNumber: phoneNumber });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      res.status(500).json({
        message: "Failed to update default phone number",
        error: error?.message,
      });
    }
  });

  app.get("/api/config/sms/default-phone", requireAccess("admin"), async (_req, res) => {
    try {
      res.json({ defaultPhoneNumber: await getDefaultFromNumber() });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({
        message: "Failed to get default phone number",
        error: error?.message,
      });
    }
  });

  app.get("/api/config/twilio", requireAccess("admin"), async (_req, res) => {
    try {
      const vendor = await resolveSmsVendor();
      if (vendor.pluginId !== "twilio") {
        return res.json({
          connected: false,
          error: "Twilio is not the active SMS provider",
          currentProvider: vendor.pluginId,
        });
      }
      const configuration = await readTwilioConfiguration(vendor);
      res.json({
        connected: configuration.connected || false,
        accountSid: configuration.accountSid,
        accountName: configuration.accountName,
        configuredPhoneNumber: configuration.configuredPhoneNumber,
        defaultPhoneNumber: configuration.defaultFromNumber,
        error: configuration.error,
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({
        message: "Failed to get Twilio configuration",
        error: error?.message,
      });
    }
  });

  app.post("/api/config/twilio/test", requireAccess("admin"), async (_req, res) => {
    try {
      const vendor = await resolveSmsVendor();
      if (vendor.pluginId !== "twilio") {
        return res.json({ success: false, error: "Twilio is not the active SMS provider" });
      }
      const result = await testSmsVendor(vendor);
      res.json({
        success: result.success,
        accountSid: result.details?.accountSid,
        accountName: result.details?.accountName,
        status: result.details?.status,
        error: result.error,
      });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.json({
        success: false,
        error: error?.message || "Failed to connect to Twilio",
      });
    }
  });

  app.get("/api/config/twilio/phone-numbers", requireAccess("admin"), async (_req, res) => {
    await listPhoneNumbers(res, "Failed to fetch phone numbers from Twilio");
  });

  app.put("/api/config/twilio/default-phone", requireAccess("admin"), async (req, res) => {
    try {
      const { phoneNumber } = z.object({ phoneNumber: z.string().min(1) }).parse(req.body);
      await updateTwilioFromNumber(phoneNumber);
      res.json({ success: true, defaultPhoneNumber: phoneNumber });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request", errors: error.errors });
      }
      res.status(500).json({
        message: "Failed to update default phone number",
        error: error?.message,
      });
    }
  });

  app.get("/api/config/twilio/default-phone", requireAccess("admin"), async (_req, res) => {
    try {
      res.json({ defaultPhoneNumber: await getDefaultFromNumber() });
    } catch (error: any) {
      if (sendIfMaintenanceRefusal(res, error)) return;
      res.status(500).json({
        message: "Failed to get default phone number",
        error: error?.message,
      });
    }
  });
}