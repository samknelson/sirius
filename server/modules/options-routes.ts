import type { Express, Request, Response, NextFunction } from "express";
import { getOptionsType, getAllOptionsTypes, getOptionsStorage } from "./options-registry";
import { requireAccess } from "../services/access-policy-evaluator";
import { OptionsTypeName } from "../storage/unified-options";
import { storage } from "../storage";
import { requireComponent, isComponentEnabled } from "./components";
import { getComponentById } from "../../shared/components";

/**
 * Middleware for the generic `/api/options/:type*` routes that rejects
 * requests for an option type whose `requiredComponent` is not enabled.
 * Without this, an authenticated user could read or mutate a disabled
 * feature's options by calling the API directly, even though the UI hides
 * the link and shows a "Feature Not Available" card. Unknown types fall
 * through so the route handler can return its own 404.
 */
function requireOptionTypeComponent() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { type } = req.params;
      const config = getOptionsType(type);
      const requiredComponent = config?.requiredComponent;

      if (!requiredComponent) {
        next();
        return;
      }

      const enabled = await isComponentEnabled(requiredComponent);
      if (!enabled) {
        const component = getComponentById(requiredComponent);
        const componentName = component?.name || requiredComponent;
        res.status(403).json({
          message: `Access denied: The "${componentName}" feature is not enabled`,
          error: "component_disabled",
          componentId: requiredComponent,
          componentName,
        });
        return;
      }

      next();
    } catch (error) {
      res.status(500).json({ message: "Failed to check component status" });
    }
  };
}

