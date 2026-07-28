import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import {
  fileSystemService,
  isFileSystemConfigured,
  listFileSystemConfigs,
  FileSystemNotConfiguredError,
  FileSystemOperationError,
  FilePathTraversalError,
  DirectoryNotEmptyError,
  DestinationExistsError,
} from "../services/files";
import multer from "multer";
import { logger } from "../logger";
import { getEffectiveUser } from "./masquerade";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/**
 * Admin raw file browser (Task #924). All routes are admin-gated and flow
 * exclusively through the filesystem service layer + storage.files —
 * never direct provider or DB access from here.
 *
 * Ordering rules preserved:
 * - upload/replace: write the object FIRST, then create/update the row.
 * - delete: remove the row FIRST, then the object (a failed object delete
 *   leaves a sweepable orphan, never a dangling row).
 */
/**
 * Normalize + validate a directory path from a request: strips leading /
 * trailing slashes, rejects NUL bytes, empty segments, "." and "..".
 * Returns null when invalid.
 */
function normalizeDirPath(raw: string): string | null {
  if (raw.includes("\0")) return null;
  const dir = raw.replace(/^\/+|\/+$/g, "");
  if (!dir) return null;
  const segments = dir.split("/");
  if (segments.some((s) => !s || s === "." || s === "..")) return null;
  return dir;
}

