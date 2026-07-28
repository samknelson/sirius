/**
 * High-level file service — the single entry point routes / wizards / esig
 * code use to move bytes. DB rows stay in server/storage/files.ts; this layer
 * only talks to filesystem providers.
 *
 * Ordering rules (kept by the callers, supported here):
 * - CREATE: write the object FIRST, insert the DB row second. A failed insert
 *   leaves an orphan object (invisible, sweepable) — never a row without a file.
 * - DELETE: remove/mark the DB row FIRST, then delete the object. A failed
 *   object delete leaves an orphan object, never a dangling row.
 */
export {
  FileSystemNotConfiguredError,
  FileSystemOperationError,
  FilePathTraversalError,
  DirectoryNotEmptyError,
  type FileSystemProvider,
  type FileStat,
  type FileListPage,
  type FileListEntry,
  type FileListOptions,
  type FileSystemAccess,
} from "./base";
export { type FileSystemConfig } from "./config";
export {
  initFileSystems,
  isFileSystemConfigured,
  getFileSystemConfig,
  getFileSystemProvider,
  listFileSystemConfigs,
} from "./registry";

import { FileSystemOperationError } from "./base";
import { getFileSystemConfig, getFileSystemProvider } from "./registry";

export interface UploadOptions {
  fileSystemId: string;
  fileName: string;
  fileContent: Buffer;
  mimeType?: string;
  /** Exact storage path; when omitted a timestamped path is generated. */
  customPath?: string;
}

function sanitizeFileName(fileName: string): string {
  // Strip any directory components and characters that are hostile in keys.
  const base = fileName.split(/[/\\]/).pop() || "file";
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 200) || "file";
}

export const fileSystemService = {
  /** Upload bytes to a filesystem. Returns the storage path used. */
  async upload(options: UploadOptions): Promise<{ storagePath: string; size: number }> {
    const provider = getFileSystemProvider(options.fileSystemId);
    const storagePath =
      options.customPath?.replace(/^\/+/, "") ||
      `${Date.now()}-${sanitizeFileName(options.fileName)}`;
    await provider.write(storagePath, options.fileContent, { mimeType: options.mimeType });
    return { storagePath, size: options.fileContent.length };
  },

  async download(fileSystemId: string, storagePath: string): Promise<Buffer> {
    return getFileSystemProvider(fileSystemId).read(storagePath);
  },

  async remove(fileSystemId: string, storagePath: string): Promise<void> {
    await getFileSystemProvider(fileSystemId).delete(storagePath);
  },

  async stat(fileSystemId: string, storagePath: string) {
    return getFileSystemProvider(fileSystemId).stat(storagePath);
  },

  /**
   * Cursor-paged raw listing of a filesystem's objects. Throws
   * FileSystemOperationError when the provider does not support listing
   * (replit) or is inaccessible.
   */
  async list(
    fileSystemId: string,
    opts?: { prefix?: string; cursor?: string; limit?: number; delimiter?: boolean },
  ) {
    return getFileSystemProvider(fileSystemId).list(opts);
  },

  /** Whether the filesystem's provider supports mkdir/rmdir. */
  supportsDirectories(fileSystemId: string): boolean {
    return getFileSystemProvider(fileSystemId).supportsDirectories === true;
  },

  /** Create an empty directory. Throws when the provider lacks support. */
  async mkdir(fileSystemId: string, path: string): Promise<void> {
    const provider = getFileSystemProvider(fileSystemId);
    if (!provider.supportsDirectories || !provider.mkdir) {
      throw new FileSystemOperationError(
        "This filesystem's provider does not support directories.",
        fileSystemId,
      );
    }
    await provider.mkdir(path);
  },

  /** Remove an EMPTY directory. Throws DirectoryNotEmptyError otherwise. */
  async rmdir(fileSystemId: string, path: string): Promise<void> {
    const provider = getFileSystemProvider(fileSystemId);
    if (!provider.supportsDirectories || !provider.rmdir) {
      throw new FileSystemOperationError(
        "This filesystem's provider does not support directories.",
        fileSystemId,
      );
    }
    await provider.rmdir(path);
  },

  /**
   * A time-limited direct URL when the provider supports one; null for
   * providers (local) that must be streamed through the app.
   */
  async getSignedUrl(
    fileSystemId: string,
    storagePath: string,
    expiresInSeconds: number,
  ): Promise<string | null> {
    return getFileSystemProvider(fileSystemId).getSignedUrl(storagePath, expiresInSeconds);
  },

  /** Whether a filesystem is declared public in the environment config. */
  isPublic(fileSystemId: string): boolean {
    return getFileSystemConfig(fileSystemId).access === "public";
  },
};
