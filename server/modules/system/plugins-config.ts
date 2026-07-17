import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getPluginKind, enforceKindGating, enforcePluginGating, getPluginConfigAdapter, defaultHydrate, type PluginConfigEnvelopeField } from "../../plugins/_core";
import { storage } from "../../storage";
import { SingletonViolationError } from "../../storage/system/plugin-configs";
import { runInTransaction } from "../../storage/transaction-context";

/**
 * Bulk operations are only meaningful for the trust-eligibility kind, whose
 * configs fan out across policy × benefit × phase. The generic bulk routes
 * guard on this so other kinds keep their one-config-at-a-time surface.
 */
const BULK_SUPPORTED_KIND = "trust-eligibility";

/** Phases a trust-eligibility config can apply to (scan types). */
const ELIGIBILITY_PHASES = ["start", "continue"] as const;

/** Body schema for POST /configs/bulk (fan one plugin+settings across many). */
const bulkCreateSchema = z.object({
  pluginId: z.string().min(1),
  policy: z.string().min(1),
  benefits: z.array(z.string().min(1)).min(1),
  phases: z.array(z.enum(ELIGIBILITY_PHASES)).min(1),
  data: z.record(z.unknown()).optional().default({}),
  name: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(false),
  ordering: z.number().int().optional().default(0),
  // When true, targets that collide with an existing config replace it
  // instead of failing: the targeted phase is carved out of the existing
  // row (a combined "start,continue" row keeps its untargeted phase), and
  // rows left with no phases are deleted before the new configs are created.
  overwrite: z.boolean().optional().default(false),
  // When true, each benefit gets ONE config covering all requested phases
  // (combined appliesTo, e.g. "start,continue") instead of one config per
  // (benefit, phase). Used by "add benefits to an existing group" so the
  // new rows share the group's exact fingerprint and merge into its row.
  combinePhases: z.boolean().optional().default(false),
});

/** Body schema for POST /configs/merge-phases (combine phase-split rows). */
const mergePhasesSchema = z.object({
  pluginId: z.string().min(1),
  policy: z.string().min(1),
});

/** Recursively sort object keys so JSON.stringify is order-insensitive. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

/** Body schema for POST /configs/bulk-settings (one settings change → many). */
const bulkSettingsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  data: z.record(z.unknown()).optional().default({}),
  enabled: z.boolean().optional(),
  // Optional phase override: when present, every selected config's appliesTo
  // is replaced by this list (subject to conflict validation). Absent =
  // preserve each config's existing phases (the legacy behavior).
  phases: z.array(z.enum(ELIGIBILITY_PHASES)).min(1).optional(),
});

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Thrown inside a write transaction when the in-transaction phase-conflict
 * re-check finds a duplicate benefit × phase target. Rolls the transaction
 * back; the route translates it into the same structured 409 the
 * pre-transaction era returned. Carrying the conflict list on the error keeps
 * the response contract identical.
 */
class PhaseConflictError extends Error {
  constructor(public readonly conflicts: Array<{ benefit: string; phase: string }>) {
    super("Benefit/phase combination already has a configuration for this plugin");
    this.name = "PhaseConflictError";
  }
}

/**
 * Advisory-lock key serializing every trust-eligibility config write for one
 * plugin. Acquired (inside the write transaction) before the conflict
 * re-check, so two admins saving simultaneously queue behind each other and
 * the second one's check sees the first one's committed rows — duplicates
 * become impossible instead of merely unlikely.
 */
const eligibilityLockKey = (pluginId: string) => `plugin-config:trust-eligibility:${pluginId}`;

/**
 * Token-aware duplicate scan for trust-eligibility targets: for each
 * (policy, benefit, phase) triple, find configs of `pluginId` whose
 * appliesTo contains that phase (including combined "start,continue" rows),
 * ignoring ids in `excludeIds` (the rows being updated / the selection).
 * Call it INSIDE the write transaction, after acquiring the advisory lock,
 * for a race-free guarantee.
 */
