import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireAccess, buildContext } from "../services/access-policy-evaluator";
import { isComponentEnabled } from "./components";
import { fileSystemService, listFileSystemConfigs, FileSystemNotConfiguredError } from "../services/files";
import {
  getEntityFileContext,
  listEntityFileContexts,
  type EntityFileContext,
  type EntityFilesVerb,
} from "../services/entity-files/registry";
import {
  getEntityFilesContextConfig,
  resolveUsableContextConfig,
  expandDirectoryTemplate,
  isExtensionAllowed,
} from "../services/entity-files/config";
import { insertFileSchema } from "@shared/schema";
import { logger } from "../logger";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    data: z.unknown().optional(),
  })
  .strict();

/**
 * Resolve the context from :context, enforce its component gate, its access
 * callback for the given verb, and entity existence. Attaches nothing to
 * req — returns the context or undefined after responding.
 */
async function resolveContextAndAuthorize(
  req: Request,
  res: Response,
  verb: EntityFilesVerb,
): Promise<EntityFileContext | undefined> {
  const context = getEntityFileContext(req.params.context);
  if (!context) {
    res.status(404).json({ message: "Unknown entity file context" });
    return undefined;
  }
  if (context.component && !(await isComponentEnabled(context.component))) {
    res.status(404).json({ message: "Unknown entity file context" });
    return undefined;
  }
  const granted = await context.checkAccess(verb, req.params.entityId, req);
  if (!granted) {
    res.status(403).json({ message: "Insufficient permissions" });
    return undefined;
  }
  if (!(await context.entityExists(req.params.entityId))) {
    res.status(404).json({ message: "Entity not found" });
    return undefined;
  }
  return context;
}

/**
 * Generic entity file attachment routes. Contexts are registered in code
 * (server/services/entity-files/registry.ts); where files land is operator
 * configuration in the `entity_files_config` variable.
 */
