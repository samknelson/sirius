import type { WorkerBan } from "@shared/schema";
import { logger } from "../../logger";
import { workerBanPluginRegistry } from "./registry";
import type { BanCheckContext, WorkerBanPlugin } from "./registry";
import type { BannableActionId } from "./actions";

/** Legacy literal `worker_bans.type` value from before ban types existed. */
export const LEGACY_DISPATCH_TYPE = "dispatch";

/** siriusId of the boot-seeded "Dispatch" ban type option row. */
export const DISPATCH_BAN_TYPE_SIRIUS_ID = "DISPATCH";

export interface BanCheckMatch {
  ban: WorkerBan;
  banTypeId: string | null;
  banTypeName: string | null;
  pluginId: string;
  message: string | null;
}

export interface BanCheckResult {
  banned: boolean;
  matches: BanCheckMatch[];
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Date-window activity check shared by the framework, denorm and crons. */
export function isBanCurrentlyActive(ban: {
  startDate: Date;
  endDate: Date | null;
}): boolean {
  const today = startOfDay(new Date());
  const startDay = startOfDay(new Date(ban.startDate));
  if (startDay > today) return false;
  if (!ban.endDate) return true;
  const endDay = startOfDay(new Date(ban.endDate));
  return endDay >= today;
}

interface ResolvedBanType {
  id: string | null;
  name: string | null;
  pluginIds: string[];
}

async function getBanTypeRow(typeId: string): Promise<{ id: string; name: string; data: unknown } | undefined> {
  const { createUnifiedOptionsStorage } = await import("../../storage/unified-options");
  const storage = createUnifiedOptionsStorage();
  return storage.get("worker-ban-type", typeId) as Promise<
    { id: string; name: string; data: unknown } | undefined
  >;
}

/**
 * Resolve a ban's type to the plugin ids it applies. Handles the legacy
 * literal `"dispatch"` type (pre-framework rows and any stragglers the boot
 * backfill has not yet rewritten) by mapping it to the all-dispatch plugin.
 * Unknown/missing types resolve to no plugins (the ban denies nothing) —
 * logged so misconfiguration is visible rather than silently enforced.
 */
export async function resolveBanType(ban: Pick<WorkerBan, "id" | "type">): Promise<ResolvedBanType> {
  if (!ban.type) return { id: null, name: null, pluginIds: [] };
  if (ban.type === LEGACY_DISPATCH_TYPE) {
    return { id: null, name: "Dispatch", pluginIds: ["all-dispatch"] };
  }
  const row = await getBanTypeRow(ban.type);
  if (!row) {
    logger.warn("Worker ban references unknown ban type; ban not enforced", {
      service: "worker-ban-service",
      banId: ban.id,
      type: ban.type,
    });
    return { id: ban.type, name: null, pluginIds: [] };
  }
  const pluginIds = (row.data as { pluginIds?: unknown } | null)?.pluginIds;
  return {
    id: row.id,
    name: row.name,
    pluginIds: Array.isArray(pluginIds) ? pluginIds.filter((p): p is string => typeof p === "string") : [],
  };
}

function enabledPluginsById(): Map<string, WorkerBanPlugin> {
  return new Map(workerBanPluginRegistry.listEnabledSync().map((p) => [p.id, p]));
}

/**
 * Check whether a worker is banned from performing `action` in `context`.
 * Returns the verdict plus every matching ban record (with its type name and
 * message) so enforcement points can surface why.
 *
 * Only registered plugins whose component is enabled are considered; bans
 * whose type references disabled/unknown plugins do not deny anything.
 */
export async function isBanned(
  action: BannableActionId,
  workerId: string,
  context: BanCheckContext = {},
): Promise<BanCheckResult> {
  const { createWorkerBanStorage } = await import("../../storage/worker-bans");
  const bans = await createWorkerBanStorage().getByWorker(workerId);
  const activeBans = bans.filter((b) => isBanCurrentlyActive(b));
  if (activeBans.length === 0) return { banned: false, matches: [] };

  const plugins = enabledPluginsById();
  const matches: BanCheckMatch[] = [];

  for (const ban of activeBans) {
    const resolved = await resolveBanType(ban);
    for (const pluginId of resolved.pluginIds) {
      const plugin = plugins.get(pluginId);
      if (!plugin) continue;
      if (!plugin.actions.includes(action)) continue;
      if (plugin.matches && !plugin.matches(ban, action, context)) continue;
      matches.push({
        ban,
        banTypeId: resolved.id,
        banTypeName: resolved.name,
        pluginId,
        message: ban.message ?? null,
      });
    }
  }

  return { banned: matches.length > 0, matches };
}

/**
 * True when the ban's type includes `pluginId` (registered, component enabled)
 * for `action`. Used by the dispatch-eligibility denorm write side to turn
 * conditional bans (facility, job type) into per-target eligibility facts.
 */
export async function banIncludesPlugin(
  ban: WorkerBan,
  pluginId: string,
  action: BannableActionId,
): Promise<boolean> {
  const resolved = await resolveBanType(ban);
  if (!resolved.pluginIds.includes(pluginId)) return false;
  const plugin = enabledPluginsById().get(pluginId);
  return !!plugin && plugin.actions.includes(action);
}

/**
 * True when the ban denies `action` UNCONDITIONALLY (via a plugin with no
 * match predicate). Used by the dispatch-eligibility denorm write side and
 * only outright dispatch bans become global `ban` facts — conditional bans
 * (facility, job type) become per-target `ban_facility` / `ban_jobtype`
 * facts via their own denorm plugins.
 */
export async function banGloballyDenies(
  ban: WorkerBan,
  action: BannableActionId,
): Promise<boolean> {
  const resolved = await resolveBanType(ban);
  if (resolved.pluginIds.length === 0) return false;
  const plugins = enabledPluginsById();
  return resolved.pluginIds.some((id) => {
    const plugin = plugins.get(id);
    return !!plugin && !plugin.matches && plugin.actions.includes(action);
  });
}