async function findPhaseConflicts(
  kind: string,
  pluginId: string,
  targets: Array<{ policy: string | null; benefit: string | null; phases: string[] }>,
  excludeIds: Set<string>,
): Promise<Array<{ benefit: string; phase: string }>> {
  const conflicts: Array<{ benefit: string; phase: string }> = [];
  for (const target of targets) {
    for (const phase of target.phases) {
      const matches = await storage.pluginConfigs.search(kind, {
        policy: target.policy,
        pluginId,
        benefit: target.benefit,
        appliesTo: phase,
      } as any);
      if (matches.some((m) => !excludeIds.has(m.config.id))) {
        conflicts.push({ benefit: target.benefit ?? "", phase });
      }
    }
  }
  return conflicts;
}

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
   * Collapse phase-split trust-eligibility configs into combined rows for a
   * given plugin + policy. Any set of configs targeting the same benefit with
   * identical settings, enabled state, and name — but disjoint phase lists
   * (e.g. a Start-only and a Continue-only row) — is merged into one config
   * whose appliesTo is the union of the phases. The survivor is the first row
   * by (ordering, id); the rest are deleted. Purely structural: scan-time
   * behavior is unchanged.
   *
   * MUST be called inside a write transaction. Acquires (re-acquires) the
   * plugin's advisory lock, which is safe when the caller already holds it.
   * Called automatically at the end of every eligibility config write so
   * mergeable pairs never linger; also exposed via POST /configs/merge-phases.
   */
  async function mergePhaseSplitConfigs(
    kind: string,
    adapter: NonNullable<ReturnType<typeof getPluginConfigAdapter>>,
    pluginId: string,
    policy: string,
  ): Promise<{ mergedGroups: number; removed: number; survivorMap: Record<string, string> }> {
    await storage.pluginConfigs.acquireWriteLock(eligibilityLockKey(pluginId));

    const envelopes = await storage.pluginConfigs.search(kind, {
      policy,
      pluginId,
    } as any);

    // Group by everything EXCEPT phases: benefit + settings (minus the
    // appliesTo mirror) + enabled + name. Only groups whose members have
    // pairwise-disjoint phases are merged; overlapping phases mean true
    // duplicates, which merge must not silently resolve.
    const groups = new Map<string, typeof envelopes>();
    for (const env of envelopes) {
      const data = (env.config.data as Record<string, unknown>) ?? {};
      const { appliesTo: _omit, ...rest } = data;
      const benefit = (env.subsidiary as any)?.benefit ?? null;
      const key = JSON.stringify({
        benefit,
        data: sortKeysDeep(rest),
        enabled: env.config.enabled,
        name: env.config.name ?? null,
      });
      const list = groups.get(key) ?? [];
      list.push(env);
      groups.set(key, list);
    }

    let mergedGroups = 0;
    let removed = 0;
    // Deleted config id → the surviving combined row's id, so callers whose
    // just-written row got merged away can respond with the live id.
    const survivorMap: Record<string, string> = {};
    for (const list of groups.values()) {
      if (list.length < 2) continue;

      // Collect each member's phases; bail on this group if any phase
      // appears twice (overlap = genuine duplicates, skip).
      const seen = new Set<string>();
      let overlap = false;
      for (const env of list) {
        const data = (env.config.data as Record<string, unknown>) ?? {};
        const raw = (env.subsidiary as any)?.appliesTo ?? data.appliesTo;
        const phases = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(","))
          .map((s: string) => s.trim())
          .filter(Boolean);
        for (const p of phases) {
          if (seen.has(p)) overlap = true;
          seen.add(p);
        }
      }
      if (overlap || seen.size === 0) continue;

      // Survivor: first by (ordering, id) — mirrors the canonical-row
      // convention used everywhere else in plugin configs.
      const order = list
        .map((env, i) => ({ env, i }))
        .sort(
          (a, b) =>
            (a.env.config.ordering ?? 0) - (b.env.config.ordering ?? 0) ||
            a.env.config.id.localeCompare(b.env.config.id),
        );
      const survivor = order[0].env;
      const union = ELIGIBILITY_PHASES.filter((p) => seen.has(p));

      const existingData = (survivor.config.data as Record<string, unknown>) ?? {};
      const mergedData = { ...existingData, appliesTo: union };
      const hydrated = hydrate(adapter, survivor) as Record<string, unknown>;
      const { subsidiary } = adapter.toRows({
        ...hydrated,
        data: mergedData,
        appliesTo: union.join(","),
      } as any);
      await storage.pluginConfigs.update(survivor.config.id, { data: mergedData } as any);
      if (subsidiary) {
        await storage.pluginConfigs.upsertSubsidiary(kind, {
          id: survivor.config.id,
          ...subsidiary,
        });
      }
      for (const { env } of order.slice(1)) {
        await storage.pluginConfigs.delete(env.config.id);
        survivorMap[env.config.id] = survivor.config.id;
        removed += 1;
      }
      mergedGroups += 1;
    }
    return { mergedGroups, removed, survivorMap };
  }

  /**
   * Per-plugin component + access-policy gate. `resolve()` only enforces
   * the kind-level gate, which covers kinds that declare a kind-wide
   * `requiredComponent` (e.g. charge → ledger). It does NOT cover the
   * common cases that leak through these generic config routes:
   *
   *   - Kinds with NO kind-level component whose individual plugins are
   *     component-owned (dashboard widgets, trust-eligibility plugins).
   *   - Component-gated kinds whose sub-plugins belong to finer-grained
   *     optional components (e.g. charge's `sitespecific.btu` plugins,
   *     dispatch-eligibility's `dispatch.eba` plugins) — the kind gate
   *     passes but the plugin's own component is disabled.
   *
   * Without this, an authenticated admin could read or mutate a disabled
   * feature's config rows directly even though the manifest + admin
   * endpoints already hide them via the same gate. Mirrors
   * `plugins-admin.ts` (single-plugin endpoints) exactly.
   *
   * Unknown plugin ids fall through (`ok`) so the existing 400/404 paths
   * (`ensureValidPlugin`, kind/id mismatch checks) handle them.
   */
  async function pluginGate(
    registration: NonNullable<ReturnType<typeof getPluginKind>>,
    pluginId: string | null | undefined,
    req: Request,
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    if (!pluginId) return { ok: true };
    const plugin = registration.registry.get(pluginId);
    if (!plugin) return { ok: true };
    return enforcePluginGating(registration.registry.getMetadata(plugin), req);
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
      const { kind, adapter, registration } = resolved;
      const configs = await storage.pluginConfigs.getByKind(kind);
      const out = await Promise.all(
        configs.map(async (config) => {
          // Hide configs whose plugin's component is disabled (or which the
          // user may not access) so a disabled feature's rows never leak.
          if (!(await pluginGate(registration, config.pluginId, req)).ok) return null;
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
      const { kind, adapter, registration } = resolved;
      const parsed = adapter.searchParamsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid search parameters", errors: parsed.error.errors });
        return;
      }
      const results = await storage.pluginConfigs.search(kind, parsed.data as any);
      const out: any[] = [];
      for (const envelope of results) {
        // Drop disabled-component (or inaccessible) plugins' rows from results.
        if (!(await pluginGate(registration, envelope.config.pluginId, req)).ok) continue;
        out.push(hydrate(adapter, envelope));
      }
      res.json(out);
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
        const meta = registration.registry.getMetadata(plugin);
        // Skip field metadata for plugins whose component is disabled (or
        // which the user may not access) so disabled features stay hidden.
        if (!(await enforcePluginGating(meta, req)).ok) continue;
        const fields = (plugin as { configFields?: PluginConfigEnvelopeField[] }).configFields;
        if (Array.isArray(fields) && fields.length > 0) {
          pluginFields[meta.id] = fields;
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
      // Refuse to create a config for a plugin whose component is disabled
      // (or which the user may not access) before doing any work.
      const createGate = await pluginGate(registration, parsed.data.pluginId, req);
      if (!createGate.ok) {
        res.status(createGate.status).json({ message: createGate.message });
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
      const { row: created, survivorMap: createSurvivorMap } = await runInTransaction(async () => {
        // Trust-eligibility: (policy, plugin, benefit, phase) must be unique.
        // Serialize on the plugin's advisory lock and check INSIDE the write
        // transaction so a simultaneous save cannot slip a duplicate past a
        // pre-transaction check.
        if (kind === BULK_SUPPORTED_KIND && subsidiary) {
          await storage.pluginConfigs.acquireWriteLock(eligibilityLockKey(parsed.data.pluginId));
          const targetPhases = Array.isArray((base.data as any)?.appliesTo)
            ? ((base.data as any).appliesTo as string[])
            : [];
          const conflicts = await findPhaseConflicts(
            kind,
            parsed.data.pluginId,
            [
              {
                policy: (subsidiary as any).policy ?? null,
                benefit: (subsidiary as any).benefit ?? null,
                phases: targetPhases,
              },
            ],
            new Set(),
          );
          if (conflicts.length > 0) throw new PhaseConflictError(conflicts);
        }
        // Singleton enforcement is decided by the storage layer from the plugin
        // type's manifest; the route no longer computes/passes it.
        const row = await storage.pluginConfigs.create(base as any);
        if (subsidiary) {
          await storage.pluginConfigs.upsertSubsidiary(kind, { id: row.id, ...subsidiary });
        }
        // Auto-merge: if this new row is the phase-complement of an existing
        // row with identical settings (e.g. Start-only next to Continue-only),
        // collapse them into one combined row right away.
        let survivorMap: Record<string, string> = {};
        if (kind === BULK_SUPPORTED_KIND && subsidiary && (subsidiary as any).policy) {
          ({ survivorMap } = await mergePhaseSplitConfigs(
            kind,
            adapter,
            parsed.data.pluginId,
            (subsidiary as any).policy,
          ));
        }
        return { row, survivorMap };
      });
      // If the auto-merge folded the new row into an existing survivor,
      // respond with the surviving combined row, not the deleted id.
      const createdId = createSurvivorMap[created.id] ?? created.id;
      const envelope = await storage.pluginConfigs.getWithSubsidiary(createdId);
      res.status(201).json(envelope ? hydrate(adapter, envelope) : { id: createdId });
    } catch (error) {
      if (error instanceof SingletonViolationError) {
        res.status(409).json({ message: error.message });
        return;
      }
      if (error instanceof PhaseConflictError) {
        res.status(409).json({
          message: "Another configuration already covers this benefit/phase combination for this plugin",
          conflicts: error.conflicts,
        });
        return;
      }
      console.error("Failed to create plugin config:", error);
      res.status(500).json({ message: "Failed to create plugin config" });
    }
  });

  // Bulk-create: fan ONE plugin + settings across many benefit × phase
  // combinations. Each (benefit, phase) becomes its own config (single-phase
  // appliesTo). All-or-nothing: if any target collides with an existing config
  // for the same policy + plugin + benefit + phase, nothing is created and the
  // full conflict list is returned. Registered before `/configs/:id` so "bulk"
  // is never captured as an id.
  app.post("/api/plugins/:kind/configs/bulk", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      if (kind !== BULK_SUPPORTED_KIND) {
        res.status(400).json({ message: `Bulk operations are not supported for kind '${kind}'` });
        return;
      }
      const parsed = bulkCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid bulk request", errors: parsed.error.errors });
        return;
      }
      const { pluginId, policy, benefits, phases, data, name, enabled, ordering, overwrite, combinePhases } =
        parsed.data;
      // De-dupe selections so we don't fan duplicate (benefit, phase) targets.
      const uniqueBenefits = Array.from(new Set(benefits));
      const uniquePhases = Array.from(new Set(phases));

      // Validate the plugin + settings once — the settings payload is identical
      // for every generated config, so a single pass through the plugin's
      // validator (with the full phase list) is authoritative.
      const repInput = {
        pluginId,
        name: name ?? null,
        enabled: enabled ?? false,
        ordering: ordering ?? 0,
        data,
        policy,
        benefit: uniqueBenefits[0],
        appliesTo: uniquePhases.join(","),
      };
      const { base: repBase } = adapter.toRows(repInput);
      if (!(await ensureValidPlugin(registration, pluginId, repBase.data, res))) return;

      // Build the target rows: by default one config per (benefit, phase);
      // with combinePhases, one config per benefit covering all phases.
      const phaseSets = combinePhases
        ? [uniquePhases.join(",")]
        : uniquePhases;
      const rows = [] as Array<{ base: any; subsidiary: any }>;
      for (const benefit of uniqueBenefits) {
        for (const appliesTo of phaseSets) {
          const { base, subsidiary } = adapter.toRows({
            pluginId,
            name: name ?? null,
            enabled: enabled ?? false,
            ordering: ordering ?? 0,
            data,
            policy,
            benefit,
            appliesTo,
          });
          base.siriusId = null;
          rows.push({ base, subsidiary });
        }
      }

      const { created, replaced } = await runInTransaction(async () => {
        // Conflict handling INSIDE the write transaction, serialized on the
        // plugin's advisory lock: for each (benefit, phase) target, a
        // token-aware search catches existing configs whose appliesTo
        // contains that phase (including combined "start,continue" rows).
        // With overwrite, colliding rows are carved/replaced; without it,
        // any collision 409s. Two simultaneous bulk-creates queue on the
        // lock, so the second one sees the first one's committed rows.
        await storage.pluginConfigs.acquireWriteLock(eligibilityLockKey(pluginId));

        let replacedCount = 0;
        if (overwrite) {
          // Overwrite mode: instead of 409ing, carve every targeted
          // (benefit, phase) out of the existing configs that cover it. A
          // config whose phases are all targeted is deleted outright; a
          // combined row that also covers an untargeted phase keeps that
          // phase (its settings are untouched — only the targeted phase now
          // belongs to the freshly created config).
          const phasesToRemove = new Map<string, { env: any; benefit: string; remove: Set<string> }>();
          for (const benefit of uniqueBenefits) {
            for (const phase of uniquePhases) {
              const matches = await storage.pluginConfigs.search(kind, {
                policy,
                pluginId,
                benefit,
                appliesTo: phase,
              } as any);
              for (const env of matches) {
                const entry = phasesToRemove.get(env.config.id) ?? {
                  env,
                  benefit,
                  remove: new Set<string>(),
                };
                entry.remove.add(phase);
                phasesToRemove.set(env.config.id, entry);
              }
            }
          }
          for (const { env, remove } of phasesToRemove.values()) {
            const existingData = (env.config.data as Record<string, unknown>) ?? {};
            const rawApplies = (env.subsidiary as any)?.appliesTo ?? existingData.appliesTo;
            const existingPhases = (
              Array.isArray(rawApplies)
                ? rawApplies.map(String)
                : String(rawApplies ?? "").split(",")
            )
              .map((s: string) => s.trim())
              .filter(Boolean);
            const remaining = existingPhases.filter((p: string) => !remove.has(p));
            if (remaining.length === 0) {
              await storage.pluginConfigs.delete(env.config.id);
            } else {
              const hydrated = hydrate(adapter, env) as Record<string, unknown>;
              const trimmedData = { ...existingData, appliesTo: remaining };
              const { subsidiary } = adapter.toRows({
                ...hydrated,
                data: trimmedData,
                appliesTo: remaining.join(","),
              } as any);
              await storage.pluginConfigs.update(env.config.id, { data: trimmedData } as any);
              if (subsidiary) {
                await storage.pluginConfigs.upsertSubsidiary(kind, {
                  id: env.config.id,
                  ...subsidiary,
                });
              }
            }
            replacedCount += 1;
          }
        } else {
          const conflicts = await findPhaseConflicts(
            kind,
            pluginId,
            uniqueBenefits.map((benefit) => ({ policy, benefit, phases: uniquePhases })),
            new Set(),
          );
          if (conflicts.length > 0) throw new PhaseConflictError(conflicts);
        }
        const createdRows = await storage.pluginConfigs.bulkCreateWithSubsidiary(kind, rows);
        // Auto-merge phase-split rows left behind (or just created) so
        // Start-only/Continue-only pairs with identical settings collapse
        // into combined rows without user intervention.
        await mergePhaseSplitConfigs(kind, adapter, pluginId, policy);
        return { created: createdRows, replaced: replacedCount };
      });
      res.status(201).json({ created: created.length, replaced });
    } catch (error) {
      if (error instanceof PhaseConflictError) {
        res.status(409).json({
          message: "Some selected benefit/phase combinations already have a configuration for this plugin",
          conflicts: error.conflicts,
        });
        return;
      }
      console.error("Failed to bulk-create plugin configs:", error);
      res.status(500).json({ message: "Failed to bulk-create plugin configs" });
    }
  });

  // Merge-phases: collapse phase-split trust-eligibility configs into
  // combined rows. For a given plugin + policy, any set of configs that
  // target the same benefit with identical settings, enabled state, and
  // name — but disjoint phase lists (e.g. a Start-only and a Continue-only
  // row) — is merged into one config whose appliesTo is the union of the
  // phases. The survivor is the first row by (ordering, id); the rest are
  // deleted. Purely a structural cleanup: scan-time behavior is unchanged.
  app.post("/api/plugins/:kind/configs/merge-phases", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      if (kind !== BULK_SUPPORTED_KIND) {
        res.status(400).json({ message: `Merge is not supported for kind '${kind}'` });
        return;
      }
      const parsed = mergePhasesSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid merge request", errors: parsed.error.errors });
        return;
      }
      const { pluginId, policy } = parsed.data;
      // Plugin-level gating: component-scoped plugins must not be mutable
      // when their component is disabled / inaccessible to this user.
      // Mirrors the create/update routes.
      const gate = await pluginGate(registration, pluginId, req);
      if (!gate.ok) {
        res.status(gate.status).json({ message: gate.message });
        return;
      }
      if (!registration.registry.get(pluginId)) {
        res.status(400).json({ message: `Unknown plugin '${pluginId}' for kind '${kind}'` });
        return;
      }

      const result = await runInTransaction(() =>
        mergePhaseSplitConfigs(kind, adapter, pluginId, policy),
      );

      res.json({ merged: result.mergedGroups, removed: result.removed });
    } catch (error) {
      console.error("Failed to merge plugin configs:", error);
      res.status(500).json({ message: "Failed to merge plugin configs" });
    }
  });

  // Bulk apply-settings: push ONE settings payload across a multi-selection of
  // existing configs. All selected configs must be this kind and share the same
  // plugin. The per-config `data.appliesTo` (its phase) is preserved; only the
  // plugin settings are replaced. All-or-nothing via a single transaction.
  app.post("/api/plugins/:kind/configs/bulk-settings", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      if (kind !== BULK_SUPPORTED_KIND) {
        res.status(400).json({ message: `Bulk operations are not supported for kind '${kind}'` });
        return;
      }
      const parsed = bulkSettingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ message: "Invalid bulk request", errors: parsed.error.errors });
        return;
      }
      const { ids, data, enabled, phases } = parsed.data;
      const uniqueIds = Array.from(new Set(ids));
      const uniquePhases = phases ? Array.from(new Set(phases)) : null;

      // Any of three independent changes may be requested: a settings payload,
      // an enabled flip, and/or a phase override. At least one must be present.
      const changeSettings = Object.keys(data).length > 0;
      if (!changeSettings && enabled === undefined && !uniquePhases) {
        res.status(400).json({
          message: "Nothing to apply: provide settings, an enabled change, phases, or a combination",
        });
        return;
      }

      const envelopes = await Promise.all(
        uniqueIds.map((id) => storage.pluginConfigs.getWithSubsidiary(id)),
      );
      const found = [] as NonNullable<(typeof envelopes)[number]>[];
      for (const env of envelopes) {
        if (!env || env.config.pluginKind !== kind) {
          res.status(404).json({ message: "One or more configurations were not found" });
          return;
        }
        found.push(env);
      }
      const pluginIds = new Set(found.map((e) => e.config.pluginId));
      if (pluginIds.size > 1) {
        res.status(400).json({ message: "All selected configurations must use the same plugin" });
        return;
      }
      const pluginId = found[0].config.pluginId;

      // Phase override requested: validate that no two configs INSIDE the
      // selection would become identical (two selected rows on the same
      // policy + benefit collapsing onto the same phase). This intra-selection
      // check is pure (no DB read) so it runs up front; the check against
      // configs OUTSIDE the selection is re-run inside the write transaction
      // below, under the plugin's advisory lock, so a simultaneous save
      // cannot race a duplicate past it.
      if (uniquePhases) {
        const conflicts: Array<{ benefit: string; phase: string }> = [];
        const seen = new Set<string>();
        for (const env of found) {
          const policy = (env.subsidiary as any)?.policy ?? null;
          const benefit = (env.subsidiary as any)?.benefit ?? null;
          for (const phase of uniquePhases) {
            const intraKey = `${policy}|${benefit}|${phase}`;
            if (seen.has(intraKey)) {
              conflicts.push({ benefit: benefit ?? "", phase });
              continue;
            }
            seen.add(intraKey);
          }
        }
        if (conflicts.length > 0) {
          res.status(409).json({
            message:
              "Some benefit/phase combinations already have a configuration for this plugin",
            conflicts,
          });
          return;
        }
      }

      // Build a per-config patch. When settings are supplied, merge them with
      // the config's phase array (overridden when phases were requested,
      // preserved otherwise) and validate so we never store settings the
      // plugin rejects. The enabled flip (when present) is applied
      // independently, so a pure enable/disable doesn't require re-entering
      // settings.
      const updates = [] as Array<{
        id: string;
        patch: { data?: Record<string, unknown>; enabled?: boolean };
      }>;
      // When phases change, the denormalized subsidiary `applies_to` column
      // must stay in sync with `data.appliesTo`. Reuse the adapter's toRows
      // mapping (single source of that logic) per config.
      const subsidiaryRows = [] as Array<{ id: string } & Record<string, unknown>>;
      for (const env of found) {
        const patch: { data?: Record<string, unknown>; enabled?: boolean } = {};
        const existingData = (env.config.data as Record<string, unknown>) ?? {};
        if (changeSettings || uniquePhases) {
          const settingsSource = changeSettings ? data : existingData;
          const mergedData = {
            ...settingsSource,
            appliesTo: uniquePhases ?? existingData.appliesTo ?? [],
          };
          if (!(await ensureValidPlugin(registration, pluginId, mergedData, res))) return;
          patch.data = mergedData;
        }
        if (enabled !== undefined) patch.enabled = enabled;
        updates.push({ id: env.config.id, patch });
        if (uniquePhases) {
          const hydrated = hydrate(adapter, env) as Record<string, unknown>;
          const { subsidiary } = adapter.toRows({
            ...hydrated,
            data: patch.data ?? existingData,
            appliesTo: uniquePhases.join(","),
          } as any);
          if (subsidiary) subsidiaryRows.push({ id: env.config.id, ...subsidiary });
        }
      }
      const updatedCount = await runInTransaction(async () => {
        // Phase override: re-run the against-the-database conflict check
        // INSIDE the transaction, serialized on the plugin's advisory lock,
        // so a simultaneous save cannot slip a duplicate (policy, plugin,
        // benefit, phase) past a pre-transaction check.
        if (uniquePhases) {
          await storage.pluginConfigs.acquireWriteLock(eligibilityLockKey(pluginId));
          const selectedIdSet = new Set(uniqueIds);
          const conflicts = await findPhaseConflicts(
            kind,
            pluginId,
            found.map((env) => ({
              policy: (env.subsidiary as any)?.policy ?? null,
              benefit: (env.subsidiary as any)?.benefit ?? null,
              phases: uniquePhases,
            })),
            selectedIdSet,
          );
          if (conflicts.length > 0) throw new PhaseConflictError(conflicts);
        }
        const updated = await storage.pluginConfigs.bulkUpdate(updates);
        for (const row of subsidiaryRows) {
          await storage.pluginConfigs.upsertSubsidiary(kind, row);
        }
        // Auto-merge every policy touched by this bulk settings change:
        // aligning settings across a selection is exactly what creates
        // mergeable Start-only/Continue-only pairs.
        const touchedPolicies = new Set<string>();
        for (const env of found) {
          const p = (env.subsidiary as any)?.policy;
          if (p) touchedPolicies.add(String(p));
        }
        for (const p of touchedPolicies) {
          await mergePhaseSplitConfigs(kind, adapter, pluginId, p);
        }
        return updated.length;
      });
      res.json({ updated: updatedCount });
    } catch (error) {
      if (error instanceof PhaseConflictError) {
        res.status(409).json({
          message:
            "Some benefit/phase combinations already have a configuration for this plugin",
          conflicts: error.conflicts,
        });
        return;
      }
      console.error("Failed to bulk-update plugin config settings:", error);
      res.status(500).json({ message: "Failed to bulk-update plugin config settings" });
    }
  });

  app.get("/api/plugins/:kind/configs/:id", requireAuth, async (req, res) => {
    try {
      const resolved = await resolve(req, res);
      if (!resolved) return;
      const { kind, adapter, registration } = resolved;
      const envelope = await storage.pluginConfigs.getWithSubsidiary(req.params.id);
      if (!envelope || envelope.config.pluginKind !== kind) {
        res.status(404).json({ message: "Plugin config not found" });
        return;
      }
      // Don't serve a config whose plugin's component is disabled.
      const gate = await pluginGate(registration, envelope.config.pluginId, req);
      if (!gate.ok) {
        res.status(gate.status).json({ message: gate.message });
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
      // Don't let a disabled feature's config be mutated through this generic
      // route. Gate the resource's plugin before reading/merging anything.
      const existingGate = await pluginGate(registration, existingEnvelope.config.pluginId, req);
      if (!existingGate.ok) {
        res.status(existingGate.status).json({ message: existingGate.message });
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
      // Also refuse to retarget a config onto a disabled feature's plugin.
      const targetGate = await pluginGate(registration, parsed.data.pluginId, req);
      if (!targetGate.ok) {
        res.status(targetGate.status).json({ message: targetGate.message });
        return;
      }
      // See POST: validate the post-toRows `data` (what actually gets stored)
      // so adapters that relocate authoritative fields into `data` stay valid.
      const { base, subsidiary } = adapter.toRows(parsed.data);
      // See POST: `siriusId` is a shared base dimension threaded by the route.
      base.siriusId = (parsed.data as any).siriusId ?? null;
      if (!(await ensureValidPlugin(registration, parsed.data.pluginId, base.data, res))) return;
      if (await rejectIfDuplicate(kind, adapter, parsed.data, req.params.id, res)) return;
      const patchSurvivorMap = await runInTransaction(async () => {
        // Trust-eligibility: a config's (policy, plugin, benefit, phase) must
        // be unique. Serialize on the plugin's advisory lock and check each
        // target phase against other configs INSIDE the write transaction
        // (token-aware, catches combined "start,continue" rows), so two
        // simultaneous saves cannot both pass the check and both write.
        // Rejects all-or-nothing with a structured conflict list.
        if (kind === BULK_SUPPORTED_KIND && subsidiary) {
          await storage.pluginConfigs.acquireWriteLock(eligibilityLockKey(parsed.data.pluginId));
          const targetPhases = Array.isArray((base.data as any)?.appliesTo)
            ? ((base.data as any).appliesTo as string[])
            : [];
          const conflicts = await findPhaseConflicts(
            kind,
            parsed.data.pluginId,
            [
              {
                policy: (subsidiary as any).policy ?? null,
                benefit: (subsidiary as any).benefit ?? null,
                phases: targetPhases,
              },
            ],
            new Set([req.params.id]),
          );
          if (conflicts.length > 0) throw new PhaseConflictError(conflicts);
        }
        await storage.pluginConfigs.update(req.params.id, base as any);
        if (subsidiary) {
          await storage.pluginConfigs.upsertSubsidiary(kind, { id: req.params.id, ...subsidiary });
        }
        // Auto-merge: an edit can make this row's settings identical to a
        // phase-complement sibling — collapse them immediately.
        if (kind === BULK_SUPPORTED_KIND && subsidiary && (subsidiary as any).policy) {
          const { survivorMap } = await mergePhaseSplitConfigs(
            kind,
            adapter,
            parsed.data.pluginId,
            (subsidiary as any).policy,
          );
          return survivorMap;
        }
        return {} as Record<string, string>;
      });
      // If the auto-merge folded the edited row into a sibling survivor,
      // respond with the surviving combined row, not the deleted id.
      const patchedId = patchSurvivorMap[req.params.id] ?? req.params.id;
      const envelope = await storage.pluginConfigs.getWithSubsidiary(patchedId);
      res.json(envelope ? hydrate(adapter, envelope) : { id: patchedId });
    } catch (error) {
      if (error instanceof PhaseConflictError) {
        res.status(409).json({
          message:
            "Another configuration already covers this benefit/phase combination for this plugin",
          conflicts: error.conflicts,
        });
        return;
      }
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
      // Don't let a disabled feature's config be deleted through this route.
      const gate = await pluginGate(registration, existing.pluginId, req);
      if (!gate.ok) {
        res.status(gate.status).json({ message: gate.message });
        return;
      }
      // Singleton deletion-refusal is decided by the storage layer from the
      // plugin type's manifest; the route no longer computes/passes it.
      const ok = await storage.pluginConfigs.delete(req.params.id);
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
