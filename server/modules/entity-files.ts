import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireAccess } from "../services/access-policy-evaluator";
import { isComponentEnabled } from "./components";
import { listFileSystemConfigs, FileSystemNotConfiguredError } from "../services/files";
import {
  getEntityFileContext,
  type EntityFileContext,
  type EntityFilesVerb,
} from "../services/entity-files/registry";
import { readCatalogDeclaration } from "@shared/catalog";
import { catalogViewerForCatalog } from "../services/catalog-viewer";
import { ENTITY_FILE_AREAS_CATALOG } from "../services/entity-files/catalog";
import {
  getEntityFilesContextConfig,
  resolveUsableContextConfig,
  ENTITY_FILES_DIRECTORY_TOKEN,
} from "../services/entity-files/config";
import { storage } from "../storage";
import { logger } from "../logger";
import { z } from "zod";
import { uploadEntityAttachment } from "../services/entity-files/upload";
import { AttachmentError } from "../services/entity-files/template-assets";
import { getEffectiveUser } from "./masquerade";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    data: z.unknown().optional(),
    // null clears the type; absent leaves it alone.
    typeId: z.string().min(1).nullable().optional(),
  })
  .strict();

/**
 * Validate that a file type exists and applies to the given context. The
 * dropdown already filters by record type, but a hand-made request must not be
 * able to pair a type with a record type it does not declare.
 *
 * A type is OPTIONAL: null / undefined is always fine.
 */
async function checkFileType(
  typeId: string | null | undefined,
  context: EntityFileContext,
): Promise<{ status: number; message: string } | null> {
  if (typeId === null || typeId === undefined) return null;
  // Adapter-backed contexts (fork extension) keep their own document
  // classification (e.g. DC docType) and carry no file type.
  if (context.adapter) {
    return { status: 400, message: `${context.recordLabel} documents do not take a file type` };
  }
  const optionsStorage = (await import("./options-registry")).getOptionsStorage();
  const fileType = await optionsStorage.get("file-type", typeId);
  if (!fileType) {
    return { status: 400, message: "Unknown file type" };
  }
  const contextIds = (fileType.data as { contextIds?: unknown } | null)?.contextIds;
  const applies = Array.isArray(contextIds) && contextIds.includes(context.id);
  if (!applies) {
    return {
      status: 400,
      message: `File type "${fileType.name}" does not apply to ${context.recordLabel} records`,
    };
  }
  return null;
}

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
  // current config), the available filesystems, and the ONE directory token
  // the framework expands — the page should not hardcode its spelling.
  app.get(
    "/api/entity-files/contexts",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        // The declaration, not the offer: this page configures areas, so it
        // lists one whose component is switched off and says so on the row,
        // rather than dropping it. Whether each component is on is asked
        // separately — that is configured state, which a catalog never reports.
        const viewer = await catalogViewerForCatalog(req, ENTITY_FILE_AREAS_CATALOG);
        const declared = readCatalogDeclaration(ENTITY_FILE_AREAS_CATALOG, viewer);
        if (!declared.ok) {
          return res.status(declared.reason === "unknown" ? 500 : 403).json({
            message: declared.message,
          });
        }

        const contexts = await Promise.all(
          declared.catalog.entries.map(async (entry) => {
            const context = getEntityFileContext(entry.id);
            return {
              id: entry.id,
              label: entry.name,
              component: entry.component ?? null,
              componentEnabled: entry.component
                ? await isComponentEnabled(entry.component)
                : true,
              // BAO fork extension: extra directory tokens this context expands
              // (may include the framework token when the context redefines it).
              tokens: context?.tokens ?? [],
              publishedAsset: context?.publishedAsset ?? false,
              config: (await getEntityFilesContextConfig(entry.id)) ?? null,
            };
          }),
        );
        const fileSystems = listFileSystemConfigs().map((fs) => ({
          id: fs.id,
          access: fs.access,
        }));
        res.json({ contexts, fileSystems, directoryToken: ENTITY_FILES_DIRECTORY_TOKEN });
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
        context.adapter
          ? context.adapter.list(req.params.entityId)
          : storage.entityFiles.list(context.id, req.params.entityId),
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
  // object), then files row + attachment row in ONE transaction.
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
        // Multipart carries everything as a string; an empty field means
        // "no type". Checked BEFORE any bytes are uploaded.
        const rawTypeId = typeof req.body?.typeId === "string" ? req.body.typeId.trim() : "";
        const typeId = rawTypeId === "" ? null : rawTypeId;
        const typeError = await checkFileType(typeId, context);
        if (typeError) {
          return res.status(typeError.status).json({ message: typeError.message });
        }

        const { dbUser } = await getEffectiveUser(req.session ?? {}, req.user);
        const uploaderId = dbUser?.id;
        if (!uploaderId || !dbUser.isActive) {
          return res.status(401).json({ message: "Could not determine the current user for this upload. Please sign in again." });
        }
        const record = await uploadEntityAttachment({
          context, entityId: req.params.entityId, file: req.file,
          uploadedBy: uploaderId, typeId,
          name: typeof req.body?.name === "string" ? req.body.name : undefined,
        });
        res.status(201).json(record);
      } catch (error) {
        if (error instanceof AttachmentError) return res.status(error.status).json({ message: error.message });
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
        if (context.publishedAsset) return res.status(409).json({ message: "Published template images are retained and immutable." });
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid update", errors: parsed.error.issues });
        }
        const typeError = await checkFileType(parsed.data.typeId, context);
        if (typeError) {
          return res.status(typeError.status).json({ message: typeError.message });
        }
        const record = context.adapter
          ? await context.adapter.update(req.params.entityId, req.params.attachmentId, parsed.data)
          : await storage.entityFiles.update(
              context.id,
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

  // Delete: attachment row + files row in one transaction, bytes after
  // commit inside the storage method.
  app.delete(
    "/api/entity-files/:context/:entityId/:attachmentId",
    requireAuth,
    async (req, res) => {
      try {
        const context = await resolveContextAndAuthorize(req, res, "manage");
        if (!context) return;
        if (context.publishedAsset) return res.status(409).json({ message: "Published template images are retained and immutable." });
        const removed = context.adapter
          ? await context.adapter.remove(req.params.entityId, req.params.attachmentId)
          : await storage.entityFiles.deleteWithFile(
              context.id,
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
