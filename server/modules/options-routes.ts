import type { Express, Request, Response, NextFunction } from "express";
import { isNoteEntityType } from "@shared/notes";
import { getOptionsType, getAllOptionsTypes, getOptionsStorage } from "./options-registry";
import { requireAccess } from "../services/access-policy-evaluator";
import { OptionsTypeName } from "../storage/unified-options";
import { storage } from "../storage";
import { requireComponent, isComponentEnabled } from "./components";
import { getComponentById } from "../../shared/components";
import { jobTypeBullpenEnum } from "@shared/schema";
import { logger } from "../logger";

/**
 * Map a caught database error to a clear, user-facing message (or null if
 * unrecognized). Logs the underlying error so 500s are diagnosable.
 */
function optionDbErrorMessage(error: any): { status: number; message: string } | null {
  // Unique violation — name the offending field when the constraint tells us.
  if (error?.code === "23505") {
    const field = humanizeConstraintColumn(error);
    return {
      status: 400,
      message: field
        ? `An item with this ${field} already exists. ${field === "Sirius ID" ? "Sirius IDs must be unique." : "Please choose a different value."}`
        : "An item with this value already exists",
    };
  }
  // Not-null violation — name the missing column.
  if (error?.code === "23502") {
    const column = error?.column ? String(error.column) : null;
    return {
      status: 400,
      message: column ? `${column.replace(/_/g, " ")} is required` : "A required field is missing",
    };
  }
  // FK violation on insert/update — referenced record doesn't exist.
  if (error?.code === "23503") {
    return { status: 400, message: "A referenced record does not exist" };
  }
  return null;
}

function humanizeConstraintColumn(error: any): string | null {
  const constraint = error?.constraint ? String(error.constraint) : "";
  if (constraint.includes("sirius_id")) return "Sirius ID";
  if (constraint.includes("name")) return "name";
  if (constraint.includes("code")) return "code";
  return null;
}

/**
 * Validate the bullpen fields inside a dispatch-job-type `data` payload
 * (dispatch.bullpen component). Returns an error message or null.
 * Enforced whenever bullpen fields are present so a direct API call cannot
 * persist an invalid combination regardless of what the UI shows.
 */
