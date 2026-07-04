import { createNoopValidator } from './utils/validation';
import { getClient, onAfterCommit } from './transaction-context';
import {
  pluginConfigs,
  type PluginConfig,
  type InsertPluginConfig,
  type PluginConfigCharge,
  type PluginConfigBenefitEligibility,
  type PluginConfigDispatch,
  type PluginConfigDashboard,
  type PluginConfigPaymentGateway,
  type PluginConfigEventNotifier,
  type PluginConfigCron,
} from "@shared/schema";
import { eq, and, type SQL } from "drizzle-orm";
// Import the cycle-safe `_core` submodule directly (NOT the `_core/index.ts`
// barrel, which re-exports the singleton seeder that imports storage).
import { isSingletonPluginType } from "../plugins/_core/kinds";
import { eventBus, EventType } from "../services/event-bus";
import { logger } from "../logger";
import {
  createChargeSubsidiaryStorage,
  createBenefitEligibilitySubsidiaryStorage,
  createDispatchSubsidiaryStorage,
  createDashboardSubsidiaryStorage,
  createPaymentGatewaySubsidiaryStorage,
  createEventNotifierSubsidiaryStorage,
  createCronSubsidiaryStorage,
  type SubsidiaryStorage,
} from "./plugin-configs-subsidiary";

/**
 * Stub validator - add validation logic here when needed.
 */
export const validate = createNoopValidator();

/**
 * Thrown when a singleton-plugin invariant is violated: an attempt to create a
 * second config row for a singleton plugin, or to delete the one config row a
 * singleton plugin owns. The generic CRUD routes translate this into a
 * friendly 409 response.
 */
export class SingletonViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SingletonViolationError";
  }
}

/**
 * True only for a Postgres unique-violation (SQLSTATE 23505) raised by the
 * named constraint/index. Scoping to the constraint name avoids mislabeling an
 * unrelated unique conflict (e.g. `sirius_id`) as a singleton conflict.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint?: string }).constraint === constraint
  );
}

/**
 * Emit `PLUGIN_CONFIG_SAVED` so the shared plugin-config cache can invalidate
 * the affected kind's slice. Deferred to after the surrounding transaction
 * commits (via {@link onAfterCommit}; runs immediately when not in a
 * transaction) so the cache can never rebuild from pre-commit data during the
 * open-transaction window and persist stale state. Fire-and-forget: a bus
 * failure must never break the write the caller just performed.
 */
