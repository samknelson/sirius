import { sql, type SQL } from "drizzle-orm";

export const LEGACY_COMM_CONFIG_NAMES = [
  "service_config:sms",
  "service_config:email",
  "service_config:postal",
] as const;

export type LegacyCommConfigName = (typeof LEGACY_COMM_CONFIG_NAMES)[number];

export interface CommVendorConfigCandidate {
  id: string;
  pluginId: string;
  data: unknown;
}

export interface CommCleanupQueryExecutor {
  execute(query: SQL): Promise<{
    rows: unknown[];
    rowCount?: number | null;
  }>;
}

export interface CommCleanupEnvironment {
  getValue(name: string): string | undefined;
  isSecretPresent(name: string): boolean;
}

type MediumRule = {
  plugins: readonly string[];
  remotePlugin?: string;
  requiredRemoteFields?: readonly string[];
  localPlugin: string;
  remoteSecretName: string;
};

const RULES: Record<LegacyCommConfigName, MediumRule> = {
  "service_config:sms": {
    plugins: ["twilio", "sms-local"],
    remotePlugin: "twilio",
    requiredRemoteFields: ["accountSid", "fromNumber", "secretName"],
    localPlugin: "sms-local",
    remoteSecretName: "TWILIO_AUTH_TOKEN",
  },
  "service_config:email": {
    plugins: ["sendgrid", "local-email", "local"],
    remotePlugin: "sendgrid",
    requiredRemoteFields: ["secretName"],
    localPlugin: "local-email",
    remoteSecretName: "SENDGRID_API_KEY",
  },
  "service_config:postal": {
    plugins: ["lob", "local-postal"],
    remotePlugin: "lob",
    requiredRemoteFields: ["secretName"],
    localPlugin: "local-postal",
    remoteSecretName: "LOB_API_KEY",
  },
};

function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function assertUsableRemoteConfig(
  legacyName: LegacyCommConfigName,
  candidate: CommVendorConfigCandidate,
  rule: MediumRule,
): void {
  if (candidate.pluginId !== rule.remotePlugin) return;
  const data =
    candidate.data && typeof candidate.data === "object" && !Array.isArray(candidate.data)
      ? (candidate.data as Record<string, unknown>)
      : {};
  const missing = (rule.requiredRemoteFields ?? []).filter(
    (field) => !isNonBlankString(data[field]),
  );
  if (missing.length > 0) {
    throw new Error(
      `Cannot remove ${legacyName}: enabled ${candidate.pluginId} wc-vendor ` +
        `configuration '${candidate.id}' is incomplete (missing ${missing.join(", ")}).`,
    );
  }
  if (
    candidate.pluginId === "twilio" &&
    (!String(data.accountSid).trim().startsWith("AC") ||
      !String(data.fromNumber).trim().startsWith("+"))
  ) {
    throw new Error(
      `Cannot remove ${legacyName}: enabled Twilio wc-vendor configuration ` +
        `'${candidate.id}' has an invalid account SID or sending number.`,
    );
  }
}

/**
 * Validate every legacy row that is actually present before any is deleted.
 * Candidates must already be restricted to enabled wc-vendor rows that have a
 * matching plugin_configs_wc_vendors subsidiary row.
 */
export function validateLegacyCommConfigCleanup(
  legacyNames: readonly string[],
  candidates: readonly CommVendorConfigCandidate[],
): LegacyCommConfigName[] {
  const present = LEGACY_COMM_CONFIG_NAMES.filter((name) =>
    legacyNames.includes(name),
  );

  for (const legacyName of present) {
    const rule = RULES[legacyName];
    const matching = candidates.filter((candidate) =>
      rule.plugins.includes(candidate.pluginId),
    );
    if (matching.length !== 1) {
      const detail =
        matching.length === 0
          ? "no enabled canonical wc-vendor configuration exists"
          : `multiple enabled canonical wc-vendor configurations exist ` +
            `(${matching.map((candidate) => candidate.id).join(", ")})`;
      throw new Error(`Cannot remove ${legacyName}: ${detail}.`);
    }
    assertUsableRemoteConfig(legacyName, matching[0], rule);
  }

  return present;
}

function configData(candidate: CommVendorConfigCandidate): Record<string, unknown> {
  return candidate.data &&
    typeof candidate.data === "object" &&
    !Array.isArray(candidate.data)
    ? (candidate.data as Record<string, unknown>)
    : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(
  value: Record<string, unknown>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const result = trimmed(value[name]);
    if (result) return result;
  }
  return undefined;
}

