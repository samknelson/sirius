import type { ChargePluginConfig, PluginConfigCharge } from "@shared/schema";
import type { PluginConfigWithSubsidiary } from "../../../storage/plugin-configs";

/**
 * Charge plugin config resolution helpers.
 *
 * Charge no longer has a dedicated storage namespace. Callers read charge
 * configs through the generic `storage.pluginConfigs.search("charge", …)`
 * surface, which returns `{ config, subsidiary }` envelopes ordered by the base
 * `ordering`/`id`. These pure helpers map those envelopes into the flattened
 * {@link ChargePluginConfig} shape callers consume, re-apply the legacy
 * deterministic single-row ordering, and preserve the billing-critical
 * global/employer override merge — none of which the generic search performs.
 */

/**
 * Map a generic plugin-config envelope (base row + charge subsidiary) into the
 * flattened {@link ChargePluginConfig} shape. The base `data` blob is surfaced
 * as `settings`; scope / employer / account come from the charge subsidiary.
 * Charge reads always inner-join the subsidiary, so it is expected to be
 * present.
 */
export function toChargeConfig(env: PluginConfigWithSubsidiary): ChargePluginConfig {
  const { config } = env;
  const subsidiary = env.subsidiary as PluginConfigCharge | null;
  return {
    id: config.id,
    pluginId: config.pluginId,
    name: config.name,
    enabled: config.enabled,
    scope: subsidiary?.scope ?? "",
    employerId: subsidiary?.employerId ?? null,
    account: subsidiary?.account ?? null,
    settings: config.data,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

/**
 * Comparator matching the legacy charge SQL ordering `account ASC NULLS LAST,
 * id ASC`. String comparison uses code-point order (Postgres "C" collation);
 * ids are lowercase uuids so the tiebreak is collation-independent.
 */
function compareByAccountThenId(a: ChargePluginConfig, b: ChargePluginConfig): number {
  if (a.account === null && b.account !== null) return 1;
  if (a.account !== null && b.account === null) return -1;
  if (a.account !== null && b.account !== null && a.account !== b.account) {
    return a.account < b.account ? -1 : 1;
  }
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Deterministically pick the single config a lookup should return, matching the
 * legacy `account ASC NULLS LAST, id ASC` selection used by the first-enabled
 * and by-scope reads.
 */
export function pickFirstByAccountOrder(
  configs: ChargePluginConfig[],
): ChargePluginConfig | undefined {
  return [...configs].sort(compareByAccountThenId)[0];
}

/**
 * Employer configs override global configs that target the SAME account (a null
 * account is its own bucket). Pure function so the override semantics — the
 * highest-risk, billing-critical behavior — can be unit-tested without a
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
