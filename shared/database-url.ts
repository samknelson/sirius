/**
 * SINGLE source of truth for database connection-string resolution.
 *
 * Resolution rule (BAO external-database pattern): `EXTERNAL_DATABASE_URL`
 * is authoritative for EVERY DB consumer — runtime pool (server/storage/db.ts),
 * logger gating (server/logger.ts), drizzle-kit (drizzle.config.ts) and
 * db-push (scripts/db-push.ts). One identical rule everywhere so schema
 * tooling can never target a different database than the app ("split-brain").
 * Replit injects DATABASE_URL and it cannot be unset, hence the override
 * variable. The PG* piecewise variables are never consulted.
 *
 * DO NOT read `process.env.EXTERNAL_DATABASE_URL` / `process.env.DATABASE_URL`
 * directly anywhere else — import this module instead. The CI check
 * `scripts/dev/check-db-url-resolution.ts` fails the build if any file
 * outside its allowlist reads these variables directly.
 */

export type DatabaseUrlSource = "EXTERNAL_DATABASE_URL" | "DATABASE_URL";

export interface ResolvedDatabaseUrl {
  url: string;
  source: DatabaseUrlSource;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the effective connection string, or `undefined` when neither
 * variable is set. `env` is injectable for tests only; every real consumer
 * uses the default `process.env`.
 */
export function resolveDatabaseUrlOptional(
  env: EnvLike = process.env,
): ResolvedDatabaseUrl | undefined {
  if (env.EXTERNAL_DATABASE_URL) {
    return { url: env.EXTERNAL_DATABASE_URL, source: "EXTERNAL_DATABASE_URL" };
  }
  if (env.DATABASE_URL) {
    return { url: env.DATABASE_URL, source: "DATABASE_URL" };
  }
  return undefined;
}

/** Resolve the effective connection string or throw a descriptive error. */
export function resolveDatabaseUrl(env: EnvLike = process.env): ResolvedDatabaseUrl {
  const resolved = resolveDatabaseUrlOptional(env);
  if (!resolved) {
    throw new Error(
      "EXTERNAL_DATABASE_URL or DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  return resolved;
}

/**
 * Human-readable target banner: `host/dbname (from SOURCE)`.
 * Never includes credentials. Every DB consumer prints this through the
 * same function so the CI check can compare the banners verbatim.
 */
export function describeDatabaseTarget(resolved: ResolvedDatabaseUrl): string {
  try {
    const u = new URL(resolved.url);
    return `${u.hostname}${u.pathname} (from ${resolved.source})`;
  } catch {
    return `<unparseable connection string> (from ${resolved.source})`;
  }
}
