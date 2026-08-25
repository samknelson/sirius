import type { Express, Request, Response, NextFunction } from "express";
import { getOptionsType, getAllOptionsTypes, getOptionsStorage } from "./options-registry";
import { requireAccess } from "../services/access-policy-evaluator";
import { OptionsTypeName } from "../storage/unified-options";
import { storage } from "../storage";
import { requireComponent, isComponentEnabled } from "./components";
import { getComponentById } from "../../shared/components";
import { logger } from "../logger";
import {
  buildOptionCreateData,
  buildOptionUpdateData,
  checkOptionDeleteGuard,
  optionDbErrorMessage,
  optionInUseDeleteMessage,
  validateOptionTypeSpecificData,
} from "./options-write-rules";
import { registerOptionsTransferRoutes, getDisabledOptionFieldNames } from "./options-transfer";

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

/**
 * Strip fields whose `requiredComponent` is disabled from a definition —
 * removes them from `fields`, `schema.properties`, `schema.required`, and
 * `uiSchema` so the client form and table never show them (e.g. the
 * department "Available for dispatch?" flag when dispatch.department is off).
 */
async function filterDefinitionFieldsByComponent(definition: any): Promise<any> {
  // Same gating the export/import tools apply, so a field hidden from the
  // form is also invisible and untouchable through the JSON tools.
  const removedNames = await getDisabledOptionFieldNames(definition.type as OptionsTypeName);
  if (removedNames.size === 0) return definition;

  const schema = definition.schema ? { ...definition.schema } : definition.schema;
  if (schema?.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).filter(([name]) => !removedNames.has(name)),
    );
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name: string) => !removedNames.has(name));
    }
  }
  const uiSchema = definition.uiSchema
    ? Object.fromEntries(Object.entries(definition.uiSchema).filter(([name]) => !removedNames.has(name)))
    : definition.uiSchema;

  return {
    ...definition,
    fields: (definition.fields || []).filter((f: any) => !removedNames.has(f.name)),
    schema,
    uiSchema,
  };
}

export function registerConsolidatedOptionsRoutes(app: Express) {
  // Export / import routes. Registered FIRST so their literal path segments
  // (`export`, `import/preview`, `import/apply`) match before the generic
  // `/api/options/:type/:id` route swallows them.
  registerOptionsTransferRoutes(app, requireOptionTypeComponent());

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
      const filtered = await Promise.all(definitions.map(filterDefinitionFieldsByComponent));
      res.json(filtered);
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
      
      res.json(await filterDefinitionFieldsByComponent(definition));
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
  // trust eligibility "BAO - Start Healthnet" plugin's site picker and the
  // worker-ban Facility behavior's picker. Read-only; available when either
  // the `facility` or the `sitespecific.bao` component is enabled. Register
  // BEFORE the generic `/api/options/:type` so it matches first.
  app.get(
    "/api/options/facility",
    requireAccess('authenticated'),
    async (_req: Request, res: Response) => {
      try {
        const enabled =
          (await isComponentEnabled("facility")) ||
          (await isComponentEnabled("sitespecific.bao"));
        if (!enabled) {
          return res.status(403).json({ message: "This feature is not enabled" });
        }
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
      
      const built = buildOptionCreateData(config, req.body);
      if ('error' in built) {
        return res.status(400).json({ message: built.error });
      }
      const { data } = built;

      const validationError = await validateOptionTypeSpecificData(type, data.data);
      if (validationError) {
        return res.status(400).json({ message: validationError });
      }
      
      const item = await config.create(data);
      res.status(201).json(item);
    } catch (error: any) {
      const mapped = optionDbErrorMessage(error);
      if (mapped) {
        return res.status(mapped.status).json({ message: mapped.message });
      }
      logger.error("Failed to create option", {
        service: "options-routes",
        type: req.params.type,
        error: error?.message,
        code: error?.code,
      });
      res.status(500).json({ message: `Failed to create option: ${error?.message ?? "unknown error"}` });
    }
  });

  app.put("/api/options/:type/:id", requireAccess('admin'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const built = buildOptionUpdateData(config, req.body);
      if ('error' in built) {
        return res.status(400).json({ message: built.error });
      }
      const { updates } = built;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      if (updates.data !== undefined) {
        const validationError = await validateOptionTypeSpecificData(type, updates.data);
        if (validationError) {
          return res.status(400).json({ message: validationError });
        }
      }
      
      const item = await config.update(id, updates);

      // Editing a ban type's behaviors changes what every existing ban of
      // that type enforces, so re-emit WORKER_BAN_SAVED for each affected
      // ban. The dispatch_ban denorm plugin recomputes those workers'
      // global eligibility facts (e.g. all-dispatch added/removed) instead
      // of waiting for the daily sweep.
      if (type === "worker-ban-type" && updates.data !== undefined) {
        const affected = (await storage.workerBans.getAll()).filter(
          (ban) => ban.type === id,
        );
        const { eventBus, EventType } = await import("../services/event-bus");
        for (const ban of affected) {
          eventBus.emit(EventType.WORKER_BAN_SAVED, {
            banId: ban.id,
            workerId: ban.workerId,
            type: ban.type,
            startDate: ban.startDate,
            endDate: ban.endDate,
            active: ban.denormActive ?? true,
          });
        }
      }
      
      if (!item) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.json(item);
    } catch (error: any) {
      const mapped = optionDbErrorMessage(error);
      if (mapped) {
        return res.status(mapped.status).json({ message: mapped.message });
      }
      logger.error("Failed to update option", {
        service: "options-routes",
        type: req.params.type,
        id: req.params.id,
        error: error?.message,
        code: error?.code,
      });
      res.status(500).json({ message: `Failed to update option: ${error?.message ?? "unknown error"}` });
    }
  });

  app.delete("/api/options/:type/:id", requireAccess('admin'), requireOptionTypeComponent(), async (req: Request, res: Response) => {
    const { type, id } = req.params;
    const config = getOptionsType(type);
    try {
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }

      const blocked = await checkOptionDeleteGuard(type, id);
      if (blocked) {
        return res.status(blocked.status).json({ message: blocked.message });
      }

      const deleted = await config.delete(id);
      
      if (!deleted) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.status(204).send();
    } catch (error: any) {
      // FK RESTRICT violation: the option is still referenced by another
      // row (e.g. a grievance role assigned to people on a grievance).
      // Surface a clear 409 instead of an opaque 500.
      if (error?.code === "23503") {
        return res.status(409).json({ message: optionInUseDeleteMessage(config?.name) });
      }
      res.status(500).json({ message: `Failed to delete option` });
    }
  });
}
