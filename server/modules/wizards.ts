import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { storage } from "../storage";
import { insertWizardSchema, wizardDataSchema, type WizardData } from "@shared/schema";
import { requireAccess, buildContext, checkAccess, getAccessStorage } from "../services/access-policy-evaluator";
import { wizardPluginRegistry } from "../plugins/wizards";
import { enforceWizardEntityAccess } from "../plugins/wizards/entity-access";
import { enforcePluginGating } from "../plugins/_core";
import { createUnifiedOptionsStorage } from "../storage/unified-options.js";
import { objectStorageService } from "../services/objectStorage.js";

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
  app.get("/api/wizard-types", requireAuth, async (req, res) => {
    try {
      const context = await buildContext(req as any);
      const adminAccess = await checkAccess('admin', context.user);

      if (!adminAccess.granted) {
        const accessStorage = getAccessStorage();
        if (!context.user || !accessStorage || !await accessStorage.hasPermission(context.user.id, 'employer')) {
          res.status(403).json({ message: "Access denied" });
          return;
        }
      }

      const filteredTypes: any[] = [];

      // Merge in framework (plugin-based) wizard kinds. `listVisibleTo`
      // applies the same component + per-user access-policy gating.
      const visiblePlugins = await wizardPluginRegistry.listVisibleTo(req as any);
      for (const plugin of visiblePlugins) {
        if (filteredTypes.some((t) => t.name === plugin.id)) continue;
        filteredTypes.push({
          name: plugin.id,
          displayName: plugin.name,
          description: plugin.description,
          isFeed: false,
          isMonthly: false,
          isReport: plugin.isReport ?? false,
          entityType: plugin.entityType,
          category: plugin.category,
          requiredComponent: plugin.requiredComponent,
        });
      }

      res.json(filteredTypes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard types" });
    }
  });

  app.get("/api/wizard-types/:typeName/fields", requireAuth, async (req, res) => {
    try {
      const ctx = await buildContext(req as any);
      const isAdmin = await checkAccess('admin', ctx.user);
      if (!isAdmin.granted) {
        if (!ctx.user || !await getAccessStorage()!.hasPermission(ctx.user.id, 'employer')) {
          return res.status(403).json({ message: "Access denied" });
        }
      }
      const { typeName } = req.params;
      const plugin = wizardPluginRegistry.get(typeName);
      if (!plugin) {
        return res.status(404).json({ message: "Wizard type not found" });
      }
      const gate = await enforcePluginGating(
        wizardPluginRegistry.getMetadata(plugin),
        req as any,
      );
      if (!gate.ok) {
        return res.status(gate.status).json({ message: gate.message });
      }
      const fields = plugin.getFields?.();
      if (!fields) {
        return res.status(400).json({ message: "This wizard type does not support fields" });
      }
      res.json(fields);
    } catch (error) {
      if (error instanceof Error && error.name === 'WizardFieldsUnsupportedError') {
        return res.status(400).json({ message: error.message });
      }
      res.status(404).json({ message: error instanceof Error ? error.message : "Wizard type not found" });
    }
  });

  app.get("/api/wizard-types/:typeName/launch-arguments", requireAuth, async (req, res) => {
    try {
      const laCtx = await buildContext(req as any);
      const laAdmin = await checkAccess('admin', laCtx.user);
      if (!laAdmin.granted) {
        if (!laCtx.user || !await getAccessStorage()!.hasPermission(laCtx.user.id, 'employer')) {
          res.status(403).json({ message: "Access denied" });
          return;
        }
      }

      const { typeName } = req.params;
      // Framework (plugin-based) wizards declare launch arguments on the
      // plugin; serve those (after plugin gating) so a plugin-only wizard
      // needs no legacy registration for its launch inputs.
      const laPlugin = wizardPluginRegistry.get(typeName);
      if (laPlugin) {
        const laGate = await enforcePluginGating(
          wizardPluginRegistry.getMetadata(laPlugin),
          req as any,
        );
        if (!laGate.ok) {
          return res.status(laGate.status).json({ message: laGate.message });
        }
        // Entity-scoped plugins (e.g. employer wizards) must pass the same
        // admin-OR-<entity>.mine check used on create/dispatch, so launch
        // inputs aren't disclosed for an entity the user can't access.
        if (laPlugin.entityType) {
          const laEntityId =
            typeof req.query.entityId === "string"
              ? req.query.entityId
              : undefined;
          const laEntity = await enforceWizardEntityAccess(
            laPlugin,
            laEntityId,
            req as any,
          );
          if (!laEntity.ok) {
            return res
              .status(laEntity.status)
              .json({ message: laEntity.message });
          }
        }
        return res.json(laPlugin.launchArguments ?? []);
      }
      return res.status(404).json({ message: "Wizard type not found" });
    } catch (error) {
      res.status(404).json({ message: error instanceof Error ? error.message : "Wizard type not found" });
    }
  });

  app.get("/api/wizards", requireAuth, async (req, res) => {
    try {
      const { type, status, entityId } = req.query;
      
      const context = await buildContext(req as any);
      const adminAccess = await checkAccess('admin', context.user);

      if (!adminAccess.granted) {
        if (!entityId) {
          res.status(403).json({ message: "Access denied" });
          return;
        }
        const employerAccess = await checkAccess('employer.mine', context.user, entityId as string);
        if (!employerAccess.granted) {
          res.status(403).json({ message: "Access denied" });
          return;
        }
      }

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

  app.get("/api/wizards/employer-monthly/by-period", requireAccess('admin'), async (req, res) => {
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

  app.get("/api/wizards/employer-monthly/employers", requireAccess('admin'), async (req, res) => {
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

  app.get("/api/wizards/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const wizard = await storage.wizards.getById(id);
      
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const context = await buildContext(req as any);
      const adminAccess = await checkAccess('admin', context.user);

      if (!adminAccess.granted) {
        if (!wizard.entityId) {
          return res.status(403).json({ message: "Access denied" });
        }
        const employerAccess = await checkAccess('employer.mine', context.user, wizard.entityId);
        if (!employerAccess.granted) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      // Framework (plugin-based) wizards carry a computed manifest so the
      // client can render steps generically and poll progress off this
      // same load route (no bespoke poll route).
      const plugin = wizardPluginRegistry.get(wizard.type);
      if (plugin) {
        const manifest = wizardPluginRegistry.computeManifest(plugin, wizard);
        return res.json({ ...wizard, manifest });
      }

      res.json(wizard);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard" });
    }
  });

  app.post("/api/wizards", requireAuth, async (req, res) => {
    try {
      const validatedData = insertWizardSchema.parse(req.body);

      // Framework (plugin-based) wizard creation path. Gating (component →
      // access policy) is enforced here from the plugin declaration alone.
      const frameworkPlugin = wizardPluginRegistry.get(validatedData.type);
      if (frameworkPlugin) {
        const gate = await enforcePluginGating(
          wizardPluginRegistry.getMetadata(frameworkPlugin),
          req as any,
        );
        if (!gate.ok) {
          return res.status(gate.status).json({ message: gate.message });
        }
        // Entity-scoped wizards (e.g. employer feeds) must additionally be
        // scoped to the owning entity's users at creation time.
        if (frameworkPlugin.entityType) {
          const entityGate = await enforceWizardEntityAccess(
            frameworkPlugin,
            validatedData.entityId,
            req as any,
          );
          if (!entityGate.ok) {
            return res
              .status(entityGate.status)
              .json({ message: entityGate.message });
          }
        }
        // Generic required-launch-argument validation from the plugin's
        // declaration (per-wizard value constraints live in `create`).
        const launchArgs = frameworkPlugin.launchArguments ?? [];
        if (launchArgs.length > 0) {
          const provided =
            ((validatedData.data as any)?.launchArguments as
              | Record<string, unknown>
              | undefined) || {};
          for (const arg of launchArgs) {
            if (!arg.required) continue;
            const value = provided[arg.id];
            if (
              value === undefined ||
              value === null ||
              value === "" ||
              value === 0
            ) {
              return res.status(400).json({
                message: `Required launch argument '${arg.name}' is missing or invalid`,
              });
            }
          }
        }
        const firstStep = frameworkPlugin.steps[0];
        if (!validatedData.currentStep && firstStep) {
          validatedData.currentStep = firstStep.id;
        }
        const wdata: any = (validatedData.data as any) || {};
        wdata.progress = wdata.progress || {};
        if (validatedData.currentStep) {
          wdata.progress[validatedData.currentStep] = {
            ...wdata.progress[validatedData.currentStep],
            status: "in_progress",
          };
        }
        if (frameworkPlugin.isReport && !wdata.retention) {
          wdata.retention = "30days";
        }
        validatedData.data = wdata;
        if (!validatedData.status) validatedData.status = "draft";
        // Custom creation hook (per-wizard side effects: duplicate/prereq
        // checks, subsidiary rows). Falls back to the default create.
        if (frameworkPlugin.create) {
          const result = await frameworkPlugin.create({
            input: validatedData as any,
            req: req as any,
            storage,
          });
          if (result.error || !result.wizard) {
            return res
              .status(result.status ?? 400)
              .json({ message: result.error ?? "Failed to create wizard" });
          }
          return res.status(201).json(result.wizard);
        }
        const created = await storage.wizards.create(validatedData);
        return res.status(201).json(created);
      }

      return res.status(404).json({ message: "Unknown wizard type" });

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

  app.patch("/api/wizards/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const patchCtx = await buildContext(req as any);
      const patchAdmin = await checkAccess('admin', patchCtx.user);
      if (!patchAdmin.granted) {
        if (!existing.entityId) {
          return res.status(403).json({ message: "Access denied" });
        }
        const empAccess = await checkAccess('employer.mine', patchCtx.user, existing.entityId);
        if (!empAccess.granted) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const validatedData = insertWizardSchema.partial().parse(req.body);
      
      if (validatedData.type) {
        if (!wizardPluginRegistry.get(validatedData.type)) {
          return res.status(400).json({ message: `Unknown wizard type: ${validatedData.type}` });
        }
      }
      
      // Validate that only report wizards can have retention settings
      if (validatedData.data) {
        const incomingData = validatedData.data as any;
        if (incomingData.retention !== undefined) {
          const isReportWizard = wizardPluginRegistry.get(existing.type)?.isReport ?? false;
          if (!isReportWizard) {
            return res.status(400).json({ 
              message: "Retention settings can only be set on report wizards" 
            });
          }
        }
      }
      
      // If data is being updated, check if we need to clear downstream step data
      if (validatedData.data) {
        const existingData = (existing.data || {}) as any;
        const incomingData = validatedData.data as any;
        
        if (incomingData.columnMapping) {
          const cmKeys = Object.keys(incomingData.columnMapping);
          const isOldFormat = cmKeys.length > 0 && cmKeys.every((k: string) => k.startsWith('col_'));
          if (isOldFormat) {
            const fieldIds = Object.values(incomingData.columnMapping).filter((id: any) => id && id !== '_unmapped');
            const duplicates = fieldIds.filter((id: any, index: number) => fieldIds.indexOf(id) !== index);
            if (duplicates.length > 0) {
              const uniqueDuplicates = Array.from(new Set(duplicates));
              return res.status(400).json({ 
                message: `Duplicate field mappings detected: ${uniqueDuplicates.join(', ')}. Each field can only be mapped once.` 
              });
            }
          } else {
            const colValues = Object.values(incomingData.columnMapping).filter((v: any) => v && v !== '_unmapped');
            const duplicates = colValues.filter((v: any, index: number) => colValues.indexOf(v) !== index);
            if (duplicates.length > 0) {
              const uniqueDuplicates = Array.from(new Set(duplicates));
              return res.status(400).json({ 
                message: `Duplicate column mappings detected: ${uniqueDuplicates.join(', ')}. Each column can only be mapped once.` 
              });
            }
          }
        }
        
        // Merge existing data with incoming data
        // Only deep-merge the progress field to avoid overwriting other fields like reportDataId
        const mergedData = {
          ...existingData,
          ...incomingData,
          // Deep merge only progress to preserve individual step progress
          ...(incomingData.progress ? {
            progress: {
              ...(existingData.progress || {}),
              ...(incomingData.progress || {})
            }
          } : {})
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

  app.delete("/api/wizards/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const delCtx = await buildContext(req as any);
      const delAdmin = await checkAccess('admin', delCtx.user);
      if (!delAdmin.granted) {
        if (!existing.entityId) {
          return res.status(403).json({ message: "Access denied" });
        }
        const empAccess = await checkAccess('employer.mine', delCtx.user, existing.entityId);
        if (!empAccess.granted) {
          return res.status(403).json({ message: "Access denied" });
        }
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

  // Middleware to check wizard access based on entity type
  const checkWizardAccess = async (req: any, res: any, next: any) => {
    try {
      const { id } = req.params;
      const wizard = await storage.wizards.getById(id);
      
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      // Get wizard type to determine entityType
      const wizardType = wizardPluginRegistry.get(wizard.type);
      if (!wizardType) {
        return res.status(400).json({ message: "Invalid wizard type" });
      }

      // Build context for policy evaluation
      const context = await buildContext(req);
      
      // Check if user is admin first (admins can access all wizards)
      const adminResult = await checkAccess('admin', context.user);
      if (adminResult.granted) {
        req.wizard = wizard; // Attach wizard to request for use in handler
        return next();
      }

      // For entity-specific wizards, check entity-based access
      if (wizardType.entityType && wizard.entityId) {
        // Check appropriate entity policy based on entity type
        const policyId = wizardType.entityType === 'employer' ? 'employer.view' : 'worker.self';
        const result = await checkAccess(policyId, context.user, wizard.entityId);
        
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

  // List files for a wizard
  app.get("/api/wizards/:id/files",
    checkWizardAccess,
    async (req, res) => {
      try {
        const { id } = req.params;
        
        const allFiles = await storage.files.list();
        const files = allFiles.filter(
          (file) => (file.metadata as any)?.wizardId === id,
        );
        res.json(files);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch files" });
      }
    }
  );

  const optionsStorage = createUnifiedOptionsStorage();
  app.get("/api/employment-status-options",
    requireAuth,
    async (req, res) => {
      try {
        const statuses = await optionsStorage.list("employment-status");
        res.json(statuses.map(s => ({ id: s.id, name: s.name, code: s.code, employed: s.employed })));
      } catch (error) {
        console.error("Error fetching employment status options:", error);
        res.status(500).json({ message: error instanceof Error ? error.message : "Failed to fetch employment status options" });
      }
    }
  );
}
