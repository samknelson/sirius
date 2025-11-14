import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { insertWizardSchema, wizardDataSchema, type WizardData, wizards, wizardEmployerMonthly } from "@shared/schema";
import { requireAccess, buildContext, evaluatePolicy } from "../accessControl";
import { policies } from "../policies";
import { wizardRegistry } from "../wizards/index.js";
import { FeedWizard } from "../wizards/feed.js";
import { objectStorageService } from "../services/objectStorage.js";
import { hashHeaderRow } from "../utils/hash.js";
import { db } from "../db";
import { eq, and, or } from "drizzle-orm";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'HttpError';
  }
}

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
        isMonthly: type.isMonthly,
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

  app.get("/api/wizard-types/:typeName/launch-arguments", requireAccess(policies.admin), async (req, res) => {
    try {
      const { typeName } = req.params;
      const launchArguments = await wizardRegistry.getLaunchArgumentsForType(typeName);
      res.json(launchArguments);
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

  app.get("/api/wizards/employer-monthly/by-period", requireAccess(policies.admin), async (req, res) => {
    try {
      const { year, month } = req.query;
      
      // Validate year and month parameters
      const yearNum = Number(year);
      const monthNum = Number(month);
      
      if (!year || !month || !Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ message: "Valid year and month parameters are required" });
      }
      
      const monthlyWizards = await storage.wizardEmployerMonthly.listByPeriod(yearNum, monthNum);
      res.json(monthlyWizards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer monthly wizards" });
    }
  });

  app.get("/api/wizards/employer-monthly/employers", requireAccess(policies.admin), async (req, res) => {
    try {
      const { year, month, wizardType } = req.query;
      
      // Validate parameters
      const yearNum = Number(year);
      const monthNum = Number(month);
      
      if (!year || !month || !wizardType) {
        return res.status(400).json({ message: "Year, month, and wizardType parameters are required" });
      }
      
      if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
        return res.status(400).json({ message: "Year must be a valid integer between 1900 and 2100" });
      }
      
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ message: "Month must be a valid integer between 1 and 12" });
      }
      
      if (typeof wizardType !== 'string' || wizardType.trim() === '') {
        return res.status(400).json({ message: "Wizard type must be a non-empty string" });
      }
      
      const employersWithUploads = await storage.wizardEmployerMonthly.listAllEmployersWithUploadsForRange(
        yearNum, 
        monthNum, 
        wizardType as string
      );
      res.json(employersWithUploads);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employers with monthly uploads" });
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
      
      // Validate launch arguments if the wizard type defines them
      const launchArguments = await wizardRegistry.getLaunchArgumentsForType(validatedData.type);
      if (launchArguments && launchArguments.length > 0) {
        const wizardData = validatedData.data as any;
        const providedArgs = wizardData?.launchArguments || {};
        
        for (const arg of launchArguments) {
          if (arg.required) {
            const value = providedArgs[arg.id];
            if (value === undefined || value === null || value === '' || value === 0) {
              return res.status(400).json({ 
                message: `Required launch argument '${arg.name}' is missing or invalid` 
              });
            }
          }
        }
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
      
      // Create wizard and wizard_employer_monthly record in a transaction if needed
      const isMonthlyWizard = wizardRegistry.isMonthlyWizard(validatedData.type);
      
      // Pre-validate monthly wizard requirements before starting transaction
      if (isMonthlyWizard) {
        // Ensure entityId is present
        if (!validatedData.entityId) {
          return res.status(400).json({ 
            message: "Entity ID is required for monthly employer wizards" 
          });
        }
        
        // Ensure data and launchArguments structure exists
        const wizardData = validatedData.data as any;
        if (!wizardData || typeof wizardData !== 'object') {
          return res.status(400).json({ 
            message: "Wizard data is required for monthly employer wizards" 
          });
        }
        
        if (!wizardData.launchArguments || typeof wizardData.launchArguments !== 'object') {
          return res.status(400).json({ 
            message: "Launch arguments are required for monthly employer wizards" 
          });
        }
        
        // Validate year and month from launch arguments
        const launchArgs = wizardData.launchArguments;
        
        if (launchArgs.year === undefined || launchArgs.year === null) {
          return res.status(400).json({ 
            message: "Year is required in launch arguments for monthly employer wizards" 
          });
        }
        
        if (launchArgs.month === undefined || launchArgs.month === null) {
          return res.status(400).json({ 
            message: "Month is required in launch arguments for monthly employer wizards" 
          });
        }
        
        const year = Number(launchArgs.year);
        const month = Number(launchArgs.month);
        
        if (!Number.isInteger(year) || year < 1900 || year > 2100) {
          return res.status(400).json({ 
            message: "Year must be a valid integer between 1900 and 2100" 
          });
        }
        
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return res.status(400).json({ 
            message: "Month must be an integer between 1 and 12" 
          });
        }
        
        // Type-specific constraint validation
        if (validatedData.type === 'gbhet_legal_workers_monthly') {
          // Check for duplicate monthly wizard
          const existingWizards = await storage.wizardEmployerMonthly.findWizards(
            validatedData.entityId,
            'gbhet_legal_workers_monthly',
            year,
            month
          );
          
          if (existingWizards.length > 0) {
            return res.status(400).json({ 
              message: `A legal workers monthly wizard already exists for this employer in ${month}/${year}` 
            });
          }
        } else if (validatedData.type === 'gbhet_legal_workers_corrections') {
          // Check for completed monthly wizard prerequisite
          const completedMonthlyWizards = await storage.wizardEmployerMonthly.findWizards(
            validatedData.entityId,
            'gbhet_legal_workers_monthly',
            year,
            month,
            ['completed', 'complete']
          );
          
          if (completedMonthlyWizards.length === 0) {
            return res.status(400).json({ 
              message: `Cannot create legal workers corrections wizard: no completed legal workers monthly wizard found for ${month}/${year}` 
            });
          }
        }
      }
      
      const wizard = await db.transaction(async (tx) => {
        // Re-validate constraints inside transaction to prevent race conditions
        if (isMonthlyWizard && validatedData.entityId) {
          const wizardData = validatedData.data as any;
          const launchArgs = wizardData?.launchArguments || {};
          const year = Number(launchArgs.year);
          const month = Number(launchArgs.month);
          
          if (validatedData.type === 'gbhet_legal_workers_monthly') {
            // Re-check for duplicate monthly wizard inside transaction
            const existingWizards = await tx
              .select()
              .from(wizardEmployerMonthly)
              .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
              .where(
                and(
                  eq(wizardEmployerMonthly.employerId, validatedData.entityId),
                  eq(wizardEmployerMonthly.year, year),
                  eq(wizardEmployerMonthly.month, month),
                  eq(wizards.type, 'gbhet_legal_workers_monthly')
                )
              );
            
            if (existingWizards.length > 0) {
              throw new HttpError(400, `A legal workers monthly wizard already exists for this employer in ${month}/${year}`);
            }
          } else if (validatedData.type === 'gbhet_legal_workers_corrections') {
            // Re-check for completed monthly wizard prerequisite inside transaction
            const [completedMonthly] = await tx
              .select()
              .from(wizardEmployerMonthly)
              .innerJoin(wizards, eq(wizardEmployerMonthly.wizardId, wizards.id))
              .where(
                and(
                  eq(wizardEmployerMonthly.employerId, validatedData.entityId),
                  eq(wizardEmployerMonthly.year, year),
                  eq(wizardEmployerMonthly.month, month),
                  eq(wizards.type, 'gbhet_legal_workers_monthly'),
                  or(eq(wizards.status, 'completed'), eq(wizards.status, 'complete'))
                )
              );
            
            if (!completedMonthly) {
              throw new HttpError(400, `Cannot create legal workers corrections wizard: no completed legal workers monthly wizard found for ${month}/${year}`);
            }
          }
        }
        
        // Create the wizard
        const [createdWizard] = await tx
          .insert(wizards)
          .values(validatedData)
          .returning();
        
        // If this is a monthly employer wizard, also create the wizard_employer_monthly record
        if (isMonthlyWizard && validatedData.entityId) {
          const wizardData = validatedData.data as any;
          const launchArgs = wizardData?.launchArguments || {};
          
          // Parse year and month (already validated above)
          const year = Number(launchArgs.year);
          const month = Number(launchArgs.month);
          
          await tx.insert(wizardEmployerMonthly).values({
            wizardId: createdWizard.id,
            employerId: validatedData.entityId,
            year,
            month,
          });
        }
        
        return createdWizard;
      });
      
      res.status(201).json(wizard);
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.statusCode).json({ message: error.message });
      } else if (error instanceof Error && error.name === "ZodError") {
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
      
      // If data is being updated, check if we need to clear downstream step data
      if (validatedData.data) {
        const existingData = (existing.data || {}) as any;
        const incomingData = validatedData.data as any;
        
        // Validate column mapping for duplicate field IDs
        if (incomingData.columnMapping) {
          const fieldIds = Object.values(incomingData.columnMapping).filter(id => id && id !== '_unmapped');
          const duplicates = fieldIds.filter((id, index) => fieldIds.indexOf(id) !== index);
          if (duplicates.length > 0) {
            const uniqueDuplicates = Array.from(new Set(duplicates));
            return res.status(400).json({ 
              message: `Duplicate field mappings detected: ${uniqueDuplicates.join(', ')}. Each field can only be mapped once.` 
            });
          }
        }
        
        // Merge existing data with incoming data
        const mergedData = {
          ...existingData,
          ...incomingData
        };
        
        // Check if upload-related data changed (uploadedFileId)
        if (incomingData.uploadedFileId && incomingData.uploadedFileId !== existingData.uploadedFileId) {
          // Clear all downstream data: map, validate, process, review
          delete mergedData.columnMapping;
          delete mergedData.hasHeaders;
          delete mergedData.validationResults;
          
          // Clear progress for downstream steps
          if (mergedData.progress) {
            delete mergedData.progress.map;
            delete mergedData.progress.validate;
            delete mergedData.progress.process;
            delete mergedData.progress.review;
          }
        }
        
        // Check if map-related data changed (columnMapping, hasHeaders, mode)
        else if (
          (incomingData.columnMapping && JSON.stringify(incomingData.columnMapping) !== JSON.stringify(existingData.columnMapping)) ||
          (incomingData.hasHeaders !== undefined && incomingData.hasHeaders !== existingData.hasHeaders) ||
          (incomingData.mode && incomingData.mode !== existingData.mode)
        ) {
          // Clear downstream data: validate, process, review
          delete mergedData.validationResults;
          
          // Clear progress for downstream steps
          if (mergedData.progress) {
            delete mergedData.progress.validate;
            delete mergedData.progress.process;
            delete mergedData.progress.review;
          }
        }
        
        validatedData.data = mergedData;
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

      // Delete all associated files from object storage
      const wizardFiles = await storage.files.list({ entityType: 'wizard', entityId: id });
      
      for (const file of wizardFiles) {
        try {
          // Delete from object storage
          await objectStorageService.deleteFile(file.storagePath);
          // Delete from database
          await storage.files.delete(file.id);
        } catch (error) {
          console.error(`Failed to delete file ${file.id}:`, error);
          // Continue with deletion even if file deletion fails
        }
      }

      // Delete the wizard record
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
      
      // Check if the uploaded file exists
      const file = await storage.files.getById(wizardData.uploadedFileId);
      return !!file;
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
    requireAuth,
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
          entityType: 'wizard',
          entityId: wizardId,
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

  // Get suggested mapping based on header row hash
  app.get("/api/wizards/:id/suggested-mapping",
    requireAuth,
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        const wizard = (req as any).wizard;
        const user = (req as any).user;

        if (!user) {
          return res.status(401).json({ message: "User not authenticated" });
        }

        // Get database user from Replit user
        const replitUserId = user?.claims?.sub;
        const dbUser = await storage.users.getUserByReplitId(replitUserId);

        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support mappings" });
        }

        // Get wizard data
        const wizardData = wizard.data as any;
        const fileId = wizardData?.uploadedFileId;

        if (!fileId) {
          return res.json({ mapping: null });
        }

        // Get file and parse header row
        const file = await storage.files.getById(fileId);
        if (!file) {
          return res.status(404).json({ message: "File not found" });
        }

        // Download and parse file to get header row
        const fileBuffer = await objectStorageService.downloadFile(file.storagePath);
        let headerRow: any[] = [];

        if (file.mimeType === 'text/csv') {
          const { parse } = await import('csv-parse/sync');
          const rows = parse(fileBuffer, {
            relax_column_count: true,
            skip_empty_lines: true,
            to: 1 // Just get first row
          });
          headerRow = rows[0] || [];
        } else if (
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          file.mimeType === 'application/vnd.ms-excel'
        ) {
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
            header: 1,
            defval: '',
            range: 'A1:ZZ1' // Just first row
          });
          headerRow = (jsonData as any[][])[0] || [];
        }

        if (headerRow.length === 0) {
          return res.json({ mapping: null });
        }

        // Hash the header row
        const headerHash = hashHeaderRow(headerRow);

        // Look for existing mapping
        const existingMapping = await storage.wizardFeedMappings.findByUserTypeAndHash(
          dbUser.id,
          wizard.type,
          headerHash
        );

        if (existingMapping) {
          res.json({ 
            mapping: existingMapping.mapping,
            headerHash,
            savedAt: existingMapping.updatedAt
          });
        } else {
          res.json({ mapping: null, headerHash });
        }
      } catch (error) {
        console.error("Error fetching suggested mapping:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch suggested mapping" });
      }
    }
  );

  // Save column mapping for future use
  app.post("/api/wizards/:id/save-mapping",
    requireAuth,
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        const { headerHash, mapping } = req.body;
        const wizard = (req as any).wizard;
        const user = (req as any).user;

        if (!user) {
          return res.status(401).json({ message: "User not authenticated" });
        }

        // Get database user from Replit user
        const replitUserId = user?.claims?.sub;
        const dbUser = await storage.users.getUserByReplitId(replitUserId);

        if (!dbUser) {
          return res.status(401).json({ message: "User not found" });
        }

        if (!headerHash || !mapping) {
          return res.status(400).json({ message: "Header hash and mapping are required" });
        }

        // Check if mapping already exists
        const existingMapping = await storage.wizardFeedMappings.findByUserTypeAndHash(
          dbUser.id,
          wizard.type,
          headerHash
        );

        if (existingMapping) {
          // Update existing mapping
          const updated = await storage.wizardFeedMappings.update(existingMapping.id, {
            mapping,
          });
          res.json(updated);
        } else {
          // Create new mapping
          const created = await storage.wizardFeedMappings.create({
            userId: dbUser.id,
            type: wizard.type,
            firstRowHash: headerHash,
            mapping,
          });
          res.json(created);
        }
      } catch (error) {
        console.error("Error saving mapping:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to save mapping" });
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

  // Process wizard data with SSE for progress tracking
  app.get("/api/wizards/:id/process",
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        const wizard = (req as any).wizard;

        // Get wizard type instance
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof FeedWizard)) {
          return res.status(400).json({ message: "This wizard type does not support processing" });
        }

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send initial event
        res.write(`data: ${JSON.stringify({ type: 'start', message: 'Starting processing...' })}\n\n`);

        // Run processing with progress callback
        try {
          const results = await wizardType.processFeedData(
            id,
            100, // batch size
            (progress) => {
              // Send progress event with explicit fields
              res.write(`data: ${JSON.stringify({ 
                type: 'progress',
                processed: progress.processed,
                total: progress.total,
                createdCount: progress.createdCount,
                updatedCount: progress.updatedCount,
                successCount: progress.successCount,
                failureCount: progress.failureCount,
                currentRow: progress.currentRow
              })}\n\n`);
            }
          );

          // Update wizard status based on results
          const finalStatus = results.failureCount > 0 ? 'needs_review' : 'completed';
          
          // Update wizard with final status (preserve processResults that was just saved)
          await storage.wizards.update(id, {
            status: finalStatus,
            data: {
              ...wizard.data,
              processResults: results, // Preserve the complete results including resultsFileId
              progress: {
                ...wizard.data?.progress,
                process: {
                  status: 'completed',
                  completedAt: new Date().toISOString()
                }
              }
            }
          });

          // Send completion event
          res.write(`data: ${JSON.stringify({ 
            type: 'complete', 
            results,
            wizardStatus: finalStatus
          })}\n\n`);
          res.end();
        } catch (processingError) {
          // Send error event
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: processingError instanceof Error ? processingError.message : 'Processing failed' 
          })}\n\n`);
          res.end();
        }
      } catch (error) {
        console.error("Processing error:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: error instanceof Error ? error.message : "Failed to start processing" });
        } else {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: error instanceof Error ? error.message : 'Processing failed' 
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

  // Generate a report for a report wizard
  app.post("/api/wizards/:id/generate-report",
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { id } = req.params;
        const wizard = await storage.wizards.getById(id);
        
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        // Get wizard type instance
        const { WizardReport } = await import('../wizards/report.js');
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof WizardReport)) {
          return res.status(400).json({ message: "This wizard type does not support report generation" });
        }

        // Generate the report
        const results = await wizardType.generateReport(id);
        
        res.json(results);
      } catch (error) {
        console.error("Error generating report:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to generate report" });
      }
    }
  );

  // Get report data for a wizard
  app.get("/api/wizards/:id/report-data",
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { id } = req.params;
        const wizard = await storage.wizards.getById(id);
        
        if (!wizard) {
          return res.status(404).json({ message: "Wizard not found" });
        }

        // Get wizard type instance
        const { WizardReport } = await import('../wizards/report.js');
        const wizardType = wizardRegistry.get(wizard.type);
        if (!wizardType || !(wizardType instanceof WizardReport)) {
          return res.status(400).json({ message: "This wizard type does not support reports" });
        }

        // Get the latest report data
        const reportData = await wizardType.getReportResults(id);
        
        if (!reportData) {
          return res.status(404).json({ message: "No report data found for this wizard" });
        }

        res.json(reportData);
      } catch (error) {
        console.error("Error fetching report data:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch report data" });
      }
    }
  );
}