export function registerFileBrowserRoutes(app: Express, requireAuth: AuthMiddleware) {
  const adminOnly = [requireAuth, requireAccess("admin")] as const;

  /**
   * Configured filesystems (id, name, access, provider) plus any filesystem
   * ids referenced by DB rows that are NOT configured — surfaced so the
   * browser can show a clear "unconfigured" status instead of hiding them.
   */
  app.get("/api/admin/filesystems", ...adminOnly, async (_req, res) => {
    try {
      const configured = listFileSystemConfigs().map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
        access: c.access,
        provider: c.provider,
        configured: true,
      }));
      const configuredIds = new Set(configured.map((c) => c.id));
      const dbIds = await storage.files.listDistinctFileSystemIds();
      const unconfigured = dbIds
        .filter((id) => !configuredIds.has(id))
        .map((id) => ({ id, name: id, description: null, access: null, provider: null, configured: false }));
      res.json([...configured, ...unconfigured]);
    } catch (error) {
      logger.error("Failed to list filesystems", {
        service: "file-browser",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to list filesystems" });
    }
  });

  /**
   * Paginated raw listing of a filesystem via the provider's cursor-based
   * listing, annotated with the matching DB row's id/status (or flagged as
   * an orphan when no row exists). Providers without listing support and
   * inaccessible filesystems return a structured status instead of a 500.
   */
  app.get("/api/admin/filesystems/:id/browse", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    try {
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.json({
          status: "unconfigured",
          message: `Filesystem "${fileSystemId}" is not configured in the FILESYSTEMS environment variable. Its file records exist in the database, but the contents are not accessible.`,
          entries: [],
        });
      }

      // Current directory level ("" = root). Validated when present.
      const rawDir = typeof req.query.dir === "string" ? req.query.dir : "";
      let dir = "";
      if (rawDir) {
        const normalized = normalizeDirPath(rawDir);
        if (!normalized) {
          return res.status(400).json({ message: "Invalid directory path" });
        }
        dir = normalized;
      }
      const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
      const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

      const page = await fileSystemService.list(fileSystemId, {
        prefix: dir || undefined,
        cursor,
        limit,
        delimiter: true,
      });
      const prefix = dir ? dir + "/" : "";

      const entries = [];
      const objectPaths = new Set<string>();
      for (const entry of page.entries) {
        objectPaths.add(entry.path);
      }
      const rowsByPath = await storage.files.getByStoragePaths(Array.from(objectPaths), fileSystemId);
      for (const entry of page.entries) {
        const row = rowsByPath.get(entry.path);
        entries.push({
          path: entry.path,
          size: entry.size,
          lastModified: entry.lastModified ?? null,
          fileId: row?.id ?? null,
          fileName: row?.fileName ?? null,
          rowStatus: row?.status ?? null,
          orphan: !row,
          objectMissing: false,
        });
      }

      // DB rows in missing/pending_delete state usually have no backing
      // object, so a provider listing alone would hide them. Surface them
      // (once, on the first page) so the browser makes them visible.
      if (!cursor) {
        for (const status of ["missing", "pending_delete"] as const) {
          const rows = await storage.files.list({ fileSystemId, status });
          for (const row of rows) {
            if (objectPaths.has(row.storagePath)) continue;
            // Only rows directly in the current directory level.
            if (prefix && !row.storagePath.startsWith(prefix)) continue;
            if (row.storagePath.slice(prefix.length).includes("/")) continue;
            entries.push({
              path: row.storagePath,
              size: row.size,
              lastModified: null,
              fileId: row.id,
              fileName: row.fileName,
              rowStatus: row.status,
              orphan: false,
              objectMissing: true,
            });
          }
        }
      }

      const supportsDirectories = fileSystemService.supportsDirectories(fileSystemId);
      const supportsRename = fileSystemService.supportsRename(fileSystemId);
      res.json({
        status: "ok",
        entries,
        directories: page.directories ?? [],
        capabilities: { mkdir: supportsDirectories, rmdir: supportsDirectories, move: supportsRename },
        cursor: page.cursor ?? null,
      });
    } catch (error) {
      if (error instanceof FileSystemOperationError && /does not support listing/i.test(error.message)) {
        return res.json({
          status: "unsupported",
          message:
            "This filesystem's provider does not support raw listing. Files uploaded through the app are still tracked in the database and accessible by record.",
          entries: [],
        });
      }
      logger.warn("File browser listing failed", {
        service: "file-browser",
        fileSystemId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.json({
        status: "inaccessible",
        message: `Filesystem is currently inaccessible: ${error instanceof Error ? error.message : String(error)}`,
        entries: [],
      });
    }
  });

  /** Create an empty directory (local + s3 filesystems only). */
  app.post("/api/admin/filesystems/:id/mkdir", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    try {
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.status(503).json({
          message: `Filesystem "${fileSystemId}" is not configured; directories cannot be created.`,
        });
      }
      const rawPath = typeof req.body?.path === "string" ? req.body.path : "";
      const dir = normalizeDirPath(rawPath);
      if (!dir) {
        return res.status(400).json({ message: "Invalid directory path" });
      }
      if (!fileSystemService.supportsDirectories(fileSystemId)) {
        return res.status(400).json({
          message: "This filesystem's provider does not support creating directories.",
        });
      }
      await fileSystemService.mkdir(fileSystemId, dir);
      res.status(201).json({ message: "Folder created", path: dir });
    } catch (error) {
      if (error instanceof FilePathTraversalError) {
        return res.status(400).json({ message: "Invalid path" });
      }
      if (error instanceof FileSystemNotConfiguredError) {
        return res.status(503).json({ message: error.message });
      }
      logger.error("File browser mkdir failed", {
        service: "file-browser",
        fileSystemId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  /** Remove an EMPTY directory. Non-empty directories are refused with 409. */
  app.delete("/api/admin/filesystems/:id/directory", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    const rawPath = typeof req.query.path === "string" ? req.query.path : "";
    try {
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.status(503).json({
          message: `Filesystem "${fileSystemId}" is not configured; directories cannot be removed.`,
        });
      }
      const dir = normalizeDirPath(rawPath);
      if (!dir) {
        return res.status(400).json({ message: "Invalid directory path" });
      }
      if (!fileSystemService.supportsDirectories(fileSystemId)) {
        return res.status(400).json({
          message: "This filesystem's provider does not support removing directories.",
        });
      }
      await fileSystemService.rmdir(fileSystemId, dir);
      res.json({ message: "Folder removed" });
    } catch (error) {
      if (error instanceof DirectoryNotEmptyError) {
        return res.status(409).json({
          message: "This folder is not empty. Delete its contents first, then remove the folder.",
        });
      }
      if (error instanceof FilePathTraversalError) {
        return res.status(400).json({ message: "Invalid path" });
      }
      if (error instanceof FileSystemNotConfiguredError) {
        return res.status(503).json({ message: error.message });
      }
      logger.error("File browser rmdir failed", {
        service: "file-browser",
        fileSystemId,
        path: rawPath,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to remove folder" });
    }
  });

  /**
   * Rename or move a file or a folder. Body: { from, to, isDirectory }.
   * Files: the object is renamed first, then the DB row's storagePath (and
   * fileName) is updated. Folders: recursive provider rename, then a bulk
   * storage_path prefix rewrite keeps all affected rows in sync.
   */
  app.post("/api/admin/filesystems/:id/move", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    try {
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.status(503).json({
          message: `Filesystem "${fileSystemId}" is not configured; renaming is not possible.`,
        });
      }
      const from = normalizeDirPath(typeof req.body?.from === "string" ? req.body.from : "");
      const to = normalizeDirPath(typeof req.body?.to === "string" ? req.body.to : "");
      const isDirectory = req.body?.isDirectory === true;
      if (!from || !to) {
        return res.status(400).json({ message: "Invalid source or destination path" });
      }
      if (from === to) {
        return res.status(400).json({ message: "Source and destination are the same" });
      }
      if (isDirectory && (to === from || to.startsWith(from + "/"))) {
        return res.status(400).json({ message: "Cannot move a folder into itself" });
      }
      if (!fileSystemService.supportsRename(fileSystemId)) {
        return res.status(400).json({
          message: "This filesystem's provider does not support renaming or moving.",
        });
      }

      if (isDirectory) {
        await fileSystemService.renameDirectory(fileSystemId, from, to);
        const updated = await storage.files.renameStoragePathPrefix(fileSystemId, from, to);
        return res.json({ message: "Folder moved", from, to, rowsUpdated: updated });
      }

      // Refuse when a DB row already points at the destination (the object
      // check happens inside the provider).
      const existingAtDest = await storage.files.getByStoragePath(to, fileSystemId);
      if (existingAtDest) {
        return res.status(409).json({ message: "A file record already exists at the destination path." });
      }

      await fileSystemService.rename(fileSystemId, from, to);

      const row = await storage.files.getByStoragePath(from, fileSystemId);
      if (row) {
        const newName = to.split("/").pop() || row.fileName;
        const updated = await storage.files.update(row.id, {
          storagePath: to,
          fileName: newName,
        });
        if (!updated) {
          logger.warn("File browser move: object renamed but row update failed", {
            service: "file-browser",
            fileSystemId,
            from,
            to,
          });
        }
      }

      res.json({ message: "File moved", from, to });
    } catch (error) {
      if (error instanceof DestinationExistsError) {
        return res.status(409).json({ message: "Something already exists at the destination path." });
      }
      if (error instanceof FilePathTraversalError) {
        return res.status(400).json({ message: "Invalid path" });
      }
      if (error instanceof FileSystemNotConfiguredError) {
        return res.status(503).json({ message: error.message });
      }
      logger.error("File browser move failed", {
        service: "file-browser",
        fileSystemId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to rename or move" });
    }
  });

  /**
   * Upload (or replace, when `path` names an existing object) a file.
   * Object first, row second; the row is created or updated to keep the
   * files table in sync.
   */
  app.post(
    "/api/admin/filesystems/:id/upload",
    ...adminOnly,
    upload.single("file"),
    async (req, res) => {
      const fileSystemId = req.params.id;
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }
        if (!isFileSystemConfigured(fileSystemId)) {
          return res.status(503).json({
            message: `Filesystem "${fileSystemId}" is not configured; uploads are not possible.`,
          });
        }

        const { dbUser } = await getEffectiveUser((req.session as any) ?? {}, req.user as any);
        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        // Optional explicit target path — used for "replace" and for
        // uploading into a folder/prefix. Normalized by the service layer;
        // the local provider additionally enforces its traversal jail.
        const targetPath =
          typeof req.body.path === "string" && req.body.path.trim()
            ? req.body.path.trim().replace(/^\/+/, "")
            : undefined;

        const uploadResult = await fileSystemService.upload({
          fileSystemId,
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          customPath: targetPath,
        });

        const existing = await storage.files.getByStoragePath(uploadResult.storagePath, fileSystemId);
        let file;
        if (existing) {
          // Replace: the object now exists with fresh bytes, so the row goes
          // back to live regardless of a previous missing/pending_delete state.
          file = await storage.files.update(existing.id, {
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: uploadResult.size,
            status: "live",
          });
        } else {
          file = await storage.files.create({
            fileName: req.file.originalname,
            storagePath: uploadResult.storagePath,
            mimeType: req.file.mimetype,
            size: uploadResult.size,
            uploadedBy: dbUser.id,
            fileSystemId,
            status: "live",
          });
        }

        res.status(existing ? 200 : 201).json(file);
      } catch (error) {
        if (error instanceof FilePathTraversalError) {
          return res.status(400).json({ message: "Invalid path" });
        }
        if (error instanceof FileSystemNotConfiguredError) {
          return res.status(503).json({ message: error.message });
        }
        logger.error("File browser upload failed", {
          service: "file-browser",
          fileSystemId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to upload file" });
      }
    },
  );

  /** Download a raw object by path (works for orphans with no DB row too). */
  app.get("/api/admin/filesystems/:id/download", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    const storagePath = typeof req.query.path === "string" ? req.query.path : "";
    try {
      if (!storagePath) {
        return res.status(400).json({ message: "path query parameter is required" });
      }
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.status(503).json({
          message: `Filesystem "${fileSystemId}" is not configured; downloads are not possible.`,
        });
      }

      const content = await fileSystemService.download(fileSystemId, storagePath);
      const row = await storage.files.getByStoragePath(storagePath, fileSystemId);
      const rawName = row?.fileName || storagePath.split("/").pop() || "download";
      const safeName = rawName.replace(/["\r\n]/g, "");
      res.setHeader("Content-Type", row?.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Content-Length", content.length);
      res.send(content);
    } catch (error) {
      if (error instanceof FilePathTraversalError) {
        return res.status(400).json({ message: "Invalid path" });
      }
      if (error instanceof FileSystemNotConfiguredError) {
        return res.status(503).json({ message: error.message });
      }
      logger.warn("File browser download failed", {
        service: "file-browser",
        fileSystemId,
        storagePath,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(404).json({ message: "File not found or filesystem inaccessible" });
    }
  });

  /**
   * Delete a raw object by path. Row first (when one exists), then the
   * object — a failed object delete leaves a sweepable orphan.
   */
  app.delete("/api/admin/filesystems/:id/object", ...adminOnly, async (req, res) => {
    const fileSystemId = req.params.id;
    const storagePath = typeof req.query.path === "string" ? req.query.path : "";
    try {
      if (!storagePath) {
        return res.status(400).json({ message: "path query parameter is required" });
      }
      if (!isFileSystemConfigured(fileSystemId)) {
        return res.status(503).json({
          message: `Filesystem "${fileSystemId}" is not configured; deletions are not possible.`,
        });
      }

      const row = await storage.files.getByStoragePath(storagePath, fileSystemId);
      if (row) {
        await storage.files.delete(row.id);
      }

      try {
        await fileSystemService.remove(fileSystemId, storagePath);
      } catch (error) {
        if (row) {
          // Row already gone; the object is now a sweepable orphan.
          logger.warn("File browser: row deleted but object removal failed — orphan left for sweep", {
            service: "file-browser",
            fileSystemId,
            storagePath,
            error: error instanceof Error ? error.message : String(error),
          });
          return res.json({
            message: "File record deleted; the object could not be removed and will be cleaned up by the consistency sweep.",
          });
        }
        throw error;
      }

      res.json({ message: "File deleted successfully" });
    } catch (error) {
      if (error instanceof FilePathTraversalError) {
        return res.status(400).json({ message: "Invalid path" });
      }
      if (error instanceof FileSystemNotConfiguredError) {
        return res.status(503).json({ message: error.message });
      }
      logger.error("File browser delete failed", {
        service: "file-browser",
        fileSystemId,
        storagePath,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to delete file" });
    }
  });
}
