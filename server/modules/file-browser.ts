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
        access: c.access,
        provider: c.provider,
        configured: true,
      }));
      const configuredIds = new Set(configured.map((c) => c.id));
      const dbIds = await storage.files.listDistinctFileSystemIds();
      const unconfigured = dbIds
        .filter((id) => !configuredIds.has(id))
        .map((id) => ({ id, name: id, access: null, provider: null, configured: false }));
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

      const prefix = typeof req.query.prefix === "string" && req.query.prefix ? req.query.prefix : undefined;
      const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
      const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

      const page = await fileSystemService.list(fileSystemId, { prefix, cursor, limit });

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
            if (prefix && !row.storagePath.startsWith(prefix)) continue;
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

      res.json({ status: "ok", entries, cursor: page.cursor ?? null });
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
