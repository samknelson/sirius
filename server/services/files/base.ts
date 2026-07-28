/**
 * Multi-filesystem file storage abstraction.
 *
 * Filesystems are defined ONLY through the FILESYSTEMS environment variable
 * (see config.ts) — never in code and never in the database. Each filesystem
 * is backed by one provider ("replit", "s3", or "local") and every row in the
 * `files` table belongs to exactly one filesystem via `file_system_id`.
 */

export type FileSystemAccess = "public" | "private";
export type FileSystemProviderKind = "replit" | "s3" | "local";

export interface FileStat {
  size: number;
  mimeType?: string;
  lastModified?: Date;
}

export interface FileListEntry {
  path: string;
  size: number;
  lastModified?: Date;
}

export interface FileListPage {
  entries: FileListEntry[];
  /** Opaque cursor for the next page; undefined when exhausted. */
  cursor?: string;
}

export interface FileListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface FileSystemProvider {
  readonly fileSystemId: string;
  readonly kind: FileSystemProviderKind;

  read(path: string): Promise<Buffer>;
  write(path: string, content: Buffer, opts?: { mimeType?: string }): Promise<void>;
  delete(path: string): Promise<void>;
  /** Returns null when the object does not exist. */
  stat(path: string): Promise<FileStat | null>;
  list(opts?: FileListOptions): Promise<FileListPage>;
  /**
   * A time-limited URL for direct GET access, when the provider supports it.
   * Providers that cannot mint one (local) return null.
   */
  getSignedUrl(path: string, expiresInSeconds: number): Promise<string | null>;
}

/** Thrown when a filesystem id is not present in the FILESYSTEMS env config. */
export class FileSystemNotConfiguredError extends Error {
  constructor(public readonly fileSystemId: string) {
    super(
      `Filesystem "${fileSystemId}" is not configured. An operator must define it ` +
        `in the FILESYSTEMS environment variable before its files can be accessed.`,
    );
    this.name = "FileSystemNotConfiguredError";
  }
}

/** Thrown for provider-level failures (network, permissions, missing object …). */
export class FileSystemOperationError extends Error {
  constructor(
    message: string,
    public readonly fileSystemId?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FileSystemOperationError";
  }
}

/** Thrown by the local provider when a path escapes its base_path jail. */
export class FilePathTraversalError extends Error {
  constructor(public readonly attemptedPath: string) {
    super(`Refusing to access path outside the filesystem base directory`);
    this.name = "FilePathTraversalError";
  }
}
