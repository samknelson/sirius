import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  pluginConfigs,
  type PluginConfig,
  type InsertPluginConfig,
  type PluginConfigCharge,
  type PluginConfigBenefitEligibility,
  type PluginConfigDispatch,
} from "@shared/schema";
import { eq, and, type SQL } from "drizzle-orm";
import {
  createChargeSubsidiaryStorage,
  createBenefitEligibilitySubsidiaryStorage,
  createDispatchSubsidiaryStorage,
  type SubsidiaryStorage,
} from "./plugin-configs-subsidiary";

/**
 * Stub validator - add validation logic here when needed.
 */
export const validate = createNoopValidator();

/**
 * The opaque subsidiary row shape returned alongside a base config. A kind
 * with no relational dimensions (e.g. "dashboard") has `null`.
 */
export type PluginConfigSubsidiary =
  | PluginConfigCharge
  | PluginConfigBenefitEligibility
  | PluginConfigDispatch
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
}

export interface PluginConfigStorage {
  // --- Base CRUD ---------------------------------------------------------
  getAll(): Promise<PluginConfig[]>;
  get(id: string): Promise<PluginConfig | undefined>;
  getByType(pluginType: string): Promise<PluginConfig[]>;
  getByTypeAndPlugin(pluginType: string, pluginId: string): Promise<PluginConfig[]>;
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
   * discriminator (the `:kind` URL segment / `plugin_type` column value).
   * Kinds absent from this map (e.g. "dashboard") carry no relational
   * dimensions and live entirely in the base table. Each namespace owns the
   * queries for exactly one subsidiary table; this base namespace composes
   * them via the search dispatcher below.
   */
  const subsidiaries: Record<string, SubsidiaryStorage<PluginConfigSubsidiary & object, any>> = {
    charge: createChargeSubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "trust-eligibility": createBenefitEligibilitySubsidiaryStorage() as SubsidiaryStorage<any, any>,
    "dispatch-eligibility": createDispatchSubsidiaryStorage() as SubsidiaryStorage<any, any>,
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
          a.pluginType.localeCompare(b.pluginType) ||
          a.ordering - b.ordering ||
          a.pluginId.localeCompare(b.pluginId),
      );
    },

    async get(id: string): Promise<PluginConfig | undefined> {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigs).where(eq(pluginConfigs.id, id));
      return row || undefined;
    },

    async getByType(pluginType: string): Promise<PluginConfig[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(pluginConfigs)
        .where(eq(pluginConfigs.pluginType, pluginType))
        .orderBy(pluginConfigs.ordering, pluginConfigs.pluginId);
      return rows;
    },

    async getByTypeAndPlugin(pluginType: string, pluginId: string): Promise<PluginConfig[]> {
      const client = getClient();
      const rows = await client
        .select()
        .from(pluginConfigs)
        .where(and(eq(pluginConfigs.pluginType, pluginType), eq(pluginConfigs.pluginId, pluginId)))
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
      const [row] = await client.insert(pluginConfigs).values(insertConfig).returning();
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
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      // Subsidiary rows are removed automatically via ON DELETE CASCADE.
      const result = await client.delete(pluginConfigs).where(eq(pluginConfigs.id, id)).returning();
      return result.length > 0;
    },

    // --- Subsidiary access ----------------------------------------------
    async upsertSubsidiary(
      type: string,
      row: { id: string } & Record<string, unknown>,
    ): Promise<PluginConfigSubsidiary> {
      const ns = subsidiaries[type];
      if (!ns) return null;
      return (await ns.upsert(row)) as PluginConfigSubsidiary;
    },

    // --- Composed read + generic search ---------------------------------
    async getWithSubsidiary(id: string): Promise<PluginConfigWithSubsidiary | undefined> {
      const client = getClient();
      const [config] = await client.select().from(pluginConfigs).where(eq(pluginConfigs.id, id));
      if (!config) return undefined;
      const subsidiary = await getSubsidiary(config.pluginType, id);
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
      const baseConditions: SQL[] = [eq(pluginConfigs.pluginType, type)];
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
