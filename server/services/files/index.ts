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
    opts?: { prefix?: string; cursor?: string; limit?: number },
  ) {
    return getFileSystemProvider(fileSystemId).list(opts);
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
