import { z } from "zod";
import { logger } from "../../logger";
import type { FileSystemAccess, FileSystemProviderKind } from "./base";

const SERVICE = "filesystems";

/**
 * FILESYSTEMS environment variable — a JSON object keyed by filesystem id:
 *
 * {
 *   "legacy":  { "name": "Legacy",  "access": "private", "provider": "replit",
 *                "provider_settings": { "bucket_id": "replit-objstore-..." } },
 *   "public":  { "name": "Public",  "access": "public",  "provider": "local",
 *                "provider_settings": { "base_path": "/home/runner/files/public" } },
 *   "archive": { "name": "Archive", "access": "private", "provider": "s3",
 *                "provider_settings": {
 *                  "bucket": "my-archive", "region": "us-east-1",
 *                  "access_key_id_secret": "ARCHIVE_S3_KEY_ID",
 *                  "secret_access_key_secret": "ARCHIVE_S3_SECRET" } }
 * }
 *
 * Secret values are NEVER inlined in the JSON. Settings whose key ends in
 * `_secret` hold the NAME of an environment variable; the value is resolved
 * from process.env at boot and exposed under the key without the suffix
 * (access_key_id_secret → access_key_id).
 */

const replitSettingsSchema = z.object({
  bucket_id: z.string().min(1, "replit provider requires provider_settings.bucket_id"),
});

const s3SettingsSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1),
  endpoint: z.string().url().optional(),
  force_path_style: z.boolean().optional(),
  prefix: z.string().optional(),
  access_key_id: z.string().min(1),
  secret_access_key: z.string().min(1),
});

const localSettingsSchema = z.object({
  base_path: z
    .string()
    .min(1)
    .refine((p) => p.startsWith("/"), "local provider base_path must be an absolute path"),
});

const rawFileSystemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  access: z.enum(["public", "private"]),
  provider: z.enum(["replit", "s3", "local"]),
  provider_settings: z.record(z.unknown()).default({}),
});

const fileSystemIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "filesystem ids must be alphanumeric with - or _");

export interface FileSystemConfig {
  id: string;
  name: string;
  description?: string;
  access: FileSystemAccess;
  provider: FileSystemProviderKind;
  /** Provider settings with `_secret` references already resolved. */
  settings: Record<string, unknown>;
}

/**
 * Resolve `*_secret` settings entries: the value names an env var whose value
 * is exposed under the key without the `_secret` suffix. Throws on missing
 * secrets so misconfiguration fails loudly at boot rather than at first use.
 */
function resolveSecretSettings(
  fsId: string,
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key.endsWith("_secret")) {
      if (typeof value !== "string" || !value) {
        throw new Error(
          `FILESYSTEMS: filesystem "${fsId}" setting "${key}" must name an environment variable`,
        );
      }
      const secretValue = process.env[value];
      if (secretValue === undefined || secretValue === "") {
        throw new Error(
          `FILESYSTEMS: filesystem "${fsId}" references secret "${value}" (via "${key}") but that environment variable is not set`,
        );
      }
      resolved[key.slice(0, -"_secret".length)] = secretValue;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

const providerSettingsValidators: Record<FileSystemProviderKind, z.ZodTypeAny> = {
  replit: replitSettingsSchema,
  s3: s3SettingsSchema,
  local: localSettingsSchema,
};

/**
 * Parse and validate the FILESYSTEMS env var. Returns an empty map when the
 * variable is unset (a valid state: no filesystems configured). Throws on any
 * malformed entry — boot must fail loudly rather than half-configure storage.
 */
export function parseFileSystemsEnv(
  raw: string | undefined = process.env.FILESYSTEMS,
): Map<string, FileSystemConfig> {
  const configs = new Map<string, FileSystemConfig>();
  if (raw === undefined || raw.trim() === "") return configs;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `FILESYSTEMS environment variable is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("FILESYSTEMS must be a JSON object keyed by filesystem id");
  }

  for (const [id, rawEntry] of Object.entries(parsed as Record<string, unknown>)) {
    const idResult = fileSystemIdSchema.safeParse(id);
    if (!idResult.success) {
      throw new Error(`FILESYSTEMS: invalid filesystem id "${id}": ${idResult.error.issues[0]?.message}`);
    }
    const entryResult = rawFileSystemSchema.safeParse(rawEntry);
    if (!entryResult.success) {
      const detail = entryResult.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`FILESYSTEMS: filesystem "${id}" is malformed — ${detail}`);
    }
    const entry = entryResult.data;

    const resolvedSettings = resolveSecretSettings(id, entry.provider_settings);
    const settingsResult = providerSettingsValidators[entry.provider].safeParse(resolvedSettings);
    if (!settingsResult.success) {
      const detail = settingsResult.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `FILESYSTEMS: filesystem "${id}" has invalid ${entry.provider} provider settings — ${detail}`,
      );
    }

    configs.set(id, {
      id,
      name: entry.name,
      description: entry.description,
      access: entry.access,
      provider: entry.provider,
      settings: settingsResult.data as Record<string, unknown>,
    });
  }

  logger.info(`Parsed ${configs.size} filesystem(s) from FILESYSTEMS`, {
    service: SERVICE,
    fileSystems: Array.from(configs.keys()),
  });
  return configs;
}
