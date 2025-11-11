import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { insertWizardSchema, wizardDataSchema, type WizardData } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { wizardRegistry } from "../wizards/index.js";
import { FeedWizard } from "../wizards/feed.js";
import { objectStorageService } from "../services/objectStorage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerWizardRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  app.get("/api/wizard-types", requireAccess(policies.admin), async (req, res) => {
    try {
      const types = wizardRegistry.getAll().map(type => ({
        name: type.name,
        displayName: type.displayName,
        description: type.description,
        isFeed: type.isFeed,
        entityType: type.entityType
      }));
      res.json(types);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard types" });
    }
  });

  app.get("/api/wizard-types/:typeName/steps", requireAccess(policies.admin), async (req, res) => {
    try {
      const { typeName } = req.params;
      const steps = await wizardRegistry.getStepsForType(typeName);
      res.json(steps);
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Wizard type not found" });
    }
  });

  app.get("/api/wizard-types/:typeName/statuses", requireAccess(policies.admin), async (req, res) => {
    try {
      const { typeName } = req.params;
      const statuses = await wizardRegistry.getStatusesForType(typeName);
      res.json(statuses);
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Wizard type not found" });
    }
  });

  app.get("/api/wizards", requireAccess(policies.admin), async (req, res) => {
    try {
      const { type, status, entityId } = req.query;
      
      const filters: { type?: string; status?: string; entityId?: string } = {};
      if (type) filters.type = type as string;
      if (status) filters.status = status as string;
      if (entityId) filters.entityId = entityId as string;

      const wizards = await storage.wizards.list(filters);
      res.json(wizards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizards" });
    }
  });

  app.get("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const wizard = await storage.wizards.getById(id);
      
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      res.json(wizard);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard" });
    }
  });

  app.post("/api/wizards", requireAccess(policies.admin), async (req, res) => {
    try {
      const validatedData = insertWizardSchema.parse(req.body);
      
      const typeValidation = await wizardRegistry.validateType(validatedData.type);
      if (!typeValidation.valid) {
        return res.status(400).json({ message: typeValidation.error });
      }
      
      if (!validatedData.currentStep) {
        const steps = await wizardRegistry.getStepsForType(validatedData.type);
        if (steps && steps.length > 0) {
          validatedData.currentStep = steps[0].id;
          
          const wizardData: WizardData = (validatedData.data as WizardData) || {};
          wizardData.progress = wizardData.progress || {};
          wizardData.progress[steps[0].id] = {
            status: 'in_progress',
          };
          validatedData.data = wizardData;
        }
      }
      
      const wizard = await storage.wizards.create(validatedData);
      res.status(201).json(wizard);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid wizard data", error });
      } else {
        res.status(500).json({ message: "Failed to create wizard" });
      }
    }
  });

  app.patch("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const validatedData = insertWizardSchema.partial().parse(req.body);
      
      if (validatedData.type) {
        const typeValidation = await wizardRegistry.validateType(validatedData.type);
        if (!typeValidation.valid) {
          return res.status(400).json({ message: typeValidation.error });
        }
      }
      
      const wizard = await storage.wizards.update(id, validatedData);
      res.json(wizard);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid wizard data", error });
      } else {
        res.status(500).json({ message: "Failed to update wizard" });
      }
    }
  });

  app.delete("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const success = await storage.wizards.delete(id);
      if (!success) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete wizard" });
    }
  });

  app.post("/api/wizards/:id/steps/next", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const { payload } = req.body;
      
      const wizard = await storage.wizards.getById(id);
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const steps = await wizardRegistry.getStepsForType(wizard.type);
      
      const currentStepId = wizard.currentStep || steps[0]?.id;
      if (!currentStepId) {
        return res.status(400).json({ message: "No steps available for this wizard type" });
      }
      
      const currentIndex = steps.findIndex(s => s.id === currentStepId);
      
      if (currentIndex === -1) {
        return res.status(400).json({ message: "Current step not found in wizard type" });
      }
      
      if (currentIndex >= steps.length - 1) {
        return res.status(400).json({ message: "Already on last step" });
      }

      const nextStep = steps[currentIndex + 1];
      
      const wizardData: WizardData = (wizard.data as WizardData) || {};
      const progress = wizardData.progress || {};
      
      progress[currentStepId] = {
        status: 'completed',
        completedAt: new Date().toISOString(),
        payload: payload || progress[currentStepId]?.payload,
      };
      
      progress[nextStep.id] = {
        status: 'in_progress',
      };

      const updatedWizard = await storage.wizards.update(id, {
        currentStep: nextStep.id,
        data: { ...wizardData, progress },
      });

      res.json(updatedWizard);
    } catch (error) {
      res.status(500).json({ message: "Failed to navigate to next step" });
    }
  });

  app.post("/api/wizards/:id/steps/previous", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const wizard = await storage.wizards.getById(id);
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const steps = await wizardRegistry.getStepsForType(wizard.type);
      
      const currentStepId = wizard.currentStep || steps[0]?.id;
      if (!currentStepId) {
        return res.status(400).json({ message: "No steps available for this wizard type" });
      }
      
      const currentIndex = steps.findIndex(s => s.id === currentStepId);
      
      if (currentIndex === -1) {
        return res.status(400).json({ message: "Current step not found in wizard type" });
      }
      
      if (currentIndex <= 0) {
        return res.status(400).json({ message: "Already on first step" });
      }

      const previousStep = steps[currentIndex - 1];
      
      const wizardData: WizardData = (wizard.data as WizardData) || {};
      const progress = wizardData.progress || {};
      
      if (progress[currentStepId]) {
        progress[currentStepId] = {
          status: 'pending',
        };
      }
      
      progress[previousStep.id] = {
        ...progress[previousStep.id],
        status: 'in_progress',
        completedAt: undefined,
      };

      const updatedWizard = await storage.wizards.update(id, {
        currentStep: previousStep.id,
        data: { ...wizardData, progress },
      });

      res.json(updatedWizard);
    } catch (error) {
      res.status(500).json({ message: "Failed to navigate to previous step" });
    }
  });

  // File upload for wizards
  app.post("/api/wizards/:id/files",
    upload.single('file'),
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { id } = req.params;
        
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const wizard = await storage.wizards.getById(id);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        // Get wizard type instance to validate file and associate
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support file uploads" });
        }

        // Validate file type
        const allowedMimeTypes = [
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];

        if (req.file.mimetype && !allowedMimeTypes.includes(req.file.mimetype)) {
          return res.status(400).json({ message: "Invalid file type. Only CSV and XLSX files are supported." });
        }

        // Upload file to object storage
        const storagePath = `wizards/${id}/${Date.now()}_${req.file.originalname}`;
        const uploadResult = await objectStorageService.uploadFile(
          req.file.buffer,
          storagePath,
          {
            contentType: req.file.mimetype,
            metadata: {
              originalName: req.file.originalname,
              wizardId: id
            }
          }
        );

        // Get current user for uploadedBy
        const user = (req as any).user;
        const session = req.session as any;
        const replitUserId = user?.claims?.sub;
        const dbUser = await storage.users.getUserByReplitId(replitUserId);

        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        // Associate file with wizard using FeedWizard method
        const file = await wizardType.associateFile(id, {
          fileName: req.file.originalname,
          storagePath: uploadResult.path,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedBy: dbUser.id,
          entityType: wizard.entityType || 'wizard',
          entityId: wizard.entityId || id,
          accessLevel: 'private'
        });

        res.status(201).json(file);
      } catch (error) {
        console.error("File upload error:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to upload file" });
      }
    }
  );

  // List files for a wizard
  app.get("/api/wizards/:id/files",
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { id } = req.params;

        const wizard = await storage.wizards.getById(id);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support file uploads" });
        }

        const files = await wizardType.getAssociatedFiles(id);
        res.json(files);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch files" });
      }
    }
  );

  // Delete a file from a wizard
  app.delete("/api/wizards/:id/files/:fileId",
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { id, fileId } = req.params;

        const wizard = await storage.wizards.getById(id);
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support file uploads" });
        }

        // Verify file association BEFORE deleting from object storage
        const file = await storage.files.getById(fileId);
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        const metadata = file.metadata as any;
        if (metadata?.wizardId !== id) {
          return res.status(403).json({ message: "File is not associated with this wizard" });
        }

        // Now safe to delete from object storage
        await objectStorageService.deleteFile(file.storagePath);

        // Delete from database and update wizard data
        const success = await wizardType.deleteAssociatedFile(fileId, id);
        if (!success) {
          return res.status(404).json({ message: "Failed to delete file record" });
        }

        res.status(204).send();
      } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to delete file" });
      }
    }
  );
}