export function registerEntityFileRoutes(app: Express, requireAuth: AuthMiddleware) {
  // Admin metadata for the config page: registered contexts (with their
  // directory tokens and current config) plus the available filesystems.
  app.get(
    "/api/entity-files/contexts",
    requireAuth,
    requireAccess("admin"),
    async (_req, res) => {
      try {
        const contexts = await Promise.all(
          listEntityFileContexts().map(async (context) => ({
            id: context.id,
            label: context.label,
            component: context.component ?? null,
            componentEnabled: context.component
              ? await isComponentEnabled(context.component)
              : true,
            tokens: context.tokens,
            config: (await getEntityFilesContextConfig(context.id)) ?? null,
          })),
        );
        const fileSystems = listFileSystemConfigs().map((fs) => ({
          id: fs.id,
          access: fs.access,
        }));
        res.json({ contexts, fileSystems });
      } catch (error) {
        logger.error("Failed to list entity file contexts", {
          service: "entityFiles",
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to list entity file contexts" });
      }
    },
  );

  // List attachments (plus whether uploads are currently possible).
  app.get("/api/entity-files/:context/:entityId", requireAuth, async (req, res) => {
    try {
      const context = await resolveContextAndAuthorize(req, res, "view");
      if (!context) return;
      const [files, usable] = await Promise.all([
        context.adapter.list(req.params.entityId),
        resolveUsableContextConfig(context.id),
      ]);
      res.json({
        configured: !!usable.config,
        message: usable.config ? null : usable.reason,
        allowed: usable.config?.allowed ?? null,
        files,
      });
    } catch (error) {
      logger.error("Failed to list entity files", {
        service: "entityFiles",
        context: req.params.context,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to list files" });
    }
  });

  // Upload: bytes first (a failed row insert leaves a sweepable orphan
  // object), then files row + join row in ONE transaction via the adapter.
  app.post(
    "/api/entity-files/:context/:entityId",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      try {
        const context = await resolveContextAndAuthorize(req, res, "manage");
        if (!context) return;
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }
        const usable = await resolveUsableContextConfig(context.id);
        if (!usable.config) {
          return res.status(503).json({ message: usable.reason });
        }
        if (!isExtensionAllowed(req.file.originalname, usable.config.allowed)) {
          return res.status(400).json({
            message: `File type not allowed. Allowed extensions: ${usable.config.allowed!.join(", ")}`,
          });
        }

        const accessContext = await buildContext(req);
        const uploaderId = accessContext.user?.id;
        if (!uploaderId) {
          return res.status(401).json({ message: "Could not determine the current user for this upload. Please sign in again." });
        }

        const tokenValues = await context.resolveTokens(req.params.entityId);
        const directory = expandDirectoryTemplate(usable.config.directory, tokenValues);
        const safeName = req.file.originalname.split(/[/\\]/).pop() || "file";
        const customPath = `${directory ? directory + "/" : ""}${Date.now()}-${safeName.replace(/[^\w.\-]+/g, "_").slice(0, 200)}`;

        const uploadResult = await fileSystemService.upload({
          fileSystemId: usable.config.file_system,
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          customPath,
        });

        const displayName =
          typeof req.body?.name === "string" && req.body.name.trim()
            ? req.body.name.trim().slice(0, 255)
            : req.file.originalname.slice(0, 255);

        const fileData = insertFileSchema.parse({
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: req.file.mimetype,
          size: uploadResult.size,
          uploadedBy: uploaderId,
          entityType: `entity-files:${context.id}`,
          entityId: req.params.entityId,
          fileSystemId: usable.config.file_system,
          metadata: null,
        });

        const record = await context.adapter.attach(
          req.params.entityId,
          fileData,
          displayName,
        );
        res.status(201).json(record);
      } catch (error) {
        logger.error("Entity file upload failed", {
          service: "entityFiles",
          context: req.params.context,
          error: error instanceof Error ? error.message : String(error),
        });
        if (error instanceof z.ZodError) {
          const fields = error.issues
            .map((issue) => (issue.path.length ? issue.path.join(".") : "(root)"))
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(", ");
          res.status(400).json({
            message: `The file record failed validation${fields ? ` (invalid or missing: ${fields})` : ""}. Please try again or contact an administrator.`,
          });
        } else if (error instanceof FileSystemNotConfiguredError) {
          res.status(503).json({ message: error.message });
        } else {
          res.status(500).json({ message: "Failed to upload file" });
        }
      }
    },
  );

  // Downloads go through the generic /api/files/:id/download route — the
  // file.read policy delegates to this context's access callback and the
  // download serves the attachment's display name (see
  // server/services/entity-files/file-read-access.ts and files.ts).

  // Rename / edit attachment data.
  app.patch(
    "/api/entity-files/:context/:entityId/:attachmentId",
    requireAuth,
    async (req, res) => {
      try {
        const context = await resolveContextAndAuthorize(req, res, "manage");
        if (!context) return;
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid update", errors: parsed.error.issues });
        }
        const record = await context.adapter.update(
          req.params.entityId,
          req.params.attachmentId,
          parsed.data,
        );
        if (!record) {
          return res.status(404).json({ message: "File not found" });
        }
        res.json(record);
      } catch (error) {
        logger.error("Entity file update failed", {
          service: "entityFiles",
          context: req.params.context,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to update file" });
      }
    },
  );

  // Delete: join row + files row in one transaction (adapter), bytes after
  // commit inside the storage method.
  app.delete(
    "/api/entity-files/:context/:entityId/:attachmentId",
    requireAuth,
    async (req, res) => {
      try {
        const context = await resolveContextAndAuthorize(req, res, "manage");
        if (!context) return;
        const removed = await context.adapter.remove(
          req.params.entityId,
          req.params.attachmentId,
        );
        if (!removed) {
          return res.status(404).json({ message: "File not found" });
        }
        res.json({ message: "File deleted successfully" });
      } catch (error) {
        logger.error("Entity file delete failed", {
          service: "entityFiles",
          context: req.params.context,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ message: "Failed to delete file" });
      }
    },
  );
}
