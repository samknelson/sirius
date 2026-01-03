import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertFileSchema } from "@shared/schema";
import { requireAccess, checkAccess, buildContext } from "../accessControl";
import { objectStorageService } from "../services/objectStorage";
import multer from "multer";
import { logger } from "../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  }
});

export function registerFileRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  app.post("/api/files", 
    upload.single('file'),
    requireAuth,
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const { entityType, entityId, accessLevel = 'private', metadata } = req.body;
        
        if (!req.user) {
          return res.status(401).json({ message: "Authentication required" });
        }

        const context = await buildContext(req);
        
        // Check access based on entity type and id if provided
        // This allows users to upload files to entities they can edit
        if (entityType && entityId) {
          let policyToCheck: string | null = null;
          
          // Map entity types to their edit policies
          if (entityType === 'esig') {
            policyToCheck = 'esig.edit';
          } else if (entityType === 'cardcheck') {
            policyToCheck = 'cardcheck.edit';
          } else if (entityType === 'worker') {
            policyToCheck = 'worker.edit';
          } else if (entityType === 'employer') {
            policyToCheck = 'employer.view'; // employers may have different rules
          }
          // Add more entity types as needed
          
          if (policyToCheck) {
            const accessResult = await checkAccess(policyToCheck, context.user, entityId);
            if (!accessResult.granted) {
              logger.warn('File upload denied - insufficient entity access', {
                service: 'files',
                userId: (req.user as any).id,
                entityType,
                entityId,
                policy: policyToCheck,
              });
              return res.status(403).json({ message: "Insufficient permissions to upload to this entity" });
            }
          }
        } else {
          // No entity context - fall back to files.upload permission check
          const hasUploadPermission = await checkAccess('files.upload', context.user);
          if (!hasUploadPermission.granted) {
            return res.status(403).json({ message: "Insufficient permissions to upload files" });
          }
        }

        const uploadResult = await objectStorageService.uploadFile({
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          accessLevel: accessLevel as 'public' | 'private',
        });

        const fileData = {
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: req.file.mimetype,
          size: uploadResult.size,
          uploadedBy: (req.user as any).id,
          entityType: entityType || null,
          entityId: entityId || null,
          accessLevel: accessLevel,
          metadata: metadata ? JSON.parse(metadata) : null,
        };

        const validatedData = insertFileSchema.parse(fileData);
        const file = await storage.files.create(validatedData);
        
        res.status(201).json(file);
      } catch (error) {
        console.error('File upload error:', error);
        if (error instanceof Error && error.name === "ZodError") {
          res.status(400).json({ message: "Invalid file data", error });
        } else {
          res.status(500).json({ message: "Failed to upload file" });
        }
      }
    }
  );

  app.get("/api/files", requireAuth, async (req, res) => {
    try {
      const { entityType, entityId, uploadedBy } = req.query;
      
      const filters: { entityType?: string; entityId?: string; uploadedBy?: string } = {};
      if (entityType) filters.entityType = entityType as string;
      if (entityId) filters.entityId = entityId as string;
      if (uploadedBy) filters.uploadedBy = uploadedBy as string;

      const files = await storage.files.list(filters);
      
      const filteredFiles = [];
      const context = await buildContext(req);
      for (const file of files) {
        try {
          const result = await checkAccess('file.read', context.user, file.id);
          if (result.granted) {
            filteredFiles.push(file);
          }
        } catch (e) {
        }
      }
      
      res.json(filteredFiles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.get("/api/files/:id", requireAccess('file.read'), async (req, res) => {
    try {
      const { id } = req.params;
      const file = await storage.files.getById(id);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      res.json(file);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch file" });
    }
  });

  app.get("/api/files/:id/download", requireAccess('file.read'), async (req, res) => {
    try {
      const { id } = req.params;
      const file = await storage.files.getById(id);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const fileContent = await objectStorageService.downloadFile(file.storagePath);
      
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('Content-Length', file.size);
      res.send(fileContent);
    } catch (error) {
      console.error('File download error:', error);
      res.status(500).json({ message: "Failed to download file" });
    }
  });

  app.get("/api/files/:id/url", requireAccess('file.read'), async (req, res) => {
    try {
      const { id } = req.params;
      const { expiresIn = 3600 } = req.query;
      
      const file = await storage.files.getById(id);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      const url = await objectStorageService.generateSignedUrl(
        file.storagePath, 
        parseInt(expiresIn as string)
      );
      
      res.json({ url, expiresIn });
    } catch (error) {
      console.error('Generate signed URL error:', error);
      res.status(500).json({ message: "Failed to generate signed URL" });
    }
  });

  app.patch("/api/files/:id", requireAccess('file.update'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.files.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "File not found" });
      }

      const allowedUpdates = ['metadata', 'accessLevel'];
      const updates: any = {};
      for (const key of allowedUpdates) {
        if (req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      }

      if (updates.accessLevel && !['public', 'private'].includes(updates.accessLevel)) {
        return res.status(400).json({ message: "Invalid accessLevel. Must be 'public' or 'private'" });
      }

      const validatedData = insertFileSchema.partial().parse(updates);
      const file = await storage.files.update(id, validatedData);
      
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      res.json(file);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid file data", error });
      } else {
        res.status(500).json({ message: "Failed to update file" });
      }
    }
  });

  app.delete("/api/files/:id", requireAccess('file.delete'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.files.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "File not found" });
      }

      await objectStorageService.deleteFile(existing.storagePath);
      
      const deleted = await storage.files.delete(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "File not found" });
      }

      res.json({ message: "File deleted successfully" });
    } catch (error) {
      console.error('File deletion error:', error);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });
}
