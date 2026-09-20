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

type MediumRule = {
  plugins: readonly string[];
  remotePlugin?: string;
  requiredRemoteFields?: readonly string[];
};

const RULES: Record<LegacyCommConfigName, MediumRule> = {
  "service_config:sms": {
    plugins: ["twilio", "sms-local"],
    remotePlugin: "twilio",
    requiredRemoteFields: ["accountSid", "fromNumber", "secretName"],
  },
  "service_config:email": {
    plugins: ["sendgrid", "local-email", "local"],
    remotePlugin: "sendgrid",
    requiredRemoteFields: ["secretName"],
  },
  "service_config:postal": {
    plugins: ["lob", "local-postal"],
    remotePlugin: "lob",
    requiredRemoteFields: ["secretName"],
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

/**
 * Execute the cleanup against the caller's transaction.
 *
 * The environment resolver is intentionally injected: boot supplies the
 * registered environment-variable reader, while tests can prove the database
 * behavior without accessing process credentials.
 */
export async function deleteLegacyCommServiceConfigs(
  tx: CommCleanupQueryExecutor,
  isRegisteredEnvironmentValuePresent: (name: string) => boolean,
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
      SELECT name
      FROM variables
      WHERE name IN (
        'service_config:sms',
        'service_config:email',
        'service_config:postal'
      )
    `)
  ).rows as LegacyNameRow[];
  if (legacyRows.length === 0) return 0;

  // Match runtime selection: all three selectors read the base table. The
  // subsidiary backfill runs later in boot and must not make a valid config
  // look absent during this migration.
  const configRows = (
    await tx.execute(sql`
      SELECT id, plugin_id, data
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
      processValuePresent = isRegisteredEnvironmentValuePresent(secretName);
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

type LegacyNameRow = { name: string };
type ConfigRow = { id: string; plugin_id: string; data: unknown };