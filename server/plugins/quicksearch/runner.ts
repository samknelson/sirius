import type { User } from "@shared/schema";
import {
  QUICKSEARCH_MIN_QUERY_LENGTH,
  type QuicksearchFailure,
  type QuicksearchGroup,
  type QuicksearchResponse,
} from "@shared/quicksearch";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { checkAccess, getAccessStorage } from "../../services/access-policy-evaluator";
import { isPluginComponentEnabledAsync } from "../_core";
import { quicksearchPluginRegistry } from "./registry";
import type { QuicksearchPlugin, QuicksearchResult as QuicksearchResultRow } from "./types";

const SERVICE = "quicksearch";

/** Rows one searcher may contribute. The dialog is a jump list, not a report. */
export const QUICKSEARCH_RESULT_LIMIT = 8;

/**
 * How long one searcher gets. Searchers run concurrently, so this also bounds
 * the whole request: a single slow plugin cannot stall the dialog, and the
 * others' results still come back. The abandoned query keeps running in the
 * database until it finishes — the budget bounds what the USER waits for, not
 * what Postgres does.
 */
export const QUICKSEARCH_BUDGET_MS = 2500;

/** Resolve a promise, or `TIMED_OUT` once the budget expires. */
const TIMED_OUT = Symbol("quicksearch-timeout");

async function withBudget<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Force off every permission-gated option the user may not use.
 *
 * This is the framework's job, not the plugin's: a searcher must not be able
 * to run its SSN clause because its author forgot the check, and a config that
 * switches SSN matching on must not become an end-run around the permission.
 */
async function applyPermissionGates(
  plugin: QuicksearchPlugin,
  userId: string,
  settings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const gates = plugin.permissionGatedOptions;
  if (!gates) return settings;
  const accessStorage = getAccessStorage();
  const out = { ...settings };
  for (const [key, permission] of Object.entries(gates)) {
    if (!out[key]) continue;
    const allowed = accessStorage
      ? await accessStorage.hasPermission(userId, permission)
      : false;
    if (!allowed) out[key] = false;
  }
  return out;
}

/**
 * Run every quicksearch configuration this user's roles allow.
 *
 * The role check is the access decision (see the task plan): an administrator
 * granting a role a searcher has decided anyone with that role may see any
 * record it returns. It is therefore made HERE, server-side, from the user's
 * own roles — never from anything the client asked for. Finding a record still
 * implies nothing about reaching its page: the link lands on the record's own
 * route, which gates independently.
 */