export function registerConsolidatedOptionsRoutes(app: Express) {
  // GET /api/options - List all available options types
  app.get("/api/options", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      res.json({ types: getAllOptionsTypes() });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options types" });
    }
  });

  // GET /api/options/definitions - Get all options resource definitions (for dynamic UI)
  app.get("/api/options/definitions", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      const storage = getOptionsStorage();
      const definitions = storage.getAllDefinitions();
      res.json(definitions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options definitions" });
    }
  });

  // GET /api/options/:type/definition - Get the resource definition for a specific options type
  // NOTE: This route MUST be defined BEFORE /api/options/:type/:id to avoid routing conflicts
  app.get("/api/options/:type/definition", requireAccess('authenticated'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const storage = getOptionsStorage();
      const definition = storage.getDefinition(type as OptionsTypeName);
      
      if (!definition) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      res.json(definition);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options definition" });
    }
  });

  // Special-case: cardcheck definitions are not unified-options, but the
  // trust eligibility "cardcheck" plugin needs them as a remote-options
  // source. Register this BEFORE the generic `/api/options/:type` so it
  // matches first.
  app.get(
    "/api/options/cardcheck-definition",
    requireAccess('authenticated'),
    requireComponent("cardcheck"),
    async (_req: Request, res: Response) => {
      try {
        const definitions = await storage.cardcheckDefinitions.getAllCardcheckDefinitions();
        res.json(definitions.map((d) => ({ id: d.id, name: d.name })));
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch cardcheck definitions" });
      }
    },
  );

  // Special-case: trust benefits exposed as a remote-options source for
  // the trust eligibility "linked" plugin's multi-select. Read-only.
  // Register BEFORE the generic `/api/options/:type` so it matches first.
  app.get(
    "/api/options/trust-benefit",
    requireAccess('authenticated'),
    async (_req: Request, res: Response) => {
      try {
        const benefits = await storage.trustBenefits.getActiveTrustBenefitOptions();
        res.json(benefits);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch trust benefits" });
      }
    },
  );

  // Special-case: facilities exposed as a remote-options source for the
  // trust eligibility "BAO - Start Healthnet" plugin's site picker.
  // Read-only; gated by the `sitespecific.bao` component. Register BEFORE
  // the generic `/api/options/:type` so it matches first.
  app.get(
    "/api/options/facility",
    requireAccess('authenticated'),
    requireComponent("sitespecific.bao"),
    async (_req: Request, res: Response) => {
      try {
        const facilities = await storage.facilities.getAll();
        res.json(facilities.map((f) => ({ id: f.id, name: f.name })));
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch facilities" });
      }
    },
  );

  // Policies feed the sitespecific-bao-echp charge plugin's policy picker.
  // Register BEFORE the generic `/api/options/:type` so it matches first.
  app.get(
    "/api/options/policy",
    requireAccess('authenticated'),
    requireComponent("sitespecific.bao"),
    async (_req: Request, res: Response) => {
      try {
        const policies = await storage.policies.getAllPolicies();
        res.json(
          policies.map((p) => ({
            id: p.id,
            name: p.name?.trim() || p.siriusId,
          })),
        );
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch policies" });
      }
    },
  );

  // GET /api/options/:type - List all items of a specific options type
  app.get("/api/options/:type", requireAccess('authenticated'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const items = await config.getAll();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options" });
    }
  });

  app.get("/api/options/:type/:id", requireAccess('authenticated'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const item = await config.get(id);
      
      if (!item) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch option" });
    }
  });

  app.post("/api/options/:type", requireAccess('admin'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      for (const field of config.requiredFields) {
        if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
          return res.status(400).json({ message: `${field} is required` });
        }
      }
      
      const data: Record<string, any> = {};
      for (const field of config.requiredFields) {
        const value = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
        data[field] = value;
      }
      for (const field of config.optionalFields) {
        if (req.body[field] !== undefined) {
          const value = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
          // Skip empty strings for optional fields to let database defaults apply
          if (value !== '') {
            data[field] = value;
          }
        }
      }

      // Enforce fixed-value (enum) fields server-side so a direct API call
      // cannot persist a value outside the allowed set.
      for (const [field, allowed] of Object.entries(config.enumConstraints)) {
        const value = data[field];
        if (value !== undefined && value !== null && !allowed.includes(value)) {
          return res.status(400).json({ message: `${field} must be one of: ${allowed.join(', ')}` });
        }
      }
      
      const item = await config.create(data);
      res.status(201).json(item);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "An item with this value already exists" });
      }
      res.status(500).json({ message: `Failed to create option` });
    }
  });

  app.put("/api/options/:type/:id", requireAccess('admin'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const updates: Record<string, any> = {};
      const allFields = [...config.requiredFields, ...config.optionalFields];
      
      for (const field of allFields) {
        if (req.body[field] !== undefined) {
          const value = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
          if (config.requiredFields.includes(field) && (value === null || value === '')) {
            return res.status(400).json({ message: `${field} cannot be empty` });
          }
          // Skip empty strings for optional fields to let database defaults/current values remain
          if (config.optionalFields.includes(field) && value === '') {
            continue;
          }
          updates[field] = value;
        }
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      // Enforce fixed-value (enum) fields server-side on update too.
      for (const [field, allowed] of Object.entries(config.enumConstraints)) {
        const value = updates[field];
        if (value !== undefined && value !== null && !allowed.includes(value)) {
          return res.status(400).json({ message: `${field} must be one of: ${allowed.join(', ')}` });
        }
      }
      
      const item = await config.update(id, updates);
      
      if (!item) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.json(item);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "An item with this value already exists" });
      }
      res.status(500).json({ message: `Failed to update option` });
    }
  });

  app.delete("/api/options/:type/:id", requireAccess('admin'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }

      // A grievance status that is referenced by any timeline-template step
      // cannot be deleted — the step stores status ids as plain arrays (no FK),
      // so we guard the delete here to avoid orphaning those references.
      if (type === "grievance-status") {
        const referenced = await storage.grievanceTimelineTemplates.isStatusReferenced(id);
        if (referenced) {
          return res.status(409).json({
            message:
              "This status is used by a grievance timeline template and cannot be deleted. Remove it from all timeline steps first.",
          });
        }
      }

      const deleted = await config.delete(id);
      
      if (!deleted) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: `Failed to delete option` });
    }
  });
}
