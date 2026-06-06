import type { Express, Request, Response, NextFunction } from "express";
import { getPluginKind, enforceKindGating, getPluginConfigAdapter, defaultHydrate } from "../plugins/_core";
import { storage } from "../storage";
import { runInTransaction } from "../storage/transaction-context";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Kinds that still own dedicated, authoritative config routes + legacy
 * storage tables and have NOT been cut over to the unified plugin_configs
 * tables yet. The generic routes refuse to operate on these so there is
 * exactly one authoritative config surface per kind. `charge` keeps its
 * `/api/plugins/charge/configs` routes (legacy chargePluginConfigs table);
 * while route-order precedence already lets the legacy GET/POST/DELETE win,
 * the legacy surface uses PUT (not PATCH), so without this guard the generic
 * PATCH/search would be a second, divergent surface for charge. Remove a
 * kind from this set in the same task that cuts it over.
 */
const LEGACY_OWNED_KINDS = new Set<string>(["charge"]);

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
    return { kind, adapter };
  }

  const hydrate = (adapter: ReturnType<typeof getPluginConfigAdapter>, envelope: any) =>
    adapter?.hydrate ? adapter.hydrate(envelope) : defaultHydrate(envelope);

  app.get("/api/plugins/:kind/configs", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter } = resolved;
      const configs = await storage.pluginConfigs.getByType(kind);
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

  app.post("/api/plugins/:kind/configs", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter } = resolved;
      const parsed = adapter.configSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid configuration", errors: parsed.error.errors });
        return;
      }
      const { base, subsidiary } = adapter.toRows(parsed.data);
      const created = await runInTransaction(async () => {
        const row = await storage.pluginConfigs.create(base as any);
        if (subsidiary) {
          await storage.pluginConfigs.upsertSubsidiary(kind, { id: row.id, ...subsidiary });
        }
        return row;
      });
      const envelope = await storage.pluginConfigs.getWithSubsidiary(created.id);
      res.status(201).json(envelope ? hydrate(adapter, envelope) : { id: created.id });
    } catch (error) {
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
      if (!envelope || envelope.config.pluginType !== kind) {
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
      const { kind, adapter } = resolved;
      const existingEnvelope = await storage.pluginConfigs.getWithSubsidiary(req.params.id);
      if (!existingEnvelope || existingEnvelope.config.pluginType !== kind) {
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
      const { base, subsidiary } = adapter.toRows(parsed.data);
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
      const { kind } = resolved;
      const existing = await storage.pluginConfigs.get(req.params.id);
      if (!existing || existing.pluginType !== kind) {
        res.status(404).json({ message: "Plugin config not found" });
        return;
      }
      const ok = await storage.pluginConfigs.delete(req.params.id);
      res.json({ success: ok });
    } catch (error) {
      console.error("Failed to delete plugin config:", error);
      res.status(500).json({ message: "Failed to delete plugin config" });
    }
  });
}