function legacySettings(
  value: unknown,
  pluginId: string,
): Record<string, unknown> {
  const legacy = asRecord(value);
  const providers = asRecord(legacy.providers);
  const ids =
    pluginId === "local-email"
      ? ["local-email", "local"]
      : pluginId === "local-postal"
        ? ["local-postal", "local"]
        : pluginId === "sms-local"
          ? ["sms-local", "local"]
          : [pluginId];
  for (const id of ids) {
    const settings = asRecord(asRecord(providers[id]).settings);
    if (Object.keys(settings).length > 0) return settings;
  }
  return {};
}

function explicitPlugin(
  legacyName: LegacyCommConfigName,
  value: unknown,
): string | undefined {
  const selected = trimmed(asRecord(value).defaultProvider)?.toLowerCase();
  if (!selected) return undefined;
  if (legacyName === "service_config:sms") {
    return selected === "twilio" ? "twilio" : "sms-local";
  }
  if (legacyName === "service_config:email") {
    if (selected === "sendgrid") return "sendgrid";
    if (selected === "local" || selected === "local-email") return "local-email";
    return undefined;
  }
  if (selected === "lob") return "lob";
  if (selected === "local" || selected === "local-postal") return "local-postal";
  throw new Error(
    `Cannot migrate ${legacyName}: unsupported legacy provider '${selected}'.`,
  );
}

function remoteData(
  legacyName: LegacyCommConfigName,
  value: unknown,
  environment: CommCleanupEnvironment,
): Record<string, unknown> {
  const rule = RULES[legacyName];
  const settings = legacySettings(value, rule.remotePlugin!);
  const secretName =
    legacyName === "service_config:sms"
      ? rule.remoteSecretName
      : trimmed(settings.secretName) ?? rule.remoteSecretName;

  if (legacyName === "service_config:sms") {
    const accountSid =
      firstString(settings, ["accountSid", "account_sid", "accountSID"]) ??
      trimmed(environment.getValue("TWILIO_ACCOUNT_SID"));
    const fromNumber =
      firstString(settings, [
        "fromNumber",
        "from_number",
        "phoneNumber",
        "phone_number",
        "defaultFromNumber",
        "defaultPhoneNumber",
      ]) ?? trimmed(environment.getValue("TWILIO_PHONE_NUMBER"));
    const phoneValidation = asRecord(settings.phoneValidation);
    return {
      ...(accountSid ? { accountSid } : {}),
      ...(fromNumber ? { fromNumber } : {}),
      ...(Object.keys(phoneValidation).length > 0 ? { phoneValidation } : {}),
      secretName,
    };
  }

  if (legacyName === "service_config:email") {
    const defaultFromEmail =
      trimmed(settings.defaultFromEmail) ??
      trimmed(environment.getValue("SENDGRID_FROM_EMAIL"));
    const defaultFromName =
      trimmed(settings.defaultFromName) ??
      trimmed(environment.getValue("SENDGRID_FROM_NAME"));
    return {
      secretName,
      ...(defaultFromEmail ? { defaultFromEmail } : {}),
      ...(defaultFromName ? { defaultFromName } : {}),
    };
  }

  return {
    secretName,
    ...(settings.defaultReturnAddress !== undefined
      ? { defaultReturnAddress: settings.defaultReturnAddress }
      : {}),
  };
}

function localData(
  legacyName: LegacyCommConfigName,
  value: unknown,
): Record<string, unknown> {
  const settings = legacySettings(value, RULES[legacyName].localPlugin);
  if (legacyName === "service_config:email") {
    return {
      ...(trimmed(settings.defaultFromEmail)
        ? { defaultFromEmail: trimmed(settings.defaultFromEmail) }
        : {}),
      ...(trimmed(settings.defaultFromName)
        ? { defaultFromName: trimmed(settings.defaultFromName) }
        : {}),
    };
  }
  if (legacyName === "service_config:postal") {
    return settings.defaultReturnAddress !== undefined
      ? { defaultReturnAddress: settings.defaultReturnAddress }
      : {};
  }
  const phoneValidation = asRecord(settings.phoneValidation);
  return Object.keys(phoneValidation).length > 0 ? { phoneValidation } : {};
}

