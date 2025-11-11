import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertWizardSchema, wizardDataSchema, type WizardData } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { wizardRegistry } from "../wizards/index.js";

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
}
