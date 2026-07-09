import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { objectStorageService } from "../../../services/objectStorage";
import { insertFileSchema } from "@shared/schema";
import {
  createBaoRateSourceRequestSchema,
  updateBaoRateSourceRequestSchema,
  type BaoRateSourceWithDetails,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "BAO rate source tables do not exist. Please enable the BAO component first.";

export const BAO_RATE_SOURCE_FILE_ENTITY_TYPE = "bao_rate_source";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const ATTACHMENT_MIME_RE = /^(image\/.+|application\/pdf)$/;

export function registerBaoRateSourcesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const sourcesStorage = storage.baoRateSources;
  const componentMiddleware = requireComponent("sitespecific.bao");

  async function attachmentCounts(sourceIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (sourceIds.length === 0) return counts;
    const files = await storage.files.list({ entityType: BAO_RATE_SOURCE_FILE_ENTITY_TYPE });
    for (const file of files) {
      if (file.entityId && sourceIds.includes(file.entityId)) {
        counts.set(file.entityId, (counts.get(file.entityId) ?? 0) + 1);
      }
    }
    return counts;
  }

  app.get(
    "/api/sitespecific/bao/rate-sources",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (_req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const sources = await sourcesStorage.list();
        const counts = await attachmentCounts(sources.map((s) => s.id));
        const result: BaoRateSourceWithDetails[] = sources.map((s) => ({
          ...s,
          attachmentCount: counts.get(s.id) ?? 0,
        }));
        res.json(result);
      } catch (error) {
        console.error("Failed to list BAO rate sources:", error);
        res.status(500).json({ message: "Failed to list rate sources" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/rate-sources/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const source = await sourcesStorage.get(req.params.id);
        if (!source) {
          return res.status(404).json({ message: "Rate source not found" });
        }
        const counts = await attachmentCounts([source.id]);
        res.json({ ...source, attachmentCount: counts.get(source.id) ?? 0 });
      } catch (error) {
        console.error("Failed to fetch BAO rate source:", error);
        res.status(500).json({ message: "Failed to fetch rate source" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/rate-sources",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const parsed = createBaoRateSourceRequestSchema.parse(req.body);
        const source = await sourcesStorage.create(
          { name: parsed.name, type: parsed.type, startYmd: parsed.startYmd },
          parsed.employerIds,
        );
        res.status(201).json({ ...source, attachmentCount: 0 });
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown employer" });
        }
        console.error("Failed to create BAO rate source:", error);
        res.status(500).json({ message: "Failed to create rate source" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/rate-sources/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoRateSourceRequestSchema.parse(req.body);
        const { employerIds, ...fields } = parsed;
        const source = await sourcesStorage.update(req.params.id, fields, employerIds);
        if (!source) {
          return res.status(404).json({ message: "Rate source not found" });
        }
        const counts = await attachmentCounts([source.id]);
        res.json({ ...source, attachmentCount: counts.get(source.id) ?? 0 });
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown employer" });
        }
        console.error("Failed to update BAO rate source:", error);
        res.status(500).json({ message: "Failed to update rate source" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/rate-sources/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const result = await sourcesStorage.delete(req.params.id);
        if (result.referenced) {
          return res.status(409).json({
            message:
              "This source still has rate entries attached to it. Reassign or delete those rate entries first.",
          });
        }
        if (!result.deleted) {
          return res.status(404).json({ message: "Rate source not found" });
        }
        // Clean up attachments (files are shared per source, so they go with it).
        const files = await storage.files.list({
          entityType: BAO_RATE_SOURCE_FILE_ENTITY_TYPE,
          entityId: req.params.id,
        });
        for (const file of files) {
          try {
            await objectStorageService.deleteFile(file.storagePath);
          } catch (e) {
            console.error("Failed to delete rate source attachment blob:", e);
          }
          await storage.files.delete(file.id);
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete BAO rate source:", error);
        res.status(500).json({ message: "Failed to delete rate source" });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Attachments (shared per source — every employer association sees the
  // same files).
  // -------------------------------------------------------------------------

  app.get(
    "/api/sitespecific/bao/rate-sources/:id/attachments",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const source = await sourcesStorage.get(req.params.id);
        if (!source) {
          return res.status(404).json({ message: "Rate source not found" });
        }
        const files = await storage.files.list({
          entityType: BAO_RATE_SOURCE_FILE_ENTITY_TYPE,
          entityId: req.params.id,
        });
        res.json(files);
      } catch (error) {
        console.error("Failed to list BAO rate source attachments:", error);
        res.status(500).json({ message: "Failed to list attachments" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/rate-sources/:id/attachments",
    upload.single("file"),
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await sourcesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const source = await sourcesStorage.get(req.params.id);
        if (!source) {
          return res.status(404).json({ message: "Rate source not found" });
        }
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }
        if (!ATTACHMENT_MIME_RE.test(req.file.mimetype)) {
          return res.status(400).json({
            message: `File type ${req.file.mimetype} is not allowed. Allowed: image/* or application/pdf.`,
          });
        }

        const uploadResult = await objectStorageService.uploadFile({
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          accessLevel: "private",
        });

        const fileData = insertFileSchema.parse({
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: req.file.mimetype,
          size: uploadResult.size,
          uploadedBy: (req.user as any)?.id,
          entityType: BAO_RATE_SOURCE_FILE_ENTITY_TYPE,
          entityId: req.params.id,
          accessLevel: "private",
          metadata: null,
        });
        const file = await storage.files.create(fileData);
        res.status(201).json(file);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid file data", errors: error.errors });
        }
        console.error("Failed to upload BAO rate source attachment:", error);
        res.status(500).json({ message: "Failed to upload attachment" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/rate-sources/:id/attachments/:fileId/download",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const file = await storage.files.getById(req.params.fileId);
        if (
          !file ||
          file.entityType !== BAO_RATE_SOURCE_FILE_ENTITY_TYPE ||
          file.entityId !== req.params.id
        ) {
          return res.status(404).json({ message: "Attachment not found" });
        }
        const fileContent = await objectStorageService.downloadFile(file.storagePath);
        const safeName = file.fileName.replace(/"/g, "");
        const mime = file.mimeType || "application/octet-stream";
        const inlineEligible = mime.startsWith("image/") || mime === "application/pdf";
        const disposition = req.query.download === "1" || !inlineEligible ? "attachment" : "inline";
        res.setHeader("Content-Type", mime);
        res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
        res.setHeader("Content-Length", file.size);
        res.send(fileContent);
      } catch (error) {
        console.error("Failed to download BAO rate source attachment:", error);
        res.status(500).json({ message: "Failed to download attachment" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/rate-sources/:id/attachments/:fileId",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const file = await storage.files.getById(req.params.fileId);
        if (
          !file ||
          file.entityType !== BAO_RATE_SOURCE_FILE_ENTITY_TYPE ||
          file.entityId !== req.params.id
        ) {
          return res.status(404).json({ message: "Attachment not found" });
        }
        await objectStorageService.deleteFile(file.storagePath);
        await storage.files.delete(file.id);
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete BAO rate source attachment:", error);
        res.status(500).json({ message: "Failed to delete attachment" });
      }
    },
  );
}
