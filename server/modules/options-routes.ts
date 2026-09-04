import type { Express, Request, Response, NextFunction } from "express";
import { getOptionsType, getAllOptionsTypes, getOptionsStorage } from "./options-registry";
import { requireAccess } from "../services/access-policy-evaluator";
import { OptionsTypeName, getOptionsCatalog } from "../storage/unified-options";
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
import {
  mergeOptionData,
  validateWorkerMsDataThreshold,
} from "@shared/worker-ms-threshold";

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

  // GET /api/options/catalog - Name + description of every options type.
  //
  // Deliberately the lightest gate on this router: it answers "what dropdown
  // lists exist and what are they called" — category names, no contents and no
  // configuration — so any signed-in user may ask. The screens built on it
  // (the config navigation, the options index) stay admin-only through their
  // own route gates. Component gating is not applied here; each entry carries
  // its `requiredComponent` so callers gate exactly as they do for the rest of
  // the navigation, and the per-type routes still refuse a disabled list.
  //
  // NOTE: must stay ahead of the generic `/api/options/:type` route below.
  app.get("/api/options/catalog", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      res.json(getOptionsCatalog());
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options catalog" });
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

  // Usage-alert dimensions. The three web service usage alert notifiers let an
  // admin pick what to watch: an outgoing service (and optionally one of its
  // request types), an incoming service plugin (and optionally one of its
  // operations), or an incoming client. Read-only, admin-only — the usage
  // dashboard cards these alerts mirror are admin-gated too.
  //
  // The registry-backed lists come from the registries, NOT from what the
  // counters happen to have seen: a service nobody has called yet is exactly
  // the one an admin most wants a first alert on, and a list built from
  // counted rows could not offer it. Register BEFORE the generic
  // `/api/options/:type` so these match first.
  app.get(
    "/api/options/wc-service",
    requireAccess('admin'),
    async (_req: Request, res: Response) => {
      try {
        const { listWcRequests } = await import("../services/webclient");
        const services = Array.from(
          new Set(listWcRequests().map((b) => b.service)),
        ).sort((a, b) => a.localeCompare(b));
        res.json(services.map((service) => ({ id: service, name: service })));
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch outgoing services" });
      }
    },
  );

  app.get(
    "/api/options/wc-request-type",
    requireAccess('admin'),
    async (_req: Request, res: Response) => {
      try {
        const { listWcRequests } = await import("../services/webclient");
        // A request type is only unique within its service ("lookup" belongs
        // to more than one), so the option is the bare request type and the
        // label names the services that have one, letting the admin see which
        // service to pair it with.
        const servicesByType = new Map<string, string[]>();
        for (const behavior of listWcRequests()) {
          const services = servicesByType.get(behavior.requestType) ?? [];
          if (!services.includes(behavior.service)) services.push(behavior.service);
          servicesByType.set(behavior.requestType, services);
        }
        const options = Array.from(servicesByType.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([requestType, services]) => ({
            id: requestType,
            name: `${requestType} (${services.sort().join(", ")})`,
          }));
        res.json(options);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch outgoing request types" });
      }
    },
  );

  app.get(
    "/api/options/ws-service-plugin",
    requireAccess('admin'),
    async (_req: Request, res: Response) => {
      try {
        const { webServiceRegistry } = await import("../plugins/web-service/registry");
        const plugins = await webServiceRegistry.listEnabledAsync();
        res.json(
          plugins
            .map((p) => ({ id: p.id, name: p.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch web service plugins" });
      }
    },
  );

  app.get(
    "/api/options/ws-operation",
    requireAccess('admin'),
    async (_req: Request, res: Response) => {
      try {
        const { webServiceRegistry } = await import("../plugins/web-service/registry");
        const plugins = await webServiceRegistry.listEnabledAsync();
        // Same as request types: an operation name is unique within its
        // plugin, so the label names the plugins offering it.
        const pluginsByOperation = new Map<string, string[]>();
        for (const plugin of plugins) {
          for (const operation of plugin.operations) {
            const owners = pluginsByOperation.get(operation.name) ?? [];
            if (!owners.includes(plugin.name)) owners.push(plugin.name);
            pluginsByOperation.set(operation.name, owners);
          }
        }
        const options = Array.from(pluginsByOperation.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([operation, owners]) => ({
            id: operation,
            name: `${operation} (${owners.sort().join(", ")})`,
          }));
        res.json(options);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch web service operations" });
      }
    },
  );

  app.get(
    "/api/options/ws-client",
    requireAccess('admin'),
    async (_req: Request, res: Response) => {
      try {
        const clients = await storage.wsClients.getAll();
        res.json(
          clients
            .map((c) => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch web service clients" });
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
      if (type === "bao-case-status" && data.closed !== undefined && typeof data.closed !== "boolean") {
        return res.status(400).json({ message: "closed must be a boolean" });
      }
      if (type === "bao-case-status" && data.lapseStatusId) {
        const statuses = await getOptionsStorage().list("bao-case-status");
        const target = statuses.find((s: any) => s.id === data.lapseStatusId);
        if (!target || target.caseTypeId !== data.caseTypeId) return res.status(400).json({ message: "Lapse status must belong to the same case type" });
        if (target.closed && !target.defaultResolutionId) return res.status(400).json({ message: "A closed lapse status must have a default resolution" });
      }

      // Member statuses: the BAO hours threshold lives at the canonical
      // nested path data.sitespecific.bao.threshold. Validate it and
      // canonicalize the payload (null leaves — the "cleared" signal from
      // the form — are pruned rather than persisted).
      if (type === "worker-ms" && data.data !== undefined && data.data !== null) {
        const thresholdError = validateWorkerMsDataThreshold(data.data);
        if (thresholdError) {
          return res.status(400).json({ message: thresholdError });
        }
        data.data = mergeOptionData({}, data.data as Record<string, unknown>);
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
      if (type === "bao-case-status" && updates.lapseStatusId) {
        const current = await getOptionsStorage().get(type as OptionsTypeName, id);
        const statuses = await getOptionsStorage().list("bao-case-status");
        const target = statuses.find((s: any) => s.id === updates.lapseStatusId);
        const caseTypeId = updates.caseTypeId ?? (current as any)?.caseTypeId;
        if (!target || target.caseTypeId !== caseTypeId) return res.status(400).json({ message: "Lapse status must belong to the same case type" });
        if (target.closed && !target.defaultResolutionId) return res.status(400).json({ message: "A closed lapse status must have a default resolution" });
      }

      // Member statuses: a `data` update is a DEEP MERGE into the row's
      // current JSON, never a whole-column replacement — saving the managed
      // threshold (or any other worker-ms field) must not erase unrelated
      // member-status JSON (e.g. loader-carried keys). An explicit `null`
      // LEAF deletes that key; a top-level `data: null` whole-column erase is
      // rejected outright — there is no supported way to wipe the JSON in one
      // call. The threshold slot itself is validated as a non-negative whole
      // number of hours.
      if (type === "worker-ms" && updates.data !== undefined) {
        if (updates.data === null) {
          return res.status(400).json({
            message:
              "data cannot be null: member-status JSON updates are merged, not replaced. Clear individual keys with explicit null leaves instead.",
          });
        }
        const thresholdError = validateWorkerMsDataThreshold(updates.data);
        if (thresholdError) {
          return res.status(400).json({ message: thresholdError });
        }
        const current = await config.get(id);
        if (!current) {
          return res.status(404).json({ message: `${config.name} not found` });
        }
        updates.data = mergeOptionData(current.data, updates.data as Record<string, unknown>);
      }

      // Status classification is live case state, not presentation metadata.
      // Refuse a flip that would leave an existing case with the wrong
      // resolution shape (closing without one, or opening while retaining it).
      if (type === "bao-case-status" && updates.closed !== undefined) {
        if (typeof updates.closed !== "boolean") {
          return res.status(400).json({ message: "closed must be a boolean" });
        }
      }
      
      // BAO status classification is synchronized with case writes using the
      // status-row lock in baoCases. Do not split its conflict check from the
      // update: a case create/update otherwise could race the classification.
      const item = type === "bao-case-status" && updates.closed !== undefined
        ? await storage.baoCases.updateStatusClassificationAtomically(id, updates)
        : await config.update(id, updates);

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
      if (error?.message === "STATUS_CLASSIFICATION_CONFLICT") {
        return res.status(409).json({
          message: "This classification change would invalidate existing BAO cases. Transition those cases first.",
        });
      }
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
