import { storage } from "../../storage";
import type { PluginConfig } from "@shared/schema";
import {
  LEGACY_LOCAL_EMAIL_PLUGIN_ID,
  LOCAL_EMAIL_PLUGIN_ID,
  SENDGRID_EMAIL_PLUGIN_ID,
} from "../../plugins/wc-vendors/plugins/email";
import type { WcVendorTarget } from "../webclient";
import {
  getEnvironmentVariable,
} from "../../config/env-registry";

const EMAIL_VENDOR_LOCK = "wc-vendors:email-selection";

type LegacyEmailConfig = {
  defaultProvider?: string;
  providers?: Record<string, { settings?: Record<string, unknown> }>;
};

function isEmailPlugin(config: PluginConfig): boolean {
  return (
    config.pluginKind === "wc-vendors" &&
    (config.pluginId === SENDGRID_EMAIL_PLUGIN_ID ||
      config.pluginId === LOCAL_EMAIL_PLUGIN_ID ||
      config.pluginId === LEGACY_LOCAL_EMAIL_PLUGIN_ID)
  );
}

function isLocalEmailPluginId(pluginId: string): boolean {
  return (
    pluginId === LOCAL_EMAIL_PLUGIN_ID ||
    pluginId === LEGACY_LOCAL_EMAIL_PLUGIN_ID
  );
}

function normalizeEmailPluginId(pluginId: string): string {
  return isLocalEmailPluginId(pluginId)
    ? LOCAL_EMAIL_PLUGIN_ID
    : pluginId;
}

async function legacyConfig(): Promise<LegacyEmailConfig> {
  const variable = await storage.variables.getByName("service_config:email");
  if (!variable?.value || typeof variable.value !== "object") return {};
  return variable.value as LegacyEmailConfig;
}

function legacySettings(
  config: LegacyEmailConfig,
  providerId: string,
): Record<string, unknown> {
  const ids = isLocalEmailPluginId(providerId)
    ? [LEGACY_LOCAL_EMAIL_PLUGIN_ID, LOCAL_EMAIL_PLUGIN_ID]
    : [providerId];
  for (const id of ids) {
    const settings = config.providers?.[id]?.settings;
    if (settings && typeof settings === "object") return settings;
  }
  return {};
}

function sendGridData(
  legacy: LegacyEmailConfig,
  existingData: Record<string, unknown> = {},
): Record<string, unknown> {
  const settings = legacySettings(legacy, SENDGRID_EMAIL_PLUGIN_ID);
  const data: Record<string, unknown> =
    existingData && typeof existingData === "object" && !Array.isArray(existingData)
      ? { ...existingData }
      : {};
  const secretName =
    typeof data.secretName === "string" && data.secretName.trim()
      ? data.secretName.trim()
      : typeof settings.secretName === "string" && settings.secretName.trim()
        ? settings.secretName.trim()
        : "SENDGRID_API_KEY";
  data.secretName = secretName;

  const fromEmail =
    typeof data.defaultFromEmail === "string" && data.defaultFromEmail.trim()
      ? data.defaultFromEmail.trim()
      : typeof settings.defaultFromEmail === "string" && settings.defaultFromEmail.trim()
        ? settings.defaultFromEmail.trim()
        : getEnvironmentVariable("SENDGRID_FROM_EMAIL")?.trim();
  const fromName =
    typeof data.defaultFromName === "string" && data.defaultFromName.trim()
      ? data.defaultFromName.trim()
      : typeof settings.defaultFromName === "string" && settings.defaultFromName.trim()
        ? settings.defaultFromName.trim()
        : getEnvironmentVariable("SENDGRID_FROM_NAME")?.trim();
  if (fromEmail) data.defaultFromEmail = fromEmail;
  if (fromName) data.defaultFromName = fromName;
  return data;
}

function usableSendGridData(config: PluginConfig): Record<string, unknown> {
  const data =
    config.data && typeof config.data === "object"
      ? (config.data as Record<string, unknown>)
      : {};
  if (typeof data.secretName !== "string" || !data.secretName.trim()) {
    throw new Error(
      `SendGrid email configuration '${config.id}' has no named secret reference.`,
    );
  }
  return data;
}

function assertAtMostOneEnabled(configs: PluginConfig[]): PluginConfig | undefined {
  const enabled = configs.filter((config) => config.enabled);
  if (enabled.length > 1) {
    throw new Error(
      `Multiple enabled email vendor configurations found (${enabled
        .map((config) => config.id)
        .join(", ")}). Disable all but one or select a target config ID.`,
    );
  }
  return enabled[0];
}

