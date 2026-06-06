import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  pluginConfigs,
  pluginConfigsCharge,
  pluginConfigsBenefitEligibility,
  pluginConfigsDispatch,
  type PluginConfig,
  type InsertPluginConfig,
  type PluginConfigCharge,
  type InsertPluginConfigCharge,
  type PluginConfigBenefitEligibility,
  type InsertPluginConfigBenefitEligibility,
  type PluginConfigDispatch,
  type InsertPluginConfigDispatch,
} from "@shared/schema";
import { eq, and, isNull, type SQL } from "drizzle-orm";

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
  create(config: InsertPluginConfig): Promise<PluginConfig>;
  update(id: string, config: Partial<InsertPluginConfig>): Promise<PluginConfig | undefined>;
  delete(id: string): Promise<boolean>;

  // --- Subsidiary access (1:1 by base id) --------------------------------
  getCharge(id: string): Promise<PluginConfigCharge | undefined>;
  upsertCharge(row: InsertPluginConfigCharge): Promise<PluginConfigCharge>;
  getBenefitEligibility(id: string): Promise<PluginConfigBenefitEligibility | undefined>;
  upsertBenefitEligibility(row: InsertPluginConfigBenefitEligibility): Promise<PluginConfigBenefitEligibility>;
  getDispatch(id: string): Promise<PluginConfigDispatch | undefined>;
  upsertDispatch(row: InsertPluginConfigDispatch): Promise<PluginConfigDispatch>;
  /**
   * Generic subsidiary upsert dispatcher — routes a `{ id, ...cols }` row to
   * the subsidiary table for `type`. Returns `null` for kinds without a
   * subsidiary (e.g. "dashboard"). Keeps generic CRUD routes thin.
   */
  upsertSubsidiary(
    type: string,
    row: { id: string } & Record<string, unknown>,
  ): Promise<PluginConfigSubsidiary>;

  // --- Composed read + generic search ------------------------------------
  getWithSubsidiary(id: string): Promise<PluginConfigWithSubsidiary | undefined>;
  search(type: string, params?: PluginConfigSearchParams): Promise<PluginConfigWithSubsidiary[]>;
}

/**
 * Maps a PluginKind discriminator (the `:kind` URL segment / `plugin_type`
 * column value) to the subsidiary table that holds its relational
 * dimensions. Kinds absent from this map (e.g. "dashboard") carry no
 * relational dimensions and live entirely in the base table.
 */
function subsidiaryTableFor(type: string) {
  switch (type) {
    case "charge":
      return pluginConfigsCharge;
    case "trust-eligibility":
      return pluginConfigsBenefitEligibility;
    case "dispatch-eligibility":
      return pluginConfigsDispatch;
    default:
      return null;
  }
}

