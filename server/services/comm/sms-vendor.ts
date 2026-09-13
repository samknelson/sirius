import { sql } from "drizzle-orm";
import type { PluginConfig } from "@shared/schema";
import type { WcVendorTarget } from "../webclient";
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../config/env-registry";

const SMS_KIND = "wc-vendors";
const TWILIO_PLUGIN = "twilio";
const LOCAL_PLUGIN = "sms-local";
const TWILIO_SECRET_NAME = "TWILIO_AUTH_TOKEN";

registerEnvironmentVariables([
  {
    name: "TWILIO_ACCOUNT_SID",
    description: "Twilio account SID used when configuring an SMS wc-vendor.",
    secret: false,
    category: "core",
    changeTakesEffect: "restart",
  },
  {
    name: "TWILIO_PHONE_NUMBER",
    description: "Twilio sending number used when configuring an SMS wc-vendor.",
    secret: false,
    category: "core",
    changeTakesEffect: "restart",
  },
  {
    name: TWILIO_SECRET_NAME,
    description: "Twilio SMS auth token referenced by the SMS wc-vendor configuration.",
    secret: true,
    category: "core",
    changeTakesEffect: "restart",
  },
]);

export class SmsVendorConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsVendorConfigurationError";
  }
}

export type SmsVendorPluginId = "twilio" | "sms-local";

async function withSmsSelectionLock<T>(callback: () => Promise<T>): Promise<T> {
  const { runInTransaction, getClient } = await import("../../storage/transaction-context");
  const { withFrameworkWrite } = await import("../../middleware/request-context");
  return withFrameworkWrite(() =>
    runInTransaction(async () => {
      // pg_advisory_xact_lock is released automatically on commit/rollback.
      await getClient().execute(
        sql`select pg_advisory_xact_lock(hashtext('wc-vendors:sms-selection'))`,
      );
      return callback();
    }),
  );
}

function environmentTwilioData(): Record<string, unknown> {
  const accountSid = getEnvironmentVariable("TWILIO_ACCOUNT_SID")?.trim();
  const fromNumber = getEnvironmentVariable("TWILIO_PHONE_NUMBER")?.trim();
  if (!accountSid || !fromNumber) {
    throw new SmsVendorConfigurationError(
      "Twilio SMS requires TWILIO_ACCOUNT_SID and TWILIO_PHONE_NUMBER before it can be selected.",
    );
  }
  return {
    accountSid,
    fromNumber,
    secretName: TWILIO_SECRET_NAME,
  };
}

/**
 * Ensure a requested SMS target exists before any existing target is
 * disabled. This is intentionally independently lockable so legacy endpoints
 * can preserve their response shape while making target creation durable.
 */
export async function ensureSmsVendorTarget(
  pluginId: SmsVendorPluginId,
): Promise<PluginConfig> {
  const { storage } = await import("../../storage");
  return withSmsSelectionLock(async () => {
    const configs = await storage.pluginConfigs.getByKindAndPlugin("wc-vendors", pluginId);
    let target = configs.find((config) => config.enabled) ?? configs[0];

    if (!target) {
      target = await storage.pluginConfigs.create({
        pluginKind: "wc-vendors",
        pluginId,
        enabled: false,
        name: pluginId === "twilio" ? "Twilio SMS" : "Local SMS",
        ordering: 0,
        data: pluginId === "twilio" ? environmentTwilioData() : {},
      });
      await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: target.id });
      return target;
    }

    if (pluginId !== "twilio") return target;

    const currentData =
      target.data && typeof target.data === "object"
        ? target.data as Record<string, unknown>
        : {};
    const hasAccountSid =
      typeof currentData.accountSid === "string" && currentData.accountSid.trim();
    const hasFromNumber =
      typeof currentData.fromNumber === "string" && currentData.fromNumber.trim();
    const effective = hasAccountSid && hasFromNumber
      ? {}
      : environmentTwilioData();
    const data = {
      ...currentData,
      accountSid:
        hasAccountSid
          ? currentData.accountSid
          : effective.accountSid,
      fromNumber:
        hasFromNumber
          ? currentData.fromNumber
          : effective.fromNumber,
      secretName:
        typeof currentData.secretName === "string" && currentData.secretName.trim()
          ? currentData.secretName
          : TWILIO_SECRET_NAME,
    };
    if (
      data.accountSid !== currentData.accountSid ||
      data.fromNumber !== currentData.fromNumber ||
      data.secretName !== currentData.secretName
    ) {
      target = (await storage.pluginConfigs.update(target.id, { data })) ?? target;
    }
    return target;
  });
}

/**
 * Return the single canonical SMS wc-vendor selection. Legacy service_config
 * data is intentionally no longer consulted after the migration window.
 */
export async function ensureSmsVendorConfig(): Promise<PluginConfig> {
  const { storage } = await import("../../storage");
  const existing = await getSmsVendorConfigs();
  const enabled = existing.filter((config) => config.enabled);
  if (enabled.length === 1) return enabled[0];
  throw new SmsVendorConfigurationError(
    enabled.length > 1
      ? `Multiple enabled SMS wc-vendor configurations found (${enabled.map((row) => row.id).join(", ")}).`
      : "No enabled SMS wc-vendor configuration exists.",
  );
}

export async function getSmsVendorConfigs(): Promise<PluginConfig[]> {
  const { storage } = await import("../../storage");
  return (await storage.pluginConfigs.getByKind(SMS_KIND)).filter(
    (config) => config.pluginId === TWILIO_PLUGIN || config.pluginId === LOCAL_PLUGIN,
  );
}

export async function resolveSmsVendor(): Promise<{
  target: WcVendorTarget;
  pluginId: "twilio" | "sms-local";
  config: PluginConfig;
}> {
  const config = await ensureSmsVendorConfig();
  return {
    target: { configId: config.id },
    pluginId: config.pluginId as "twilio" | "sms-local",
    config,
  };
}