function emitConfigSaved(
  kind: string,
  id: string,
  operation: "create" | "update" | "delete",
): void {
  onAfterCommit(() => {
    eventBus
      .emit(EventType.PLUGIN_CONFIG_SAVED, { kind, id, operation })
      .catch((err) => {
        logger.error("Failed to emit PLUGIN_CONFIG_SAVED", {
          service: "plugin-configs-storage",
          kind,
          id,
          operation,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  });
}

/**
 * The opaque subsidiary row shape returned alongside a base config. A kind
 * with no relational dimensions (e.g. "dashboard") has `null`.
 */
export type PluginConfigSubsidiary =
  | PluginConfigCharge
  | PluginConfigBenefitEligibility
  | PluginConfigDispatch
  | PluginConfigDashboard
  | PluginConfigPaymentGateway
  | PluginConfigEventNotifier
  | PluginConfigCron
  | null;

/**
 * A base plugin config row composed with its per-kind subsidiary row (if the
 * kind has one). This is the envelope every read/search returns so callers
 * never have to issue a second query for the relational dimensions.
 */
export interface PluginConfigWithSubsidiary {
  config: PluginConfig;
  subsidiary: PluginConfigSubsidiary;
}

/**
 * Search parameters accepted by `search(type, params)`. Every field is
 * optional; only the ones provided are applied as filters. Unknown keys are
 * ignored by the dispatcher (route-level validation via the per-kind adapter
 * is responsible for rejecting malformed input).
 */
export interface PluginConfigSearchParams {
  // Base dimensions (every kind)
  pluginId?: string;
  enabled?: boolean;
  siriusId?: string | null;
  // Charge subsidiary
  scope?: string;
  employerId?: string | null;
  account?: string | null;
  // Benefit-eligibility subsidiary
  policy?: string | null;
  benefit?: string | null;
  appliesTo?: string | null;
  // Dispatch subsidiary
  jobType?: string | null;
  // Dashboard subsidiary: admin single-role filter (`role`) + render-side
  // viewer role-set filter (`roleIn`).
  role?: string | null;
  roleIn?: string[];
  // Event-notifier subsidiary: single active medium token.
  media?: string | null;
  // Cron subsidiary: exact cron-expression match.
  schedule?: string;
}

export interface PluginConfigStorage {
  // --- Base CRUD ---------------------------------------------------------
  getAll(): Promise<PluginConfig[]>;
  get(id: string): Promise<PluginConfig | undefined>;
  getByKind(pluginKind: string): Promise<PluginConfig[]>;
  getByKindAndPlugin(pluginKind: string, pluginId: string): Promise<PluginConfig[]>;
  findBySiriusId(siriusId: string): Promise<PluginConfig | undefined>;
  create(config: InsertPluginConfig): Promise<PluginConfig>;
  update(id: string, config: Partial<InsertPluginConfig>): Promise<PluginConfig | undefined>;
  delete(id: string): Promise<boolean>;

  // --- Subsidiary access (1:1 by base id) --------------------------------
  /**
   * Generic subsidiary upsert dispatcher — routes a `{ id, ...cols }` row to
   * the internal subsidiary namespace for `type`. Returns `null` for kinds
   * without a subsidiary (e.g. "dashboard"). Keeps generic CRUD routes thin.
   * Per-kind subsidiary queries live in their own namespaces in
   * `plugin-configs-subsidiary.ts`; this base namespace only dispatches.
   */
  upsertSubsidiary(
    type: string,
    row: { id: string } & Record<string, unknown>,
  ): Promise<PluginConfigSubsidiary>;

  // --- Composed read + generic search ------------------------------------
  getWithSubsidiary(id: string): Promise<PluginConfigWithSubsidiary | undefined>;
  search(type: string, params?: PluginConfigSearchParams): Promise<PluginConfigWithSubsidiary[]>;
}

export function createPluginConfigStorage(): PluginConfigStorage {
  /**
   * Internal per-kind subsidiary namespaces, keyed by the PluginKind
   * discriminator (the `:kind` URL segment / `plugin_kind` column value).
   * Kinds absent from this map (e.g. "dashboard") carry no relational
   * dimensions and live entirely in the base table. Each namespace owns the
   * queries for exactly one subsidiary table; this base namespace composes
   * them via the search dispatcher below.
   */
  const subsidiaries: Record<string, SubsidiaryStorage<PluginConfigSubsidiary & object, any>> = {
    charge: createChargeSubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "trust-eligibility": createBenefitEligibilitySubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "dispatch-eligibility": createDispatchSubsidiaryStorage() as SubsidiaryStorage<any, any>,
    dashboard: createDashboardSubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "payment-gateway": createPaymentGatewaySubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "event-notifier": createEventNotifierSubsidiaryStorage() as SubsidiaryStorage<any, any>,
    cron: createCronSubsidiaryStorage() as SubsidiaryStorage<any, any>,
  };

  /** Fetch the subsidiary row for a base config of a given type, if any. */
  async function getSubsidiary(type: string, id: string): Promise<PluginConfigSubsidiary> {
    const ns = subsidiaries[type];
    if (!ns) return null;
    const row = await ns.get(id);
    return (row as PluginConfigSubsidiary) ?? null;
  }

  return {
    // --- Base CRUD -------------------------------------------------------
    async getAll(): Promise<PluginConfig[]> {
      const client = getClient();
      const rows = await client.select().from(pluginConfigs);
      return rows.sort(
        (a, b) =>
          a.pluginKind.localeCompare(b.pluginKind) ||
          a.ordering - b.ordering ||
          a.pluginId.localeCompare(b.pluginId),
      );
    },

    async get(id: string): Promise<PluginConfig | undefined> {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigs).where(eq(pluginConfigs.id, id));
      return row || undefined;
    },

    async getByKind(pluginKind: string): Promise<PluginConfig[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(pluginConfigs)
        .where(eq(pluginConfigs.pluginKind, pluginKind))
        .orderBy(pluginConfigs.ordering, pluginConfigs.pluginId);
      return rows;
    },

    async getByKindAndPlugin(pluginKind: string, pluginId: string): Promise<PluginConfig[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(pluginConfigs)
        .where(and(eq(pluginConfigs.pluginKind, pluginKind), eq(pluginConfigs.pluginId, pluginId)))
        .orderBy(pluginConfigs.ordering, pluginConfigs.id);
      return rows;
    },

    async findBySiriusId(siriusId: string): Promise<PluginConfig | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigs)
        .where(eq(pluginConfigs.siriusId, siriusId));
      return row || undefined;
    },

    async create(insertConfig: InsertPluginConfig): Promise<PluginConfig> {
      validate.validateOrThrow(insertConfig);
      const client = getClient();
      // Singleton-ness is a property of the plugin TYPE, read straight from its
      // manifest for this row's (kind, plugin id) — callers no longer pass it.
      // The boolean is persisted (`is_singleton`) so the partial unique index
      // can key off it, covering every singleton type rather than one kind.
      const enforceSingleton = isSingletonPluginType(
        insertConfig.pluginKind,
        insertConfig.pluginId,
      );
      // Singleton plugins permit exactly one config row (keyed by kind +
      // plugin id). The pre-check gives a friendly error for the common case;
      // the partial unique index `plugin_configs_singleton_uniq` is the
      // race-safe backstop (two concurrent inserts both pass the pre-check but
      // only one survives the index), translated below from a 23505 conflict.
      if (enforceSingleton) {
        const existing = await client
          .select({ id: pluginConfigs.id })
          .from(pluginConfigs)
          .where(
            and(
              eq(pluginConfigs.pluginKind, insertConfig.pluginKind),
              eq(pluginConfigs.pluginId, insertConfig.pluginId),
            ),
          );
        if (existing.length > 0) {
          throw new SingletonViolationError(
            `A configuration for "${insertConfig.pluginId}" already exists and cannot be duplicated.`,
          );
        }
      }
      let row;
      try {
        [row] = await client
          .insert(pluginConfigs)
          .values({ ...insertConfig, isSingleton: enforceSingleton })
          .returning();
      } catch (err) {
        if (
          enforceSingleton &&
          isUniqueViolation(err, "plugin_configs_singleton_uniq")
        ) {
          throw new SingletonViolationError(
            `A configuration for "${insertConfig.pluginId}" already exists and cannot be duplicated.`,
          );
        }
        throw err;
      }
      emitConfigSaved(row.pluginKind, row.id, "create");
      return row;
    },

    async update(id: string, configUpdate: Partial<InsertPluginConfig>): Promise<PluginConfig | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [row] = await client
        .update(pluginConfigs)
        .set({ ...configUpdate, updatedAt: new Date() })
        .where(eq(pluginConfigs.id, id))
        .returning();
      if (row) emitConfigSaved(row.pluginKind, row.id, "update");
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      // Read the kind first so the invalidation event can target this kind's
      // cache slice (the delete itself only returns the row count).
      const [existing] = await client
        .select({
          pluginKind: pluginConfigs.pluginKind,
          pluginId: pluginConfigs.pluginId,
        })
        .from(pluginConfigs)
        .where(eq(pluginConfigs.id, id));
      // A singleton plugin's one config row IS the plugin instance; deleting it
      // would orphan the plugin, so the operation is refused. Singleton-ness is
      // read from the plugin TYPE's manifest for this row's (kind, plugin id).
      if (existing && isSingletonPluginType(existing.pluginKind, existing.pluginId)) {
        throw new SingletonViolationError(
          `"${existing.pluginId}" is a built-in singleton and its configuration cannot be deleted.`,
        );
      }
      // Subsidiary rows are removed automatically via ON DELETE CASCADE.
      const result = await client.delete(pluginConfigs).where(eq(pluginConfigs.id, id)).returning();
      const deleted = result.length > 0;
      if (deleted && existing) emitConfigSaved(existing.pluginKind, id, "delete");
      return deleted;
    },

    // --- Subsidiary access ----------------------------------------------
    async upsertSubsidiary(
      type: string,
      row: { id: string } & Record<string, unknown>,
    ): Promise<PluginConfigSubsidiary> {
      const ns = subsidiaries[type];
      if (!ns) return null;
      const result = (await ns.upsert(row)) as PluginConfigSubsidiary;
      // Covers non-route writers (e.g. the boot-time subsidiary backfill) that
      // touch a config's subsidiary row directly.
      emitConfigSaved(type, row.id, "update");
      return result;
    },

    // --- Composed read + generic search ---------------------------------
    async getWithSubsidiary(id: string): Promise<PluginConfigWithSubsidiary | undefined> {
      const client = getClient();
      const [config] = await client.select().from(pluginConfigs).where(eq(pluginConfigs.id, id));
      if (!config) return undefined;
      const subsidiary = await getSubsidiary(config.pluginKind, id);
      return { config, subsidiary };
    },

    /**
     * Generic search dispatcher. Applies base-table filters (pluginId,
     * enabled) and, for kinds with a subsidiary namespace, joins that table
     * and applies the namespace's own WHERE conditions. Callers pass a plain
     * params object and receive composed envelopes; the per-kind subsidiary
     * SQL lives in each subsidiary namespace.
     */
    async search(type: string, params: PluginConfigSearchParams = {}): Promise<PluginConfigWithSubsidiary[]> {
      const client = getClient();
      const ns = subsidiaries[type];

      // Base conditions shared by every kind.
      const baseConditions: SQL[] = [eq(pluginConfigs.pluginKind, type)];
      if (params.pluginId !== undefined) baseConditions.push(eq(pluginConfigs.pluginId, params.pluginId));
      if (params.enabled !== undefined) baseConditions.push(eq(pluginConfigs.enabled, params.enabled));
      if (params.siriusId !== undefined && params.siriusId !== null) {
        baseConditions.push(eq(pluginConfigs.siriusId, params.siriusId));
      }

      // Kinds without a subsidiary namespace: filter and return base rows only.
      if (!ns) {
        const rows = await client
          .select()
          .from(pluginConfigs)
          .where(and(...baseConditions))
          .orderBy(pluginConfigs.ordering, pluginConfigs.id);
        return rows.map((config) => ({ config, subsidiary: null }));
      }

      const table = ns.table;
      const subConditions = ns.buildConditions(params);
      const whereClause = and(...baseConditions, ...subConditions);
      const rows = await client
        .select({ config: pluginConfigs, subsidiary: table })
        .from(pluginConfigs)
        .innerJoin(table, eq((table as any).id, pluginConfigs.id))
        .where(whereClause)
        .orderBy(pluginConfigs.ordering, pluginConfigs.id);

      return rows.map((r) => ({
        config: r.config,
        subsidiary: (r.subsidiary as PluginConfigSubsidiary) ?? null,
      }));
    },
  };
}
