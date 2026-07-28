import { ObjectStorageService } from "../../objectStorage";
import {
  FileSystemOperationError,
  type FileListOptions,
  type FileListPage,
  type FileStat,
  type FileSystemProvider,
} from "../base";

/**
 * Replit Object Storage provider — wraps the existing sidecar-based
 * ObjectStorageService with a per-filesystem bucket id.
 */
export class ReplitFileSystemProvider implements FileSystemProvider {
  readonly kind = "replit" as const;
  private readonly objectStorage: ObjectStorageService;

  constructor(
    readonly fileSystemId: string,
    settings: { bucket_id: string },
  ) {
    this.objectStorage = new ObjectStorageService(settings.bucket_id);
  }

  async read(path: string): Promise<Buffer> {
    try {
      return await this.objectStorage.downloadFile(path);
    } catch (error) {
      throw new FileSystemOperationError(
        `Failed to read "${path}": ${error instanceof Error ? error.message : String(error)}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async write(path: string, content: Buffer, opts?: { mimeType?: string }): Promise<void> {
    try {
      await this.objectStorage.uploadFile({
        fileName: path.split("/").pop() || path,
        fileContent: content,
        mimeType: opts?.mimeType,
        accessLevel: "private", // ignored — customPath pins the exact object key
        customPath: path,
      });
    } catch (error) {
      throw new FileSystemOperationError(
        `Failed to write "${path}": ${error instanceof Error ? error.message : String(error)}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await this.objectStorage.deleteFile(path);
    } catch (error) {
      // Replit's DELETE on a missing object errors; treat as idempotent when
      // the object is already gone.
      const exists = await this.objectStorage.fileExists(path).catch(() => true);
      if (!exists) return;
      throw new FileSystemOperationError(
        `Failed to delete "${path}": ${error instanceof Error ? error.message : String(error)}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const meta = await this.objectStorage.getFileMetadata(path);
      return { size: meta.size, mimeType: meta.mimeType, lastModified: meta.lastModified };
    } catch {
      return null;
    }
  }

  async list(_opts?: FileListOptions): Promise<FileListPage> {
    // The Replit storage sidecar exposes no list endpoint; listings for
    // replit-backed filesystems come from the files table instead.
    throw new FileSystemOperationError(
      "The replit provider does not support listing; use the files table (storage.files.list) instead.",
      this.fileSystemId,
    );
  }

  async getSignedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    return this.objectStorage.generateSignedUrl(path, expiresInSeconds);
  }
}