export function createPluginConfigStorage(): PluginConfigStorage {
  /** Fetch the subsidiary row for a base config of a given type, if any. */
  async function getSubsidiary(type: string, id: string): Promise<PluginConfigSubsidiary> {
    const client = getClient();
    const table = subsidiaryTableFor(type);
    if (!table) return null;
    const [row] = await client.select().from(table).where(eq(table.id, id));
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
    async getCharge(id: string): Promise<PluginConfigCharge | undefined> {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigsCharge).where(eq(pluginConfigsCharge.id, id));
      return row || undefined;
    },

    async upsertCharge(row: InsertPluginConfigCharge): Promise<PluginConfigCharge> {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsCharge)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsCharge.id,
          set: { scope: row.scope, employerId: row.employerId ?? null, account: row.account ?? null },
        })
        .returning();
      return result;
    },

    async getBenefitEligibility(id: string): Promise<PluginConfigBenefitEligibility | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(pluginConfigsBenefitEligibility)
        .where(eq(pluginConfigsBenefitEligibility.id, id));
      return row || undefined;
    },

    async upsertBenefitEligibility(
      row: InsertPluginConfigBenefitEligibility,
    ): Promise<PluginConfigBenefitEligibility> {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsBenefitEligibility)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsBenefitEligibility.id,
          set: {
            policy: row.policy ?? null,
            benefit: row.benefit ?? null,
            appliesTo: row.appliesTo ?? null,
          },
        })
        .returning();
      return result;
    },

    async getDispatch(id: string): Promise<PluginConfigDispatch | undefined> {
      const client = getClient();
      const [row] = await client.select().from(pluginConfigsDispatch).where(eq(pluginConfigsDispatch.id, id));
      return row || undefined;
    },

    async upsertDispatch(row: InsertPluginConfigDispatch): Promise<PluginConfigDispatch> {
      const client = getClient();
      const [result] = await client
        .insert(pluginConfigsDispatch)
        .values(row)
        .onConflictDoUpdate({
          target: pluginConfigsDispatch.id,
          set: { jobType: row.jobType ?? null },
        })
        .returning();
      return result;
    },

    async upsertSubsidiary(
      type: string,
      row: { id: string } & Record<string, unknown>,
    ): Promise<PluginConfigSubsidiary> {
      switch (type) {
        case "charge":
          return this.upsertCharge(row as unknown as InsertPluginConfigCharge);
        case "trust-eligibility":
          return this.upsertBenefitEligibility(row as unknown as InsertPluginConfigBenefitEligibility);
        case "dispatch-eligibility":
          return this.upsertDispatch(row as unknown as InsertPluginConfigDispatch);
        default:
          return null;
      }
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
     * enabled) plus any subsidiary filters relevant to `type`, joining the
     * subsidiary table when the kind has one. All SQL lives here — callers
     * pass a plain params object and receive composed envelopes.
     */
    async search(type: string, params: PluginConfigSearchParams = {}): Promise<PluginConfigWithSubsidiary[]> {
      const client = getClient();
      const table = subsidiaryTableFor(type);

      // Base conditions shared by every kind.
      const baseConditions: SQL[] = [eq(pluginConfigs.pluginType, type)];
      if (params.pluginId !== undefined) baseConditions.push(eq(pluginConfigs.pluginId, params.pluginId));
      if (params.enabled !== undefined) baseConditions.push(eq(pluginConfigs.enabled, params.enabled));

      // Kinds without a subsidiary table: filter and return base rows only.
      if (!table) {
        const rows = await client
          .select()
          .from(pluginConfigs)
          .where(and(...baseConditions))
          .orderBy(pluginConfigs.ordering, pluginConfigs.id);
        return rows.map((config) => ({ config, subsidiary: null }));
      }

      // Subsidiary conditions, applied per kind.
      const subConditions: SQL[] = [];
      const eqOrNull = (col: any, val: string | null | undefined) => {
        if (val === undefined) return;
        subConditions.push(val === null ? isNull(col) : eq(col, val));
      };

      if (type === "charge") {
        if (params.scope !== undefined) subConditions.push(eq(pluginConfigsCharge.scope, params.scope));
        eqOrNull(pluginConfigsCharge.employerId, params.employerId);
        eqOrNull(pluginConfigsCharge.account, params.account);
      } else if (type === "trust-eligibility") {
        eqOrNull(pluginConfigsBenefitEligibility.policy, params.policy);
        eqOrNull(pluginConfigsBenefitEligibility.benefit, params.benefit);
        eqOrNull(pluginConfigsBenefitEligibility.appliesTo, params.appliesTo);
      } else if (type === "dispatch-eligibility") {
        eqOrNull(pluginConfigsDispatch.jobType, params.jobType);
      }

      const whereClause = and(...baseConditions, ...subConditions);
      const rows = await client
        .select({ config: pluginConfigs, subsidiary: table })
        .from(pluginConfigs)
        .innerJoin(table, eq(table.id, pluginConfigs.id))
        .where(whereClause)
        .orderBy(pluginConfigs.ordering, pluginConfigs.id);

      return rows.map((r) => ({
        config: r.config,
        subsidiary: (r.subsidiary as PluginConfigSubsidiary) ?? null,
      }));
    },
  };
}