async function preferredPlugin(
  tx: CommCleanupQueryExecutor,
  legacyName: LegacyCommConfigName,
  value: unknown,
  environment: CommCleanupEnvironment,
): Promise<string> {
  const explicit = explicitPlugin(legacyName, value);
  if (explicit) return explicit;

  const rule = RULES[legacyName];
  const data = remoteData(legacyName, value, environment);
  const secretName = trimmed(data.secretName) ?? rule.remoteSecretName;
  const hasSecret =
    environment.isSecretPresent(secretName) ||
    (await hasStoredOverride(tx, secretName));
  const hasRequiredData = (rule.requiredRemoteFields ?? []).every(
    (field) => field === "secretName" ? hasSecret : isNonBlankString(data[field]),
  );
  return hasRequiredData ? rule.remotePlugin! : rule.localPlugin;
}

function displayName(pluginId: string): string {
  return {
    twilio: "Twilio SMS",
    "sms-local": "Local SMS",
    sendgrid: "SendGrid Email",
    "local-email": "Local Email",
    lob: "Lob Postal",
    "local-postal": "Local Postal",
  }[pluginId] ?? pluginId;
}

function normalizedPluginId(pluginId: string): string {
  return pluginId === "local" ? "local-email" : pluginId;
}

async function ensureCanonicalConfig(
  tx: CommCleanupQueryExecutor,
  legacy: LegacyValueRow,
  allConfigs: readonly ConfigRow[],
  environment: CommCleanupEnvironment,
): Promise<void> {
  const legacyName = legacy.name;
  const rule = RULES[legacyName];
  const configs = allConfigs.filter((row) => rule.plugins.includes(row.plugin_id));
  const enabled = configs.filter((row) => row.enabled);
  if (enabled.length > 0) {
    if (
      enabled.length === 1 &&
      legacyName === "service_config:sms" &&
      enabled[0].plugin_id === "twilio"
    ) {
      const current = enabled[0];
      const currentData = asRecord(current.data);
      const migrated = remoteData(legacyName, legacy.value, environment);
      const repaired = { ...currentData };
      if (!trimmed(repaired.accountSid) && trimmed(migrated.accountSid)) {
        repaired.accountSid = migrated.accountSid;
      }
      if (!trimmed(repaired.fromNumber) && trimmed(migrated.fromNumber)) {
        repaired.fromNumber = migrated.fromNumber;
      }
      // Older compatibility writers could leave raw credentials in config
      // data. The wc-vendor contract permits only a named secret reference.
      for (const key of Object.keys(repaired)) {
        if (
          key !== "secretName" &&
          /token|secret|password|api.?key|auth/i.test(key)
        ) {
          delete repaired[key];
        }
      }
      repaired.secretName =
        trimmed(currentData.secretName) ?? rule.remoteSecretName;
      if (JSON.stringify(repaired) !== JSON.stringify(currentData)) {
        await tx.execute(sql`
          UPDATE plugin_configs
          SET data = ${JSON.stringify(repaired)}::jsonb
          WHERE id = ${current.id}
        `);
      }
    }
    return;
  }

  if (legacyName === "service_config:sms") {
    // The retired SMS bridge deliberately refused to guess when any disabled
    // SMS rows already existed: an administrator must resolve that ambiguous
    // half-selection rather than migration silently enabling one.
    if (configs.length > 0) {
      throw new Error(
        `Cannot migrate ${legacyName}: SMS vendor configuration is missing ` +
          "a single enabled Twilio or Local SMS connection.",
      );
    }
    const legacyRecord = asRecord(legacy.value);
    const environmentTwilio = remoteData(legacyName, legacy.value, environment);
    const environmentCanSelectTwilio =
      isNonBlankString(environmentTwilio.accountSid) &&
      isNonBlankString(environmentTwilio.fromNumber) &&
      (environment.isSecretPresent(rule.remoteSecretName) ||
        (await hasStoredOverride(tx, rule.remoteSecretName)));
    const hasLegacySelection =
      legacyRecord.defaultProvider !== undefined ||
      legacyRecord.providers !== undefined;
    if (!hasLegacySelection && !environmentCanSelectTwilio) {
      throw new Error(
        `Cannot migrate ${legacyName}: no canonical configuration, usable ` +
          "environment Twilio configuration, or legacy SMS selection exists.",
      );
    }
    const selected =
      explicitPlugin(legacyName, legacy.value) ??
      (environmentCanSelectTwilio ? "twilio" : rule.localPlugin);
    for (const pluginId of [rule.remotePlugin!, rule.localPlugin]) {
      const data =
        pluginId === rule.remotePlugin
          ? remoteData(legacyName, legacy.value, environment)
          : localData(legacyName, legacy.value);
      await tx.execute(sql`
        INSERT INTO plugin_configs (
          id, plugin_kind, plugin_id, enabled, name, ordering, data
        )
        VALUES (
          gen_random_uuid(), 'wc-vendors', ${pluginId},
          ${pluginId === selected}, ${displayName(pluginId)}, 0,
          ${JSON.stringify(data)}::jsonb
        )
      `);
    }
    return;
  }

  let pluginId: string | undefined;
  if (legacyName === "service_config:postal") {
    const explicit = explicitPlugin(legacyName, legacy.value);
    const remoteSecretAvailable =
      environment.isSecretPresent(rule.remoteSecretName) ||
      (await hasStoredOverride(tx, rule.remoteSecretName));
    pluginId = explicit ?? (remoteSecretAvailable ? rule.remotePlugin : undefined);
    if (!pluginId) {
      if (configs.length === 1) {
        await tx.execute(sql`
          UPDATE plugin_configs SET enabled = true WHERE id = ${configs[0].id}
        `);
        return;
      }
      if (configs.length > 1) {
        throw new Error(
          `Cannot migrate ${legacyName}: no provider is selected and multiple ` +
            `disabled configurations exist (${configs.map((row) => row.id).join(", ")}).`,
        );
      }
      pluginId = rule.localPlugin;
    }
  } else {
    pluginId = await preferredPlugin(
      tx,
      legacyName,
      legacy.value,
      environment,
    );
  }
  const matching = configs.filter(
    (row) => normalizedPluginId(row.plugin_id) === normalizedPluginId(pluginId),
  );
  if (matching.length > 1) {
    throw new Error(
      `Cannot migrate ${legacyName}: multiple disabled ${pluginId} wc-vendor ` +
        `configurations exist (${matching.map((row) => row.id).join(", ")}).`,
    );
  }
  const migrationData =
    pluginId === rule.remotePlugin
      ? remoteData(legacyName, legacy.value, environment)
      : localData(legacyName, legacy.value);
  const existing = matching[0];
  if (existing) {
    const data = { ...migrationData, ...asRecord(existing.data) };
    await tx.execute(sql`
      UPDATE plugin_configs
      SET enabled = true, data = ${JSON.stringify(data)}::jsonb
      WHERE id = ${existing.id}
    `);
    return;
  }

  await tx.execute(sql`
    INSERT INTO plugin_configs (
      id, plugin_kind, plugin_id, enabled, name, ordering, data
    )
    VALUES (
      gen_random_uuid(), 'wc-vendors', ${pluginId}, true,
      ${displayName(pluginId)}, 0, ${JSON.stringify(migrationData)}::jsonb
    )
  `);
}