function validateDispatchJobTypeBullpen(data: unknown): string | null {
  if (data === null || data === undefined || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const bullpen = d.bullpen;
  if ("bullpen" in d) {
    if (typeof bullpen !== "string" || !(jobTypeBullpenEnum as readonly string[]).includes(bullpen)) {
      return `bullpen must be one of: ${jobTypeBullpenEnum.join(", ")}`;
    }
  }
  if (bullpen === "host" || bullpen === "shared") {
    const eventTypeId = d.bullpenEventTypeId;
    if (typeof eventTypeId !== "string" || eventTypeId.trim() === "") {
      return "An event type is required when Bullpen is set to host or shared";
    }
  } else {
    // Keep persisted JSON consistent: no dangling event-type reference
    // when bullpen is "none" or absent.
    delete d.bullpenEventTypeId;
  }
  return null;
}

/**
 * Validation for `worker-ban-type` writes: `data.pluginIds` must be a
 * non-empty array of registered worker-ban plugin ids. The UI already
 * constrains this via the ban-plugins widget, but a direct API call must
 * not persist unknown plugin ids. Returns an error message or null.
 */
async function validateWorkerBanTypePlugins(data: unknown): Promise<string | null> {
  const pluginIds = (data as { pluginIds?: unknown } | null | undefined)?.pluginIds;
  if (!Array.isArray(pluginIds) || pluginIds.length === 0) {
    return "At least one ban behavior is required";
  }
  const { workerBanPluginRegistry } = await import("../plugins/worker-bans/registry");
  const known = new Set(workerBanPluginRegistry.listIds());
  const unknown = pluginIds.filter((p) => typeof p !== "string" || !known.has(p));
  if (unknown.length > 0) {
    return `Unknown ban behavior(s): ${unknown.join(", ")}`;
  }
  const defaultDurationDays = (data as { defaultDurationDays?: unknown } | null | undefined)?.defaultDurationDays;
  if (defaultDurationDays !== undefined && defaultDurationDays !== null) {
    if (typeof defaultDurationDays !== "number" || !Number.isInteger(defaultDurationDays) || defaultDurationDays < 1) {
      return "Default duration (days) must be a positive integer";
    }
  }
  return null;
}

/**
 * Validation for `note-type` writes: `data.entityTypes` must be a non-empty
 * array of record types registered in the shared note-entity registry. The
 * form constrains this via a multi-select, but a direct API call must not be
 * able to declare a type for a record kind that cannot hold notes.
 */
function validateNoteTypeEntityTypes(data: unknown): string | null {
  const entityTypes = (data as { entityTypes?: unknown } | null | undefined)?.entityTypes;
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
    return "At least one record type is required";
  }
  const unknown = entityTypes.filter((t) => typeof t !== "string" || !isNoteEntityType(t));
  if (unknown.length > 0) {
    return `Unknown record type(s): ${unknown.join(", ")}`;
  }
  return null;
}

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
  const gatedComponents: string[] = Array.from(new Set(
    (definition.fields || [])
      .map((f: any) => f.requiredComponent)
      .filter((c: unknown): c is string => typeof c === 'string'),
  ));
  if (gatedComponents.length === 0) return definition;

  const disabled = new Set<string>();
  for (const componentId of gatedComponents) {
    if (!(await isComponentEnabled(componentId))) {
      disabled.add(componentId);
    }
  }
  if (disabled.size === 0) return definition;

  const removedNames = new Set<string>(
    (definition.fields || [])
      .filter((f: any) => f.requiredComponent && disabled.has(f.requiredComponent))
      .map((f: any) => f.name),
  );

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

      if (type === "dispatch-job-type") {
        const bullpenError = validateDispatchJobTypeBullpen(data.data);
        if (bullpenError) {
          return res.status(400).json({ message: bullpenError });
        }
      }

      if (type === "note-type") {
        const entityTypeError = validateNoteTypeEntityTypes(data.data);
        if (entityTypeError) {
          return res.status(400).json({ message: entityTypeError });
        }
      }

      if (type === "worker-ban-type") {
        const pluginError = await validateWorkerBanTypePlugins(data.data);
        if (pluginError) {
          return res.status(400).json({ message: pluginError });
        }
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

      if (type === "dispatch-job-type" && updates.data !== undefined) {
        const bullpenError = validateDispatchJobTypeBullpen(updates.data);
        if (bullpenError) {
          return res.status(400).json({ message: bullpenError });
        }
      }

      if (type === "note-type" && updates.data !== undefined) {
        const entityTypeError = validateNoteTypeEntityTypes(updates.data);
        if (entityTypeError) {
          return res.status(400).json({ message: entityTypeError });
        }
      }

      if (type === "worker-ban-type" && updates.data !== undefined) {
        const pluginError = await validateWorkerBanTypePlugins(updates.data);
        if (pluginError) {
          return res.status(400).json({ message: pluginError });
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

      // A note type still used by any note cannot be deleted. The FK is ON
      // DELETE RESTRICT so the database would refuse anyway; this pre-check
      // turns that into a message that says what to do about it.
      if (type === "note-type") {
        const inUse = await storage.notes.countByTypeId(id);
        if (inUse > 0) {
          return res.status(409).json({
            message: `This note type is used by ${inUse} note${inUse === 1 ? "" : "s"} and cannot be deleted. Retype or delete those notes first.`,
          });
        }
      }

      // A note tag type with tags under it cannot be deleted — the FK would
      // cascade the tags (and their note assignments) away silently, so we
      // guard here and tell the admin what to remove first.
      if (type === "bao-notes-tag-type") {
        const tags = await getOptionsStorage().list("bao-notes-tag");
        const inUse = tags.filter((t: any) => t.tagTypeId === id).length;
        if (inUse > 0) {
          return res.status(409).json({
            message: `This tag type has ${inUse} tag${inUse === 1 ? "" : "s"} under it and cannot be deleted. Delete or re-type those tags first.`,
          });
        }
      }

      // A worker ban type referenced by any ban cannot be deleted —
      // `worker_bans.type` is a soft reference (no FK), so guard here to
      // avoid orphaning bans onto an unknown (unenforced) type.
      if (type === "worker-ban-type") {
        const allBans = await storage.workerBans.getAll();
        if (allBans.some((ban) => ban.type === id)) {
          return res.status(409).json({
            message:
              "This ban type is used by one or more worker bans and cannot be deleted. Remove or retype those bans first.",
          });
        }
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
        return res.status(409).json({
          message: `This ${config?.name ?? "option"} is in use and cannot be deleted. Remove it from everything that references it first.`,
        });
      }
      res.status(500).json({ message: `Failed to delete option` });
    }
  });
}
