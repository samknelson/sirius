import * as fs from "fs/promises";
import * as path from "path";
import {
  FilePathTraversalError,
  FileSystemOperationError,
  type FileListOptions,
  type FileListPage,
  type FileStat,
  type FileSystemProvider,
} from "../base";

/**
 * Local-disk filesystem provider. All operations are strictly jailed to the
 * configured base_path:
 * - every incoming path is normalized and lexically resolved against
 *   base_path ("..", absolute paths, NUL bytes are rejected), AND
 * - real-path (symlink-aware) containment is enforced: symlinked files are
 *   refused and any path whose physical location escapes base_path throws
 *   FilePathTraversalError, even when the lexical path looks contained.
 */
export class LocalFileSystemProvider implements FileSystemProvider {
  readonly kind = "local" as const;
  private readonly basePath: string;
  private realBasePromise: Promise<string> | null = null;

  constructor(
    readonly fileSystemId: string,
    settings: { base_path: string },
  ) {
    this.basePath = path.resolve(settings.base_path);
  }

  /** Lexical jail: resolve a storage path inside base_path or throw. */
  resolveSafe(storagePath: string): string {
    if (storagePath.includes("\0")) {
      throw new FilePathTraversalError(storagePath);
    }
    const relative = storagePath.replace(/^\/+/, "");
    const resolved = path.resolve(this.basePath, relative);
    if (resolved !== this.basePath && !resolved.startsWith(this.basePath + path.sep)) {
      throw new FilePathTraversalError(storagePath);
    }
    return resolved;
  }

  /** The physical (symlink-resolved) base directory. */
  private async realBase(): Promise<string> {
    if (!this.realBasePromise) {
      this.realBasePromise = (async () => {
        try {
          return await fs.realpath(this.basePath);
        } catch (error: any) {
          if (error?.code === "ENOENT") return this.basePath; // not created yet
          throw error;
        }
      })();
    }
    return this.realBasePromise;
  }

  private async isWithinRealBase(realTarget: string): Promise<boolean> {
    const base = await this.realBase();
    return realTarget === base || realTarget.startsWith(base + path.sep);
  }

  /**
   * Symlink-aware jail for an EXISTING path: the entry itself must not be a
   * symlink, and its physical location (after resolving any symlinked parent
   * directories) must remain inside base_path.
   */
  private async assertRealContained(abs: string, storagePath: string): Promise<void> {
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) {
      throw new FilePathTraversalError(storagePath);
    }
    const real = await fs.realpath(abs);
    if (!(await this.isWithinRealBase(real))) {
      throw new FilePathTraversalError(storagePath);
    }
  }

  /**
   * Symlink-aware jail for a path being CREATED: the nearest existing
   * ancestor directory must physically live inside base_path, and an existing
   * target must not be a symlink.
   */
  private async assertWriteContained(abs: string, storagePath: string): Promise<void> {
    try {
      const lst = await fs.lstat(abs);
      if (lst.isSymbolicLink()) throw new FilePathTraversalError(storagePath);
    } catch (error: any) {
      if (error instanceof FilePathTraversalError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    let dir = path.dirname(abs);
    for (;;) {
      try {
        const real = await fs.realpath(dir);
        if (!(await this.isWithinRealBase(real))) {
          throw new FilePathTraversalError(storagePath);
        }
        return;
      } catch (error: any) {
        if (error instanceof FilePathTraversalError) throw error;
        if (error?.code !== "ENOENT") throw error;
        const parent = path.dirname(dir);
        if (parent === dir) return; // filesystem root — realBase handles the rest
        dir = parent;
      }
    }
  }

  async read(storagePath: string): Promise<Buffer> {
    const abs = this.resolveSafe(storagePath);
    try {
      await this.assertRealContained(abs, storagePath);
      return await fs.readFile(abs);
    } catch (error: any) {
      if (error instanceof FilePathTraversalError) throw error;
      if (error?.code === "ENOENT") {
        throw new FileSystemOperationError(`File not found: ${storagePath}`, this.fileSystemId, error);
      }
      throw new FileSystemOperationError(
        `Failed to read file: ${error?.message ?? error}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async write(storagePath: string, content: Buffer): Promise<void> {
    const abs = this.resolveSafe(storagePath);
    try {
      await this.assertWriteContained(abs, storagePath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // Re-check after mkdir: the full parent chain now exists.
      await this.assertWriteContained(abs, storagePath);
      await fs.writeFile(abs, content);
    } catch (error: any) {
      if (error instanceof FilePathTraversalError) throw error;
      throw new FileSystemOperationError(
        `Failed to write file: ${error?.message ?? error}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async delete(storagePath: string): Promise<void> {
    const abs = this.resolveSafe(storagePath);
    try {
      await this.assertRealContained(abs, storagePath);
      await fs.unlink(abs);
    } catch (error: any) {
      if (error instanceof FilePathTraversalError) throw error;
      if (error?.code === "ENOENT") return; // already gone — deletion is idempotent
      throw new FileSystemOperationError(
        `Failed to delete file: ${error?.message ?? error}`,
        this.fileSystemId,
        error,
      );
    }
  }

  async stat(storagePath: string): Promise<FileStat | null> {
    const abs = this.resolveSafe(storagePath);
    try {
      await this.assertRealContained(abs, storagePath);
      const s = await fs.stat(abs);
      if (!s.isFile()) return null;
      return { size: s.size, lastModified: s.mtime };
    } catch (error: any) {
      if (error instanceof FilePathTraversalError) throw error;
      if (error?.code === "ENOENT") return null;
      throw new FileSystemOperationError(
        `Failed to stat file: ${error?.message ?? error}`,
        this.fileSystemId,
        error,
      );
    }
  }

  /**
   * Cursor-based listing: walks the tree depth-first in sorted order and
   * uses "last path returned" as the cursor. Symlinks (files or directories)
   * are skipped entirely — they are never created by this provider and could
   * point outside the jail.
   */
  async list(opts?: FileListOptions): Promise<FileListPage> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000);
    const prefix = opts?.prefix?.replace(/^\/+/, "") ?? "";
    const after = opts?.cursor;
    const entries: FileListPage["entries"] = [];

    const walk = async (dir: string): Promise<boolean> => {
      let names: string[];
      try {
        names = (await fs.readdir(dir)).sort();
      } catch (error: any) {
        if (error?.code === "ENOENT") return false;
        throw new FileSystemOperationError(
          `Failed to list directory: ${error?.message ?? error}`,
          this.fileSystemId,
          error,
        );
      }
      for (const name of names) {
        const abs = path.join(dir, name);
        const rel = path.relative(this.basePath, abs).split(path.sep).join("/");
        const s = await fs.lstat(abs);
        if (s.isSymbolicLink()) continue; // never follow symlinks out of the jail
        if (s.isDirectory()) {
          // Prune subtrees that cannot contain matching paths.
          if (prefix && !rel.startsWith(prefix) && !prefix.startsWith(rel + "/")) continue;
          if (await walk(abs)) return true;
        } else if (s.isFile()) {
          if (prefix && !rel.startsWith(prefix)) continue;
          if (after && rel <= after) continue;
          entries.push({ path: rel, size: s.size, lastModified: s.mtime });
          if (entries.length >= limit) return true;
        }
      }
      return false;
    };

    const truncated = await walk(this.basePath);
    return {
      entries,
      cursor: truncated ? entries[entries.length - 1]?.path : undefined,
    };
  }

  async getSignedUrl(): Promise<string | null> {
    // Local files have no provider-side URL; public local filesystems are
    // served through the guarded /public-files Express route instead.
    return null;
  }
}