async function hasStoredOverride(
  tx: CommCleanupQueryExecutor,
  secretName: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    SELECT 1
    FROM variables
    WHERE name = ${`ENV_${secretName}`}
      AND jsonb_typeof(value) = 'string'
      AND value #>> '{}' NOT IN ('', '__UNSET__')
    LIMIT 1
  `);
  return result.rows.length > 0;
}

async function withStoredNonSecretOverrides(
  tx: CommCleanupQueryExecutor,
  environment: CommCleanupEnvironment,
): Promise<CommCleanupEnvironment> {
  const rows = (
    await tx.execute(sql`
      SELECT name, value #>> '{}' AS value
      FROM variables
      WHERE name IN (
        'ENV_TWILIO_ACCOUNT_SID',
        'ENV_TWILIO_PHONE_NUMBER',
        'ENV_SENDGRID_FROM_EMAIL',
        'ENV_SENDGRID_FROM_NAME'
      )
        AND jsonb_typeof(value) = 'string'
        AND value #>> '{}' NOT IN ('', '__UNSET__')
    `)
  ).rows as { name: string; value: string }[];
  const stored = new Map(
    rows.map((row) => [row.name.slice("ENV_".length), row.value]),
  );
  return {
    getValue(name) {
      // Environment wins. A stored value is used only when the deployment
      // released or never supplied the variable, matching the env registry.
      return environment.getValue(name) ?? stored.get(name);
    },
    isSecretPresent: environment.isSecretPresent,
  };
}

/**
 * Execute the cleanup against the caller's transaction.
 *
 * The environment resolver is intentionally injected: boot supplies the
 * registered environment-variable reader, while tests can prove the database
 * behavior without accessing process credentials.
 */
export async function deleteLegacyCommServiceConfigs(
  tx: CommCleanupQueryExecutor,
  environment: CommCleanupEnvironment,
): Promise<number> {
  // Coordinate with the three runtime provider selectors. SMS predates the
  // namespaced lock helper and uses the one-argument Postgres lock; match each
  // producer exactly. A fixed order makes concurrent cleanup attempts safe.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(1350::int4, hashtext('wc-vendors:email-selection')::int4)`,
  );
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(1350::int4, hashtext('wc-vendors:postal-selection')::int4)`,
  );
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('wc-vendors:sms-selection'))`,
  );

  const legacyRows = (
    await tx.execute(sql`
      SELECT name, value
      FROM variables
      WHERE name IN (
        'service_config:sms',
        'service_config:email',
        'service_config:postal'
      )
    `)
  ).rows as LegacyValueRow[];
  if (legacyRows.length === 0) return 0;
  const effectiveEnvironment = await withStoredNonSecretOverrides(
    tx,
    environment,
  );

  // Match the retired runtime bridges: preserve an existing enabled selection;
  // otherwise materialize the stored legacy choice, then a fully configured
  // remote environment choice, and only then Local. Credential values are
  // presence checks only and never enter plugin data.
  const allConfigRows = (
    await tx.execute(sql`
      SELECT id, plugin_id, enabled, data
      FROM plugin_configs
      WHERE plugin_kind = 'wc-vendors'
        AND plugin_id IN (
          'twilio',
          'sms-local',
          'sendgrid',
          'local-email',
          'local',
          'lob',
          'local-postal'
        )
    `)
  ).rows as ConfigRow[];
  for (const legacy of legacyRows) {
    await ensureCanonicalConfig(
      tx,
      legacy,
      allConfigRows,
      effectiveEnvironment,
    );
  }

  // The subsidiary backfill runs later in boot, so migration validation reads
  // the base table exactly as the runtime selectors did.
  const configRows = (
    await tx.execute(sql`
      SELECT id, plugin_id, enabled, data
      FROM plugin_configs
      WHERE plugin_kind = 'wc-vendors'
        AND enabled
        AND plugin_id IN (
          'twilio',
          'sms-local',
          'sendgrid',
          'local-email',
          'local',
          'lob',
          'local-postal'
        )
    `)
  ).rows as ConfigRow[];
  const candidates = configRows.map(
    (row): CommVendorConfigCandidate => ({
      id: row.id,
      pluginId: row.plugin_id,
      data: row.data,
    }),
  );
  const namesToDelete = validateLegacyCommConfigCleanup(
    legacyRows.map((row) => row.name),
    candidates,
  );

  for (const candidate of candidates) {
    const legacyName =
      candidate.pluginId === "twilio"
        ? "service_config:sms"
        : candidate.pluginId === "sendgrid"
          ? "service_config:email"
          : candidate.pluginId === "lob"
            ? "service_config:postal"
            : undefined;
    if (!legacyName || !namesToDelete.includes(legacyName)) continue;
    const secretName = configData(candidate).secretName as string;
    let processValuePresent = false;
    try {
      processValuePresent = environment.isSecretPresent(secretName);
    } catch {
      // Runtime refuses unregistered secret names too.
      processValuePresent = false;
    }
    if (!processValuePresent && !(await hasStoredOverride(tx, secretName))) {
      throw new Error(
        `Cannot remove legacy communication settings: named secret for enabled ` +
          `${candidate.pluginId} wc-vendor configuration '${candidate.id}' is unavailable.`,
      );
    }
  }

  if (namesToDelete.length === 0) return 0;
  const deleted = await tx.execute(sql`
    DELETE FROM variables
    WHERE name IN (${sql.join(
      namesToDelete.map((name) => sql`${name}`),
      sql`, `,
    )})
  `);
  return deleted.rowCount ?? namesToDelete.length;
}

type LegacyValueRow = { name: LegacyCommConfigName; value: unknown };
type ConfigRow = {
  id: string;
  plugin_id: string;
  enabled: boolean;
  data: unknown;
};