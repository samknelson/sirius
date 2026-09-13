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
const LEGACY_SMS_CONFIG = "service_config:sms";
const TWILIO_SECRET_NAME = "TWILIO_AUTH_TOKEN";

registerEnvironmentVariables([
  {
    name: "TWILIO_ACCOUNT_SID",
    description: "Legacy Twilio account SID migrated into SMS wc-vendor configuration.",
    secret: false,
    category: "core",
    changeTakesEffect: "restart",
  },
  {
    name: "TWILIO_PHONE_NUMBER",
    description: "Legacy Twilio sending number migrated into SMS wc-vendor configuration.",
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

type LegacyProvider = {
  enabled?: boolean;
  settings?: Record<string, unknown>;
};

type LegacySmsConfig = {
  defaultProvider?: string;
  providers?: Record<string, LegacyProvider>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerSettings(legacy: LegacySmsConfig, id: string): Record<string, unknown> {
  const provider = legacy.providers?.[id] ??
    (id === LOCAL_PLUGIN ? legacy.providers?.local : undefined);
  return asRecord(provider?.settings);
}

function firstString(settings: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    if (typeof settings[name] === "string" && settings[name].trim()) {
      return settings[name] as string;
    }
  }
  return undefined;
}

/**
 * Legacy settings may contain a token copied by an old admin endpoint. Never
 * carry credential values into plugin config; the only credential migration is
 * the well-known secret NAME.
 */
function withoutCredentialValues(settings: Record<string, unknown>): Record<string, unknown> {
  const result = { ...settings };
  for (const key of Object.keys(result)) {
    if (/token|secret|password|api.?key|auth/i.test(key)) delete result[key];
  }
  return result;
}

function legacyData(legacy: LegacySmsConfig, id: string): Record<string, unknown> {
  const settings = providerSettings(legacy, id);
  const data = withoutCredentialValues(settings);
  const phoneValidation = asRecord(settings.phoneValidation);
  if (Object.keys(phoneValidation).length > 0) data.phoneValidation = phoneValidation;

  if (id === TWILIO_PLUGIN) {
    const accountSid = firstString(settings, [
      "accountSid",
      "account_sid",
      "accountSID",
    ]);
    const fromNumber = firstString(settings, [
      "fromNumber",
      "from_number",
      "phoneNumber",
      "phone_number",
      "defaultFromNumber",
      "defaultPhoneNumber",
    ]);
    if (accountSid) data.accountSid = accountSid;
    if (fromNumber) data.fromNumber = fromNumber;
    data.secretName = TWILIO_SECRET_NAME;
  }
  return data;
}

function selectedPlugin(legacy: LegacySmsConfig): string {
  return legacy.defaultProvider === TWILIO_PLUGIN
    ? TWILIO_PLUGIN
    : LOCAL_PLUGIN;
}

async function readLegacySmsConfig(): Promise<LegacySmsConfig> {
  const { storage } = await import("../../storage");
  const variable = await storage.variables.getByName(LEGACY_SMS_CONFIG);
  return asRecord(variable?.value) as LegacySmsConfig;
}

/**
 * Older deployments could have only the environment credentials and no
 * service_config:sms variable. Read the non-secret values so those sites get
 * a usable wc-vendor row. Deliberately do not call getEnvironmentVariable for
 * TWILIO_AUTH_TOKEN: its value must never enter migration data or logs.
 */
function readEnvironmentLegacySmsConfig(): LegacySmsConfig {
  const accountSid = getEnvironmentVariable("TWILIO_ACCOUNT_SID");
  const fromNumber = getEnvironmentVariable("TWILIO_PHONE_NUMBER");
  if (!accountSid && !fromNumber) return {};
  return {
    defaultProvider: TWILIO_PLUGIN,
    providers: {
      [TWILIO_PLUGIN]: {
        settings: {
          ...(accountSid ? { accountSid } : {}),
          ...(fromNumber ? { fromNumber } : {}),
        },
      },
    },
  };
}

function mergeEnvironmentLegacySmsConfig(legacy: LegacySmsConfig): LegacySmsConfig {
  const environment = readEnvironmentLegacySmsConfig();
  const environmentSettings = providerSettings(environment, TWILIO_PLUGIN);
  if (Object.keys(environmentSettings).length === 0) return legacy;

  const storedProvider = legacy.providers?.[TWILIO_PLUGIN] ?? {};
  const storedSettings = providerSettings(legacy, TWILIO_PLUGIN);
  const storedAccountSid = firstString(storedSettings, [
    "accountSid",
    "account_sid",
    "accountSID",
  ]);
  const storedFromNumber = firstString(storedSettings, [
    "fromNumber",
    "from_number",
    "phoneNumber",
    "phone_number",
    "defaultFromNumber",
    "defaultPhoneNumber",
  ]);
  const mergedSettings = {
    ...environmentSettings,
    ...storedSettings,
  };
  if (storedAccountSid) mergedSettings.accountSid = storedAccountSid;
  if (storedFromNumber) mergedSettings.fromNumber = storedFromNumber;
  return {
    ...environment,
    ...legacy,
    providers: {
      ...environment.providers,
      ...legacy.providers,
      [TWILIO_PLUGIN]: {
        ...storedProvider,
        // Stored settings win over environment defaults, including the
        // legacy defaultFromNumber alias handled by legacyData below.
        settings: mergedSettings,
      },
    },
  };
}

async function withSmsMigrationLock<T>(callback: () => Promise<T>): Promise<T> {
  const { runInTransaction, getClient } = await import("../../storage/transaction-context");
  const { withFrameworkWrite } = await import("../../middleware/request-context");
  return withFrameworkWrite(() =>
    runInTransaction(async () => {
      // pg_advisory_xact_lock is released automatically on commit/rollback.
      await getClient().execute(
        sql`select pg_advisory_xact_lock(hashtext('wc-vendors:sms-migration'))`,
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
  return withSmsMigrationLock(async () => {
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

function stringDataValue(data: unknown, key: string): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function repairedTwilioData(
  config: PluginConfig,
  migratedData: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const currentData =
    config.data && typeof config.data === "object"
      ? config.data as Record<string, unknown>
      : {};
  const nextData = { ...currentData };
  const currentAccountSid = stringDataValue(currentData, "accountSid");
  const currentFromNumber = stringDataValue(currentData, "fromNumber");
  const migratedAccountSid = stringDataValue(migratedData, "accountSid");
  const migratedFromNumber = stringDataValue(migratedData, "fromNumber");
  if (!currentAccountSid && migratedAccountSid) nextData.accountSid = migratedAccountSid;
  if (!currentFromNumber && migratedFromNumber) nextData.fromNumber = migratedFromNumber;

  // Do not preserve credential values if an incomplete row was written by an
  // older migration. The plugin stores only a named secret reference.
  for (const key of Object.keys(nextData)) {
    if (key !== "secretName" && /token|secret|password|api.?key|auth/i.test(key)) {
      delete nextData[key];
    }
  }
  nextData.secretName =
    typeof currentData.secretName === "string" && currentData.secretName.trim()
      ? currentData.secretName
      : TWILIO_SECRET_NAME;

  return nextData.accountSid !== currentData.accountSid ||
    nextData.fromNumber !== currentData.fromNumber ||
    nextData.secretName !== currentData.secretName ||
    Object.keys(nextData).length !== Object.keys(currentData).length
    ? nextData
    : undefined;
}

/**
 * Copy the old SMS category into durable wc-vendor rows. The transaction
 * advisory lock serializes first boot across app instances; the unique
 * re-read makes retries and a concurrent administrator selection harmless.
 */
export async function ensureSmsVendorConfig(): Promise<PluginConfig> {
  const { storage } = await import("../../storage");
  const configuredLegacy = await readLegacySmsConfig();
  const legacy = mergeEnvironmentLegacySmsConfig(configuredLegacy);
  const existing = (await storage.pluginConfigs.getByKind(SMS_KIND)).filter(
    (config) => config.pluginId === TWILIO_PLUGIN || config.pluginId === LOCAL_PLUGIN,
  );
  const enabled = existing.filter((config) => config.enabled);
  if (enabled.length === 1) {
    const selected = enabled[0];
    if (selected.pluginId !== TWILIO_PLUGIN) return selected;

    const migratedData = legacyData(legacy, TWILIO_PLUGIN);
    const repairedData = repairedTwilioData(selected, migratedData);
    if (!repairedData) return selected;

    return withSmsMigrationLock(async () => {
      const currentConfigs = (await storage.pluginConfigs.getByKind(SMS_KIND)).filter(
        (config) => config.pluginId === TWILIO_PLUGIN || config.pluginId === LOCAL_PLUGIN,
      );
      const currentSelected = currentConfigs.find((config) => config.enabled);
      if (!currentSelected || currentSelected.pluginId !== TWILIO_PLUGIN) {
        return currentSelected ?? selected;
      }
      const currentData = repairedTwilioData(
        currentSelected,
        legacyData(legacy, TWILIO_PLUGIN),
      );
      if (!currentData) return currentSelected;
      return (await storage.pluginConfigs.update(currentSelected.id, {
        data: currentData,
      })) ?? currentSelected;
    });
  }
  if (existing.length > 0) {
    throw new SmsVendorConfigurationError(
      "SMS vendor configuration is missing a single enabled Twilio or local connection.",
    );
  }

  if (!legacy.defaultProvider && !legacy.providers) {
    throw new SmsVendorConfigurationError(
      "No SMS wc-vendor configuration exists and no legacy SMS configuration is available.",
    );
  }

  return withSmsMigrationLock(async () => {
      const afterLock = (await storage.pluginConfigs.getByKind(SMS_KIND)).filter(
        (config) => config.pluginId === TWILIO_PLUGIN || config.pluginId === LOCAL_PLUGIN,
      );
      const activeAfterLock = afterLock.find((config) => config.enabled);
      if (activeAfterLock) return activeAfterLock;
      if (afterLock.length > 0) {
        throw new SmsVendorConfigurationError(
          "SMS vendor configuration is missing a single enabled connection.",
        );
      }

      const selected = selectedPlugin(legacy);
      const rows: PluginConfig[] = [];
      for (const pluginId of [TWILIO_PLUGIN, LOCAL_PLUGIN]) {
        const row = await storage.pluginConfigs.create({
          pluginKind: SMS_KIND,
          pluginId,
          enabled: pluginId === selected,
          name: pluginId === TWILIO_PLUGIN ? "Twilio SMS" : "Local SMS",
          ordering: 0,
          data: legacyData(legacy, pluginId),
        });
        await storage.pluginConfigs.upsertSubsidiary(SMS_KIND, { id: row.id });
        rows.push(row);
      }
      return rows.find((row) => row.enabled)!;
    });
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