import { getClient } from './transaction-context';
import {
  pluginConfigs,
  pluginConfigsCharge,
  type ChargePluginConfig,
} from "@shared/schema";
import { eq, and, isNull, type SQL } from "drizzle-orm";

/**
 * Charge plugin configuration storage (Task #355).
 *
 * Charge no longer owns a dedicated table. These reads compose the unified
 * `plugin_configs` (plugin_type = 'charge') base row with its
 * `plugin_configs_charge` subsidiary (scope / employer / account) and map the
 * pair into the resolved {@link ChargePluginConfig} shape callers expect (the
 * base `data` blob is surfaced as `settings`). Writes go through the generic
 * `storage.pluginConfigs` CRUD surface (see server/modules/plugins-config.ts);
 * this namespace is read/resolution-only.
 */
export interface ChargePluginConfigStorage {
  getAll(): Promise<ChargePluginConfig[]>;
  get(id: string): Promise<ChargePluginConfig | undefined>;
  getByPluginId(pluginId: string): Promise<ChargePluginConfig[]>;
  getEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig[]>;
  getFirstEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig | undefined>;
  getByPluginIdAndScope(pluginId: string, scope: string, employerId?: string): Promise<ChargePluginConfig | undefined>;
  getEnabledForPlugin(pluginId: string, employerId: string | null): Promise<ChargePluginConfig[]>;
}

type BaseRow = typeof pluginConfigs.$inferSelect;
type ChargeRow = typeof pluginConfigsCharge.$inferSelect;

/** Map a joined base + subsidiary row pair into the resolved charge config. */
function mapRow(config: BaseRow, subsidiary: ChargeRow): ChargePluginConfig {
  return {
    id: config.id,
    pluginId: config.pluginId,
    name: config.name,
    enabled: config.enabled,
    scope: subsidiary.scope,
    employerId: subsidiary.employerId,
    account: subsidiary.account,
    settings: config.data,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * Employer configs override global configs that target the SAME account (a
 * null account is its own bucket). Pure function so the override semantics —
 * the highest-risk, billing-critical behavior — can be unit-tested without a
 * database. Returns the surviving globals followed by all employer configs.
 */
export function mergeEnabledChargeConfigs(
  globalConfigs: ChargePluginConfig[],
  employerConfigs: ChargePluginConfig[],
): ChargePluginConfig[] {
  if (employerConfigs.length === 0) {
    return globalConfigs;
  }
  const overriddenAccounts = new Set(employerConfigs.map((c) => c.account ?? "__null__"));
  const remainingGlobals = globalConfigs.filter(
    (g) => !overriddenAccounts.has(g.account ?? "__null__"),
  );
  return [...remainingGlobals, ...employerConfigs];
}

export function createChargePluginConfigStorage(): ChargePluginConfigStorage {
  /** Run the standard charge base⨝subsidiary select with extra conditions. */
  async function select(conditions: SQL[], ordered: boolean): Promise<ChargePluginConfig[]> {
    const client = getClient();
    const query = client
      .select({ config: pluginConfigs, subsidiary: pluginConfigsCharge })
      .from(pluginConfigs)
      .innerJoin(pluginConfigsCharge, eq(pluginConfigsCharge.id, pluginConfigs.id))
      .where(and(eq(pluginConfigs.pluginType, "charge"), ...conditions));
    // Deterministic selection: account ASC puts NULLs last in Postgres, then
    // id for a stable tiebreak. Matches the legacy ordering exactly.
    const rows = ordered
      ? await query.orderBy(pluginConfigsCharge.account, pluginConfigs.id)
      : await query;
    return rows.map((r) => mapRow(r.config, r.subsidiary));
  }

  return {
    async getAll(): Promise<ChargePluginConfig[]> {
      const all = await select([], false);
      return all.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
    },

    async get(id: string): Promise<ChargePluginConfig | undefined> {
      const [config] = await select([eq(pluginConfigs.id, id)], false);
      return config || undefined;
    },

    async getByPluginId(pluginId: string): Promise<ChargePluginConfig[]> {
      return select([eq(pluginConfigs.pluginId, pluginId)], false);
    },

    async getEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig[]> {
      return select(
        [eq(pluginConfigs.pluginId, pluginId), eq(pluginConfigs.enabled, true)],
        false,
      );
    },

    async getFirstEnabledByPluginId(pluginId: string): Promise<ChargePluginConfig | undefined> {
      const [config] = await select(
        [eq(pluginConfigs.pluginId, pluginId), eq(pluginConfigs.enabled, true)],
        true,
      );
      return config || undefined;
    },

    async getByPluginIdAndScope(
      pluginId: string,
      scope: string,
      employerId?: string,
    ): Promise<ChargePluginConfig | undefined> {
      const conditions: SQL[] = [
        eq(pluginConfigs.pluginId, pluginId),
        eq(pluginConfigsCharge.scope, scope),
      ];

      // Constrain the employer dimension by scope so a global/batch lookup
      // never accidentally matches an employer-scoped row, and an employer
      // lookup without an id only matches the null-employer rows.
      if (scope === "employer") {
        conditions.push(
          employerId
            ? eq(pluginConfigsCharge.employerId, employerId)
            : isNull(pluginConfigsCharge.employerId),
        );
      } else {
        conditions.push(isNull(pluginConfigsCharge.employerId));
      }

      const [config] = await select(conditions, true);
      return config || undefined;
    },

    async getEnabledForPlugin(
      pluginId: string,
      employerId: string | null,
    ): Promise<ChargePluginConfig[]> {
      const baseConditions: SQL[] = [
        eq(pluginConfigs.pluginId, pluginId),
        eq(pluginConfigs.enabled, true),
      ];

      // All enabled global configs (one per account).
      const globalConfigs = await select(
        [...baseConditions, eq(pluginConfigsCharge.scope, "global")],
        false,
      );

      if (!employerId) {
        return globalConfigs;
      }

      // All enabled employer-specific configs for this employer.
      const employerConfigs = await select(
        [
          ...baseConditions,
          eq(pluginConfigsCharge.scope, "employer"),
          eq(pluginConfigsCharge.employerId, employerId),
        ],
        false,
      );

      return mergeEnabledChargeConfigs(globalConfigs, employerConfigs);
    },
  };
}