export async function runQuicksearch(
  user: User,
  rawQuery: string,
): Promise<QuicksearchResponse> {
  const query = rawQuery.trim();
  if (query.length < QUICKSEARCH_MIN_QUERY_LENGTH) {
    return { query, groups: [], failures: [] };
  }

  const roles = await storage.users.getUserRoles(user.id);
  const roleIds = roles.map((r) => r.id);
  // An empty role set matches no configuration (the subsidiary filter turns it
  // into `false`), so a user with no roles searches nothing.
  const envelopes = await storage.pluginConfigs.search("quicksearch", {
    enabled: true,
    roleIn: roleIds,
  });

  type Runnable = {
    plugin: QuicksearchPlugin;
    configId: string;
    label: string;
    settings: Record<string, unknown>;
  };
  const runnables: Runnable[] = [];

  const groups: QuicksearchGroup[] = [];
  const failures: QuicksearchFailure[] = [];

  for (const { config } of envelopes) {
    const plugin = quicksearchPluginRegistry.get(config.pluginId);
    if (!plugin) continue;
    // Deciding whether a searcher may run is itself fallible (it reads the
    // component state and evaluates a policy). Isolate it per config for the
    // same reason the search itself is isolated: one evaluator hiccup must
    // cost that group, not the whole dialog. A gate that REFUSES is silent; a
    // gate that BREAKS is reported.
    try {
      // A searcher whose component is off does not run, even if a config row
      // still names it.
      if (!(await isPluginComponentEnabledAsync(plugin))) continue;
      if (plugin.requiredPolicy) {
        const access = await checkAccess(plugin.requiredPolicy, user);
        if (!access.granted) continue;
      }
      const stored = (config.data ?? {}) as Record<string, unknown>;
      runnables.push({
        plugin,
        configId: config.id,
        label: config.name || plugin.name,
        settings: await applyPermissionGates(plugin, user.id, stored),
      });
    } catch (error) {
      logger.error("Quicksearch could not decide whether a searcher may run", {
        service: SERVICE,
        pluginId: plugin.id,
        configId: config.id,
        error: error instanceof Error ? error.message : String(error),
      });
      failures.push({
        configId: config.id,
        pluginId: plugin.id,
        label: config.name || plugin.name,
        reason: "error",
      });
    }
  }

  type Outcome =
    | { runnable: Runnable; results: QuicksearchResultRow[] }
    | { runnable: Runnable; reason: "timeout" | "error" };

  const settled: Outcome[] = await Promise.all(
    runnables.map(async (runnable): Promise<Outcome> => {
      try {
        const outcome = await withBudget(
          runnable.plugin.search({
            query,
            // Ask for one more than we will show so the group can honestly
            // report that it was truncated.
            limit: QUICKSEARCH_RESULT_LIMIT,
            user,
            settings: runnable.settings,
            configId: runnable.configId,
            storage,
          }),
          QUICKSEARCH_BUDGET_MS,
        );
        if (outcome === TIMED_OUT) {
          logger.warn("Quicksearch plugin exceeded its budget", {
            service: SERVICE,
            pluginId: runnable.plugin.id,
            configId: runnable.configId,
            budgetMs: QUICKSEARCH_BUDGET_MS,
          });
          return { runnable, reason: "timeout" };
        }
        return { runnable, results: outcome };
      } catch (error) {
        logger.error("Quicksearch plugin failed", {
          service: SERVICE,
          pluginId: runnable.plugin.id,
          configId: runnable.configId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { runnable, reason: "error" as const };
      }
    }),
  );

  // `runnables` preserves the configured order (the generic search orders by
  // ordering, then id), and Promise.all preserves input order, so groups come
  // back in the order an administrator arranged them.
  for (const outcome of settled) {
    const { runnable } = outcome;
    if ("reason" in outcome) {
      failures.push({
        configId: runnable.configId,
        pluginId: runnable.plugin.id,
        label: runnable.label,
        reason: outcome.reason,
      });
      continue;
    }
    const results = outcome.results ?? [];
    if (results.length === 0) continue;
    groups.push({
      configId: runnable.configId,
      pluginId: runnable.plugin.id,
      label: runnable.label,
      icon: runnable.plugin.icon,
      results: results.slice(0, QUICKSEARCH_RESULT_LIMIT),
      truncated: results.length > QUICKSEARCH_RESULT_LIMIT,
    });
  }

  return { query, groups, failures };
}

/**
 * Whether this user has ANY quicksearch configuration at all. Drives the
 * header button: a role with no searcher granted gets no search button rather
 * than a box that can only ever say "no results".
 */
export async function userHasQuicksearch(user: User): Promise<boolean> {
  const roles = await storage.users.getUserRoles(user.id);
  const envelopes = await storage.pluginConfigs.search("quicksearch", {
    enabled: true,
    roleIn: roles.map((r) => r.id),
  });
  for (const { config } of envelopes) {
    const plugin = quicksearchPluginRegistry.get(config.pluginId);
    if (!plugin) continue;
    try {
      if (!(await isPluginComponentEnabledAsync(plugin))) continue;
      if (plugin.requiredPolicy) {
        const access = await checkAccess(plugin.requiredPolicy, user);
        if (!access.granted) continue;
      }
    } catch (error) {
      // A gate that cannot be evaluated is not a grant. Keep looking: another
      // configuration may still entitle this user to the search control.
      logger.error("Quicksearch availability gate failed", {
        service: SERVICE,
        pluginId: plugin.id,
        configId: config.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    return true;
  }
  return false;
}
