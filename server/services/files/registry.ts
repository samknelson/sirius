import { logger } from "../../logger";
import { FileSystemNotConfiguredError, type FileSystemProvider } from "./base";
import { parseFileSystemsEnv, type FileSystemConfig } from "./config";
import { LocalFileSystemProvider } from "./providers/local";
import { ReplitFileSystemProvider } from "./providers/replit";
import { S3FileSystemProvider } from "./providers/s3";

const SERVICE = "filesystems";

let configs: Map<string, FileSystemConfig> | null = null;
const providers = new Map<string, FileSystemProvider>();

function buildProvider(config: FileSystemConfig): FileSystemProvider {
  switch (config.provider) {
    case "replit":
      return new ReplitFileSystemProvider(config.id, config.settings as { bucket_id: string });
    case "s3":
      return new S3FileSystemProvider(config.id, config.settings as any);
    case "local":
      return new LocalFileSystemProvider(config.id, config.settings as { base_path: string });
  }
}

function ensureLoaded(): Map<string, FileSystemConfig> {
  if (!configs) {
    configs = parseFileSystemsEnv();
  }
  return configs;
}

/**
 * Initialize the filesystem registry at boot. Throws on malformed config
 * (fail loudly). `dbReferencedIds` — the distinct file_system_id values found
 * in the files table — produces a visible warning for any id that is not
 * configured in the environment, instead of silent runtime 500s later.
 */
export function initFileSystems(dbReferencedIds: string[] = []): void {
  configs = parseFileSystemsEnv();
  providers.clear();
  const missing = dbReferencedIds.filter((id) => !configs!.has(id));
  if (missing.length > 0) {
    logger.warn(
      `Files in the database reference filesystem(s) not present in FILESYSTEMS: ${missing.join(", ")}. ` +
        `Those files exist as records but their contents are NOT accessible until an operator configures ` +
        `the filesystem(s) in the environment.`,
      { service: SERVICE, missingFileSystems: missing },
    );
  }
}

export function isFileSystemConfigured(fileSystemId: string): boolean {
  return ensureLoaded().has(fileSystemId);
}

export function getFileSystemConfig(fileSystemId: string): FileSystemConfig {
  const config = ensureLoaded().get(fileSystemId);
  if (!config) throw new FileSystemNotConfiguredError(fileSystemId);
  return config;
}

export function listFileSystemConfigs(): FileSystemConfig[] {
  return Array.from(ensureLoaded().values());
}

export function getFileSystemProvider(fileSystemId: string): FileSystemProvider {
  const cached = providers.get(fileSystemId);
  if (cached) return cached;
  const provider = buildProvider(getFileSystemConfig(fileSystemId));
  providers.set(fileSystemId, provider);
  return provider;
}
