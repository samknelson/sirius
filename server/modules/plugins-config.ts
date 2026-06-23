import type { Express, Request, Response, NextFunction } from "express";
import { getPluginKind, enforceKindGating, getPluginConfigAdapter, defaultHydrate, type PluginConfigEnvelopeField } from "../plugins/_core";
import { storage } from "../storage";
import { SingletonViolationError } from "../storage/plugin-configs";
import { runInTransaction } from "../storage/transaction-context";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Kinds that still own dedicated, authoritative config routes + legacy
 * storage tables and have NOT been cut over to the unified plugin_configs
 * tables yet. The generic routes refuse to operate on these so there is
 * exactly one authoritative config surface per kind. Remove a kind from this
 * set in the same task that cuts it over. (Charge was cut over in Task #355;
 * the set is now empty but kept for the remaining legacy kinds' migrations.)
 */
const LEGACY_OWNED_KINDS = new Set<string>([]);

/**
 * Generic plugin configuration CRUD + search endpoints (Task #353 — additive
 * foundation). Every config-bearing kind shares these URLs; all kind-specific
 * behavior is delegated to the per-kind adapter (see
 * `server/plugins/_core/config-adapter.ts`). No kind has been cut over to
 * this storage yet, so these endpoints operate purely on the new
 * `plugin_configs` tables and do not affect any existing feature.
 *
 * Auth/gating mirrors the unified manifest/admin endpoints: the route
 * requires authentication and the kind's `requiredComponent` /
 * `requiredPolicy` are enforced before any work.
 *
 * Endpoints:
 *   GET    /api/plugins/:kind/configs           list (hydrated)
 *   POST   /api/plugins/:kind/configs           create
 *   POST   /api/plugins/:kind/configs/search    search (filters in body)
 *   GET    /api/plugins/:kind/configs/:id       read one (hydrated)
 *   PATCH  /api/plugins/:kind/configs/:id       update
 *   DELETE /api/plugins/:kind/configs/:id       delete
 */
export function registerPluginsConfigRoutes(app: Express, requireAuth: AuthMiddleware) {
  // Resolve the kind registration (for gating) + its config adapter, after
  // enforcing kind-level gating. Returns null after sending an error.
  async function resolve(req: Request, res: Response) {
    const { kind } = req.params;
    if (LEGACY_OWNED_KINDS.has(kind)) {
      // Not yet cut over — its dedicated routes remain authoritative.
      res.status(404).json({ message: `Kind '${kind}' is not served by the unified config endpoints` });
      return null;
    }
    const registration = getPluginKind(kind);
    if (!registration) {
      res.status(404).json({ message: `Unknown plugin kind: ${kind}` });
      return null;
    }
    const gate = await enforceKindGating(
      {
        requiredComponent: registration.requiredComponent,
        requiredPolicy: registration.requiredPolicy,
      },
      req,
    );
    if (!gate.ok) {
      res.status(gate.status).json({ message: gate.message });
      return null;
    }
    const adapter = getPluginConfigAdapter(kind);
    if (!adapter) {
      res.status(404).json({ message: `Kind '${kind}' has no config adapter` });
      return null;
    }
    return { kind, adapter, registration };
  }

  const hydrate = (adapter: ReturnType<typeof getPluginConfigAdapter>, envelope: any) =>
    adapter?.hydrate ? adapter.hydrate(envelope) : defaultHydrate(envelope);

  /**
   * Whether the plugin identified by `pluginId` is registered as a singleton
   * (exactly one config row allowed). Unknown plugin ids resolve to false; the
   * separate plugin-validity check rejects those.
   */
  function isSingletonPlugin(
    registration: NonNullable<Awaited<ReturnType<typeof resolve>>>["registration"],
    pluginId: string,
  ): boolean {
    const plugin = registration.registry.get(pluginId);
    return !!(plugin && registration.registry.getMetadata(plugin).singleton);
  }

  /**
   * Enforce a kind's uniqueness key (if it declares one). Returns true when a
   * conflicting row exists (excluding `selfId`, the row being updated) and has
   * already sent a 409; the caller must stop. Returns false to proceed.
   */
  async function rejectIfDuplicate(
    kind: string,
    adapter: NonNullable<ReturnType<typeof getPluginConfigAdapter>>,
    config: any,
    selfId: string | null,
    res: Response,
  ): Promise<boolean> {
    if (!adapter.uniqueKey) return false;
    const key = adapter.uniqueKey(config);
    if (!key) return false;
    const matches = await storage.pluginConfigs.search(kind, key as any);
    const conflict = matches.find((m) => m.config.id !== selfId);
    if (conflict) {
      res.status(409).json({
        message: "A configuration with this key already exists",
      });
      return true;
    }
    return false;
  }

  /**
   * Resolve the target plugin from the kind's registry and validate the
   * config payload against that plugin's own schema/validator (the same
   * `validateConfig` that backs POST /api/plugins/:kind/:id/validate-config).
   * Returns true when the request may proceed; otherwise sends a 4xx and
   * returns false. This is what stops the unified routes from storing
   * arbitrary `data` against an unknown or mis-configured plugin.
   */
  async function ensureValidPlugin(
    registration: NonNullable<ReturnType<typeof getPluginKind>>,
    pluginId: string,
    data: unknown,
    res: Response,
  ): Promise<boolean> {
    const plugin = registration.registry.get(pluginId);
    if (!plugin) {
      res.status(400).json({ message: `Plugin '${pluginId}' not found in '${registration.kind}' registry` });
      return false;
    }
    // Enforce required per-plugin config fields (declared by the plugin and
    // stored in `data`). This is the authoritative check behind the client-side
    // mirror in the generic admin form. Runs for any kind whose plugins declare
    // `configFields`; kinds/plugins without them are unaffected.
    const configFields = (plugin as { configFields?: PluginConfigEnvelopeField[] }).configFields;
    if (Array.isArray(configFields)) {
      const dataObj = (data ?? {}) as Record<string, unknown>;
      for (const field of configFields) {
        if (!field.required) continue;
        const value = dataObj[field.name];
        const empty =
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim() === "");
        if (empty) {
          res.status(400).json({ message: `${field.label} is required` });
          return false;
        }
      }
    }
    if (registration.validateConfig) {
      const result = await registration.validateConfig(plugin, data ?? {});
      if (!result.valid) {
        res.status(400).json({ message: "Invalid plugin configuration", errors: result.errors ?? [] });
        return false;
      }
    }
    return true;
  }

  app.get("/api/plugins/:kind/configs", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter } = resolved;
      const configs = await storage.pluginConfigs.getByKind(kind);
      const out = await Promise.all(
        configs.map(async (config) => {
          const envelope = await storage.pluginConfigs.getWithSubsidiary(config.id);
          return envelope ? hydrate(adapter, envelope) : null;
        }),
      );
      res.json(out.filter(Boolean));
    } catch (error) {
      console.error("Failed to list plugin configs:", error);
      res.status(500).json({ message: "Failed to list plugin configs" });
    }
  });

  app.post("/api/plugins/:kind/configs/search", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter } = resolved;
      const parsed = adapter.searchParamsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid search parameters", errors: parsed.error.errors });
        return;
      }
      const results = await storage.pluginConfigs.search(kind, parsed.data as any);
      res.json(results.map((envelope) => hydrate(adapter, envelope)));
    } catch (error) {
      console.error("Failed to search plugin configs:", error);
      res.status(500).json({ message: "Failed to search plugin configs" });
    }
  });

  // Per-kind config metadata for the generic admin UI: the relational
  // (subsidiary) fields this kind carries beyond the base envelope. The UI
  // renders one input per field and includes them in create/update payloads.
  // Registered before `/configs/:id` so "meta" is not captured as an id.
  app.get("/api/plugins/:kind/configs/meta", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { adapter, registration } = resolved;
      // Per-plugin config fields, keyed by plugin id. The generic admin form
      // renders these (in addition to the per-kind envelope fields) once a
      // plugin is selected. Values are stored inside the config's `data` json.
      const pluginFields: Record<string, PluginConfigEnvelopeField[]> = {};
      for (const plugin of registration.registry.list()) {
        const fields = (plugin as { configFields?: PluginConfigEnvelopeField[] }).configFields;
        if (Array.isArray(fields) && fields.length > 0) {
          const id = registration.registry.getMetadata(plugin).id;
          pluginFields[id] = fields;
        }
      }
      res.json({ envelopeFields: adapter.envelopeFields ?? [], pluginFields });
    } catch (error) {
      console.error("Failed to fetch plugin config meta:", error);
      res.status(500).json({ message: "Failed to fetch plugin config meta" });
    }
  });

  app.post("/api/plugins/:kind/configs", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      const parsed = adapter.configSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid configuration", errors: parsed.error.errors });
        return;
      }
      // Run toRows first so plugin validation sees the data that will actually
      // be stored. Some adapters (e.g. trust-eligibility) move authoritative
      // fields into `data` here — for example `data.appliesTo`, which RJSF
      // strips on the generic admin form and re-supplies via a top-level
      // envelope field. Validating `base.data` keeps both save paths valid.
      const { base, subsidiary } = adapter.toRows(parsed.data);
      // `siriusId` is a base-table dimension common to every kind, so the
      // generic route threads it through rather than each adapter's `toRows`.
      base.siriusId = (parsed.data as any).siriusId ?? null;
      if (!(await ensureValidPlugin(registration, parsed.data.pluginId, base.data, res))) return;
      if (await rejectIfDuplicate(kind, adapter, parsed.data, null, res)) return;
      const enforceSingleton = isSingletonPlugin(registration, parsed.data.pluginId);
      const created = await runInTransaction(async () => {
        const row = await storage.pluginConfigs.create(base as any, { enforceSingleton });
        if (subsidiary) {
          await storage.pluginConfigs.upsertSubsidiary(kind, { id: row.id, ...subsidiary });
        }
        return row;
      });
      const envelope = await storage.pluginConfigs.getWithSubsidiary(created.id);
      res.status(201).json(envelope ? hydrate(adapter, envelope) : { id: created.id });
    } catch (error) {
      if (error instanceof SingletonViolationError) {
        res.status(409).json({ message: error.message });
        return;
      }
      console.error("Failed to create plugin config:", error);
      res.status(500).json({ message: "Failed to create plugin config" });
    }
  });

  app.get("/api/plugins/:kind/configs/:id", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter } = resolved;
      const envelope = await storage.pluginConfigs.getWithSubsidiary(req.params.id);
      if (!envelope || envelope.config.pluginKind !== kind) {
        res.status(404).json({ message: "Plugin config not found" });
        return;
      }
      res.json(hydrate(adapter, envelope));
    } catch (error) {
      console.error("Failed to fetch plugin config:", error);
      res.status(500).json({ message: "Failed to fetch plugin config" });
    }
  });

  app.patch("/api/plugins/:kind/configs/:id", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      const existingEnvelope = await storage.pluginConfigs.getWithSubsidiary(req.params.id);
      if (!existingEnvelope || existingEnvelope.config.pluginKind !== kind) {
        res.status(404).json({ message: "Plugin config not found" });
        return;
      }
      // Hydrate the FULL existing row (base + subsidiary) and overlay the
      // patch body, so a partial update preserves subsidiary fields the
      // caller didn't send and still satisfies the adapter's config contract.
      const merged = { ...hydrate(adapter, existingEnvelope), ...(req.body ?? {}) };
      const parsed = adapter.configSchema.safeParse(merged);
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid configuration", errors: parsed.error.errors });
        return;
      }
      // See POST: validate the post-toRows `data` (what actually gets stored)
      // so adapters that relocate authoritative fields into `data` stay valid.
      const { base, subsidiary } = adapter.toRows(parsed.data);
      // See POST: `siriusId` is a shared base dimension threaded by the route.
      base.siriusId = (parsed.data as any).siriusId ?? null;
      if (!(await ensureValidPlugin(registration, parsed.data.pluginId, base.data, res))) return;
      if (await rejectIfDuplicate(kind, adapter, parsed.data, req.params.id, res)) return;
      await runInTransaction(async () => {
        await storage.pluginConfigs.update(req.params.id, base as any);
        if (subsidiary) {
          await storage.pluginConfigs.upsertSubsidiary(kind, { id: req.params.id, ...subsidiary });
        }
      });
      const envelope = await storage.pluginConfigs.getWithSubsidiary(req.params.id);
      res.json(envelope ? hydrate(adapter, envelope) : { id: req.params.id });
    } catch (error) {
      console.error("Failed to update plugin config:", error);
      res.status(500).json({ message: "Failed to update plugin config" });
    }
  });

  app.delete("/api/plugins/:kind/configs/:id", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, registration } = resolved;
      const existing = await storage.pluginConfigs.get(req.params.id);
      if (!existing || existing.pluginKind !== kind) {
        res.status(404).json({ message: "Plugin config not found" });
        return;
      }
      const enforceSingleton = isSingletonPlugin(registration, existing.pluginId);
      const ok = await storage.pluginConfigs.delete(req.params.id, { enforceSingleton });
      res.json({ success: ok });
    } catch (error) {
      if (error instanceof SingletonViolationError) {
        res.status(409).json({ message: error.message });
        return;
      }
      console.error("Failed to delete plugin config:", error);
      res.status(500).json({ message: "Failed to delete plugin config" });
    }
  });
}
