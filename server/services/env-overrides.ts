import { storage } from "../storage";
import { logger } from "../logger";
import { setEnvironmentVariableOverrideSource } from "../config/env-registry";

/**
 * DB-backed environment-variable overrides (Task #1080, redesigned per
 * owner direction in Task #1096).
 *
 * Each override lives in its OWN `variables` row named `ENV_{NAME}` —
 * e.g. overriding `REPLIT_ID` means a variables row named `ENV_REPLIT_ID`
 * whose value is the override string. This module loads all `ENV_`-prefixed
 * rows into an in-memory cache and installs a synchronous lookup into the
 * env registry so that `getEnvironmentVariable` falls back to the override
 * when the variable is absent from the real process environment (a real,
 * non-empty, non-__UNSET__ env value always wins).
 *
 * The cache is refreshed after every committed write to an `ENV_*` row
 * (via the variable registry's onWrite hook), so overrides take effect for
 * subsequent reads without a restart. Most consumers read lazily; the SAML
 * provider resolves its config per request (Task #1108). Consumers that
 * still read env only at boot (e.g. the auth provider LIST, session config)
 * need an app restart to pick up changes.
 */

/** Prefix for per-variable override rows in the variables table. */
export const ENV_OVERRIDE_PREFIX = "ENV_";

/** The variables-table row name that stores the override for `name`. */
export function envOverrideVariableName(name: string): string {
  return `${ENV_OVERRIDE_PREFIX}${name}`;
}

/** True when a variables-table row name is an env override row. */
export function isEnvOverrideVariableName(rowName: string): boolean {
  return rowName.startsWith(ENV_OVERRIDE_PREFIX) && rowName.length > ENV_OVERRIDE_PREFIX.length;
}

let cache = new Map<string, string>();

/** Reload the cache from all ENV_* rows in the variables table. */
export async function refreshEnvOverrides(): Promise<void> {
  const rows = await storage.variables.getByNamePrefix(ENV_OVERRIDE_PREFIX);
  const next = new Map<string, string>();
  for (const row of rows) {
    if (!isEnvOverrideVariableName(row.name)) continue;
    if (typeof row.value === "string") {
      next.set(row.name.slice(ENV_OVERRIDE_PREFIX.length), row.value);
    }
  }
  cache = next;
}

/** Current override map (env names → values). For the admin endpoints only. */
export function getEnvOverrideMap(): ReadonlyMap<string, string> {
  return cache;
}

/**
 * Load the overrides and install the sync lookup into the env registry.
 * Call once from bootstrapApp, after migrations (needs the variables table).
 */
export async function initEnvOverrides(): Promise<void> {
  await refreshEnvOverrides();
  setEnvironmentVariableOverrideSource((name) => cache.get(name));
  logger.info("Environment-variable overrides initialized", {
    source: "startup",
    count: cache.size,
  });
}
