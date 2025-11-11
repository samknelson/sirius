import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { insertWizardSchema, wizardDataSchema, type WizardData } from "@shared/schema";
import { requireAccess, buildContext, evaluatePolicy } from "../accessControl";
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

  app.get("/api/wizard-types/:typeName/fields", requireAccess(policies.admin), async (req, res) => {
    try {
      const { typeName } = req.params;
      const fields = await wizardRegistry.getFieldsForType(typeName);
      res.json(fields);
    } catch (error) {
      if (error instanceof Error && error.name === 'WizardFieldsUnsupportedError') {
        return res.status(400).json({ message: error.message });
      }
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

  // Helper function to evaluate if a step is complete
  async function isStepComplete(wizard: any, stepId: string): Promise<boolean> {
    const wizardData = wizard.data || {};
    
    // Upload step validation
    if (stepId === 'upload') {
      if (!wizardData.uploadedFileId) return false;
      const files = await storage.files.list({ entityType: 'wizard', entityId: wizard.id });
      return files.length > 0;
    }
    
    // Map step validation
    if (stepId === 'map') {
      const mode = wizardData.mode || 'create';
      const columnMapping = wizardData.columnMapping || {};
      
      try {
        const fields = await wizardRegistry.getFieldsForType(wizard.type);
        
        // Get required fields based on mode
        const requiredFields = fields.filter((f: any) => {
          if (f.required) return true;
          if (mode === 'create' && f.requiredForCreate) return true;
          if (mode === 'update' && f.requiredForUpdate) return true;
          return false;
        });
        
        // If no required fields, step is complete
        if (requiredFields.length === 0) return true;
        
        // Check if all required fields are mapped
        const mappedValues = Object.values(columnMapping).filter(v => v && v !== '_unmapped');
        const mappedRequiredFields = requiredFields.filter((f: any) => mappedValues.includes(f.id));
        
        return requiredFields.length === mappedRequiredFields.length;
      } catch (error) {
        // If fields aren't available (not a feed wizard), consider step complete
        return true;
      }
    }
    
    // Validate step validation
    if (stepId === 'validate') {
      const validationResults = wizardData.validationResults;
      
      // Validation must have been run
      if (!validationResults) return false;
      
      // All rows must be valid (no invalid rows)
      return validationResults.invalidRows === 0;
    }
    
    // Other steps are always considered complete
    return true;
  }

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

      // Validate current step is complete before advancing
      const stepComplete = await isStepComplete(wizard, currentStepId);
      if (!stepComplete) {
        return res.status(400).json({ 
          message: "Cannot proceed to next step. Please complete all required items in the current step." 
        });
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

  // Middleware to check wizard access based on entity type
  const checkWizardAccess = async (req: any, res: any, next: any) => {
    try {
      const { id } = req.params;
      const wizard = await storage.wizards.getById(id);
      
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      // Get wizard type to determine entityType
      const wizardType = wizardRegistry.get(wizard.type);
      if (!wizardType) {
        return res.status(400).json({ message: "Invalid wizard type" });
      }

      // Build context for policy evaluation
      const context = await buildContext(req);
      
      // Check if user is admin first (admins can access all wizards)
      const adminResult = await evaluatePolicy(policies.admin, context);
      if (adminResult.granted) {
        req.wizard = wizard; // Attach wizard to request for use in handler
        return next();
      }

      // For entity-specific wizards, check entity-based access
      if (wizardType.entityType && wizard.entityId) {
        // Build context with entity ID in params
        const entityContext = {
          ...context,
          params: {
            ...context.params,
            [wizardType.entityType === 'employer' ? 'employerId' : 'workerId']: wizard.entityId
          }
        };

        // Check appropriate policy based on entity type
        const policy = wizardType.entityType === 'employer' ? policies.employerUser : policies.worker;
        const result = await evaluatePolicy(policy, entityContext);
        
        if (result.granted) {
          req.wizard = wizard; // Attach wizard to request for use in handler
          return next();
        }
      }

      // Access denied
      return res.status(403).json({ message: "Access denied" });
    } catch (error) {
      console.error("Error checking wizard access:", error);
      return res.status(500).json({ message: "Failed to check wizard access" });
    }
  };

  // File upload for wizards
  app.post("/api/wizards/:id/files",
    upload.single('file'),
    checkWizardAccess,
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        // Wizard is already attached to request by middleware
        const wizard = (req as any).wizard;

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

        // Get wizard ID from params
        const wizardId = req.params.id;
        
        // Get wizard type to determine entityType
        const wizardTypeInstance = wizardRegistry.get(wizard.type);
        
        // Upload file to object storage
        const customPath = `wizards/${wizardId}/${Date.now()}_${req.file.originalname}`;
        const uploadResult = await objectStorageService.uploadFile({
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          accessLevel: 'private',
          customPath
        });

        // Get current user for uploadedBy
        const user = (req as any).user;
        const session = req.session as any;
        const replitUserId = user?.claims?.sub;
        const dbUser = await storage.users.getUserByReplitId(replitUserId);

        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        // Associate file with wizard using FeedWizard method
        const file = await wizardType.associateFile(wizardId, {
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadedBy: dbUser.id,
          entityType: wizardTypeInstance?.entityType || 'wizard',
          entityId: wizard.entityId || wizardId,
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
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        
        // Wizard is already attached to request by middleware
        const wizard = (req as any).wizard;

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

  // Parse uploaded file to extract column information
  app.get("/api/wizards/:id/files/:fileId/parse",
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id, fileId } = req.params;
        const { previewRows = '5' } = req.query;
        
        // Wizard is already attached to request by middleware
        const wizard = (req as any).wizard;

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support file uploads" });
        }

        // Get file metadata
        const file = await storage.files.getById(fileId);
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        // Verify file association
        const metadata = file.metadata as any;
        if (metadata?.wizardId !== id) {
          return res.status(403).json({ message: "File is not associated with this wizard" });
        }

        // Download file from object storage
        const fileBuffer = await objectStorageService.downloadFile(file.storagePath);

        // Parse file based on type
        let rows: any[][] = [];
        const rowLimit = parseInt(previewRows as string) || 5;

        if (file.mimeType === 'text/csv') {
          // Parse CSV
          const { parse } = await import('csv-parse/sync');
          rows = parse(fileBuffer, {
            relax_column_count: true,
            skip_empty_lines: true,
            to: rowLimit + 1 // +1 to include potential header row
          });
        } else if (
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          file.mimeType === 'application/vnd.ms-excel'
        ) {
          // Parse XLSX
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
            header: 1,
            defval: '',
            blankrows: false,
            range: `A1:ZZ${rowLimit + 1}` // Limit to preview rows
          });
          rows = jsonData as any[][];
        } else {
          return res.status(400).json({ message: "Unsupported file type for parsing" });
        }

        // Return parsed data
        res.json({
          fileName: file.fileName,
          totalRows: rows.length,
          previewRows: rows.slice(0, rowLimit + 1),
          columnCount: rows[0]?.length || 0
        });
      } catch (error) {
        console.error("File parse error:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to parse file" });
      }
    }
  );

  // Validate wizard data with SSE for progress tracking
  app.get("/api/wizards/:id/validate",
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        const wizard = (req as any).wizard;

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support validation" });
        }

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send initial event
        res.write(`data: ${JSON.stringify({ type: 'start', message: 'Starting validation...' })}\n\n`);

        // Run validation with progress callback
        try {
          const results = await wizardType.validateFeedData(
            id,
            100, // batch size
            (progress) => {
              // Send progress event
              res.write(`data: ${JSON.stringify({ 
                type: 'progress', 
                ...progress 
              })}\n\n`);
            }
          );

          // Send completion event
          res.write(`data: ${JSON.stringify({ 
            type: 'complete', 
            results 
          })}\n\n`);
          res.end();
        } catch (validationError) {
          // Send error event
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: validationError instanceof Error ? validationError.message : 'Validation failed' 
          })}\n\n`);
          res.end();
        }
      } catch (error) {
        console.error("Validation error:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: error instanceof Error ? error.message : "Failed to start validation" });
        } else {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error instanceof Error ? error.message : 'Validation failed' 
          })}\n\n`);
          res.end();
        }
      }
    }
  );

  // Delete a file from a wizard
  app.delete("/api/wizards/:id/files/:fileId",
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id, fileId } = req.params;
        
        // Wizard is already attached to request by middleware
        const wizard = (req as any).wizard;

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