async function ensureEmailVendorConfigLocked(): Promise<PluginConfig> {
  const configs = (await storage.pluginConfigs.getByKind("wc-vendors")).filter(
    isEmailPlugin,
  );
  const enabled = assertAtMostOneEnabled(configs);
  if (enabled) return enabled;

  const legacy = await legacyConfig();
  const legacyProvider =
    legacy.defaultProvider === SENDGRID_EMAIL_PLUGIN_ID
      ? SENDGRID_EMAIL_PLUGIN_ID
      : isLocalEmailPluginId(legacy.defaultProvider ?? "")
        ? LOCAL_EMAIL_PLUGIN_ID
        : undefined;
  // Read the effective registry value only to determine presence. The value
  // may come from the deployment environment or an in-app override, but it
  // is never assigned to config, logged, or included in an error.
  const environmentSendGrid =
    legacyProvider === undefined &&
    Boolean(getEnvironmentVariable("SENDGRID_API_KEY")?.trim());
  const preferred =
    legacyProvider ??
    (environmentSendGrid ? SENDGRID_EMAIL_PLUGIN_ID : LOCAL_EMAIL_PLUGIN_ID);

  const matching = configs.filter(
    (config) => normalizeEmailPluginId(config.pluginId) === preferred,
  );
  if (matching.length > 1) {
    throw new Error(
      `Multiple disabled email vendor configurations exist for "${preferred}" ` +
        `(${matching.map((config) => config.id).join(", ")}); select a target config ID.`,
    );
  }
  const existingPreferred = matching[0];
  if (existingPreferred) {
    const update: Record<string, unknown> = { enabled: true };
    if (preferred === SENDGRID_EMAIL_PLUGIN_ID) {
      update.data = sendGridData(legacy, (existingPreferred.data ?? {}) as Record<string, unknown>);
    }
    return (
      (await storage.pluginConfigs.update(existingPreferred.id, update)) ??
      existingPreferred
    );
  }

  const settings = legacySettings(legacy, preferred);
  const data =
    preferred === SENDGRID_EMAIL_PLUGIN_ID
      ? sendGridData(legacy)
      : {
          ...(settings.defaultFromEmail
            ? { defaultFromEmail: settings.defaultFromEmail }
            : {}),
          ...(settings.defaultFromName
            ? { defaultFromName: settings.defaultFromName }
            : {}),
        };

  const created = await storage.pluginConfigs.create({
    pluginKind: "wc-vendors",
    pluginId: preferred,
    enabled: true,
    name: preferred === SENDGRID_EMAIL_PLUGIN_ID ? "SendGrid Email" : "Local Email",
    ordering: 0,
    data,
  });
  await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: created.id });
  return created;
}

/**
 * Return the configured email vendor, creating one compatibility row for
 * installations that still only have the pre-wc-vendor service setting.
 * Keeping this bridge here lets background senders work before an administrator
 * visits the new configuration page.
 */
export async function ensureEmailVendorConfig(): Promise<PluginConfig> {
  return storage.advisoryLock.withTransactionLock(
    EMAIL_VENDOR_LOCK,
    ensureEmailVendorConfigLocked,
  );
}

export async function getEmailVendorConfigs(): Promise<PluginConfig[]> {
  return (await storage.pluginConfigs.getByKind("wc-vendors")).filter(
    isEmailPlugin,
  );
}

export function emailVendorTarget(config: PluginConfig): WcVendorTarget {
  return { configId: config.id };
}

export async function setEmailVendor(
  pluginId?: string,
  targetConfigId?: string,
): Promise<PluginConfig> {
  return storage.advisoryLock.withTransactionLock(EMAIL_VENDOR_LOCK, async () => {
    const normalized = pluginId ? normalizeEmailPluginId(pluginId) : undefined;
    if (
      normalized &&
      normalized !== SENDGRID_EMAIL_PLUGIN_ID &&
      normalized !== LOCAL_EMAIL_PLUGIN_ID
    ) {
      throw new Error(`Unknown email provider '${pluginId}'`);
    }

    // An explicit target is also the recovery path when old data has more
    // than one enabled row: validate that exact row, then disable the others.
    // Without a target, migration/selection must refuse ambiguous state.
    let configs = await getEmailVendorConfigs();
    const legacy = await legacyConfig();
    if (!targetConfigId) {
      // This also performs legacy migration while holding the same lock. It
      // makes first-use migration and an administrator's provider switch
      // serialize across processes.
      await ensureEmailVendorConfigLocked();
      configs = await getEmailVendorConfigs();
      assertAtMostOneEnabled(configs);
    }

    let selected = targetConfigId
      ? configs.find((config) => config.id === targetConfigId)
      : undefined;
    if (targetConfigId && !selected) {
      throw new Error(
        `Email vendor configuration '${targetConfigId}' was not found.`,
      );
    }
    if (selected && normalized && normalizeEmailPluginId(selected.pluginId) !== normalized) {
      throw new Error(
        `Email vendor configuration '${targetConfigId}' is "${selected.pluginId}", ` +
          `not requested provider "${pluginId}".`,
      );
    }
    if (!selected) {
      if (!normalized) {
        throw new Error("An email provider or target configuration ID is required.");
      }
      const matches = configs.filter(
        (config) => normalizeEmailPluginId(config.pluginId) === normalized,
      );
      if (matches.length > 1) {
        throw new Error(
          `Multiple email vendor configurations exist for "${normalized}" ` +
            `(${matches.map((config) => config.id).join(", ")}); select a target config ID.`,
        );
      }
      selected = matches[0];
    }
    if (!selected) {
      selected = await storage.pluginConfigs.create({
        pluginKind: "wc-vendors",
        pluginId: normalized!,
        enabled: true,
        name: normalized === SENDGRID_EMAIL_PLUGIN_ID ? "SendGrid Email" : "Local Email",
        ordering: 0,
        data:
          normalized === SENDGRID_EMAIL_PLUGIN_ID
            ? sendGridData(legacy)
            : {},
      });
      await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: selected.id });
    }

    for (const config of configs) {
      if (config.id !== selected.id && config.enabled) {
        await storage.pluginConfigs.update(config.id, { enabled: false });
      }
    }
    if (!selected.enabled) {
      selected =
        (await storage.pluginConfigs.update(selected.id, { enabled: true })) ??
        selected;
    }
    if (normalizeEmailPluginId(selected.pluginId) === SENDGRID_EMAIL_PLUGIN_ID) {
      selected =
        (await storage.pluginConfigs.update(selected.id, {
          data: sendGridData(legacy, (selected.data ?? {}) as Record<string, unknown>),
        })) ?? selected;
      usableSendGridData(selected);
    }
    return selected;
  });
}