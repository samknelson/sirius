/**
 * Database driver selection (Task #670 — Aurora / generic Postgres support).
 *
 * The app historically connected exclusively through the Neon serverless
 * driver, which speaks Neon's WebSocket proxy protocol and therefore only
 * works against Neon endpoints. To support AWS Aurora (and any other plain
 * Postgres server), this module now picks a driver automatically from the
 * connection string:
 *
 *   - Neon URLs (host contains ".neon.tech")  → @neondatabase/serverless
 *     over WebSockets (unchanged behavior).
 *   - Everything else (Aurora, RDS, vanilla Postgres) → node-postgres (`pg`)
 *     over plain TCP, with SSL derived from the URL's `sslmode` parameter.
 *
 * The exported `db` / `pool` surface is identical in both cases: every
 * consumer (storage modules, transaction-context, connect-pg-simple session
 * store) keeps working unchanged. The `DATABASE_DRIVER` env var (`neon` |
 * `pg`) overrides the automatic detection when needed.
 */
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle as drizzleNeon, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import ws from "ws";
import * as schema from "@shared/schema";
import { resolveDatabaseUrl, describeDatabaseTarget } from "@shared/database-url";
import { getEnvironmentVariable } from "../config/env-registry";
import { getDatabaseUrlSource, isIamAuth } from "../config/assemble-database-url";
import { recordDatabaseIdentity, type BringUpDatabaseIdentity } from "../services/bringup-report";
import { buildPgPoolConfig, parseConnectionUrl } from "./pg-pool-config";

// Resolution order (BAO external-database pattern): EXTERNAL_DATABASE_URL is
// authoritative for EVERY DB consumer — the shared resolver in
// shared/database-url.ts is the single source of truth (enforced by
// scripts/dev/check-db-url-resolution.ts).
const resolvedDatabaseUrl = resolveDatabaseUrl();
const databaseUrl = resolvedDatabaseUrl.url;
// Guardrail banner: same format as drizzle.config.ts / scripts/db-push.ts so
// the CI check can compare all consumers' targets verbatim.
console.log(`[db] Target database: ${describeDatabaseTarget(resolvedDatabaseUrl)}`);

type DriverKind = "neon" | "pg";

/**
 * The Neon serverless WebSocket driver connects directly to Neon's compute
 * endpoint and manages its own connection pool — it does NOT benefit from
 * Neon's PgBouncer pooler (the `-pooler.` subdomain). Moreover, the pooler
 * runs in transaction mode and blocks session-level startup parameters
 * (including `search_path`), which breaks the app because Neon defaults
 * `search_path` to `''` (empty) rather than the Postgres standard `public`.
 *
 * When the URL targets the pooler, silently rewrite it to the direct endpoint
 * so that:
 *   1. `ALTER DATABASE <db> SET search_path TO public` (run once on new Neon
 *      databases) is honoured by the direct connection.
 *   2. The serverless driver's own pooling kicks in instead of PgBouncer.
 *
 * The rewrite is transparent: `ep-<id>-pooler.<region>.aws.neon.tech` →
 * `ep-<id>.<region>.aws.neon.tech`.  URLs already targeting the direct
 * endpoint pass through unchanged.
 */
function rewriteNeonPoolerUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("-pooler.") && parsed.hostname.endsWith(".neon.tech")) {
      const directHost = parsed.hostname.replace("-pooler.", ".");
      parsed.hostname = directHost;
      const rewritten = parsed.toString();
      console.log("[db] Neon pooler URL detected; rewriting to direct endpoint for serverless driver.");
      return rewritten;
    }
    return url;
  } catch {
    return url;
  }
}

function detectDriver(url: string): DriverKind {
  const override = getEnvironmentVariable("DATABASE_DRIVER");
  if (override === "neon" || override === "pg") return override;
  if (override) {
    throw new Error(
      `DATABASE_DRIVER must be "neon" or "pg" (got "${override}").`,
    );
  }
  try {
    const host = new URL(url).hostname;
    return host.endsWith(".neon.tech") || host.includes(".neon.") ? "neon" : "pg";
  } catch {
    // Unparseable URL: let the Neon driver (historical default) surface the
    // connection error.
    return "neon";
  }
}

/**
 * Derive node-postgres SSL config from the URL's `sslmode` query parameter.
 * Aurora/RDS endpoints require TLS but present certificates signed by the
 * AWS RDS CA, which is not in Node's default trust store — `sslmode=require`
 * / `no-verify` therefore map to encrypted-but-unverified. For full
 * verification use `sslmode=verify-full` and provide the CA bundle via
 * NODE_EXTRA_CA_CERTS.
 */
function sslConfigFromUrl(url: string): false | { rejectUnauthorized: boolean } {
  let sslmode: string | null = null;
  try {
    sslmode = new URL(url).searchParams.get("sslmode");
  } catch {
    sslmode = null;
  }
  switch (sslmode) {
    case "disable":
      return false;
    case "verify-ca":
    case "verify-full":
      return { rejectUnauthorized: true };
    case "require":
    case "prefer":
    case "allow":
    case "no-verify":
      return { rejectUnauthorized: false };
    default:
      // No sslmode specified: default to encrypted-but-unverified, which
      // works for both Aurora (TLS required) and local dev Postgres
      // (falls back below only if explicitly disabled).
      return { rejectUnauthorized: false };
  }
}

/**
 * Strip TLS-related query parameters from the connection string.
 *
 * node-postgres merges a pool config with the parsed connection string via
 * `Object.assign({}, config, parse(connectionString))` — so anything the
 * connection string parses to WINS over the explicit config we pass. Crucially
 * `pg-connection-string` maps `sslmode=require` to `ssl = {}` (rejectUnauthorized
 * defaults to true → full CA verification), which silently overrides our
 * explicit `ssl: { rejectUnauthorized: false }`. Against Aurora/RDS — whose cert
 * is signed by the AWS RDS CA that Node does not trust by default — that surfaces
 * as "unable to get local issuer certificate" at boot.
 *
 * We derive the SSL config ourselves from `sslmode` (see `sslConfigFromUrl`) and
 * pass it explicitly, so we remove the ssl* params from the string handed to the
 * pool. With no ssl* params present, `parse()` produces no `ssl` key and our
 * explicit config is the one that takes effect.
 */
function stripSslParams(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [
      "sslmode",
      "ssl",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "sslnegotiation",
    ]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    // Unparseable URL: hand it through untouched and let the driver surface
    // whatever error it would have.
    return url;
  }
}

/**
 * IAM auth password provider (RDS Proxy).
 *
 * An RDS IAM auth token IS the password, but it is signed and expires in ~15
 * minutes — so it cannot be baked into the connection string at boot. pg
 * accepts a function for `password` and calls it for EVERY new connection, so
 * long-lived pools keep working and expiry is handled for free.
 *
 * The `@aws-sdk/rds-signer` import is dynamic and only happens in IAM mode:
 * the password path must not require the dependency to be resolvable, so
 * password-based deployments (dev, and any environment with
 * enable_db_rbac = false) behave exactly as before.
 */
function iamPasswordProvider(url: string): () => Promise<string> {
  // Parsed via the shared helper rather than `new URL()` directly. This
  // function is evaluated as an ARGUMENT to buildPgPoolConfig, so it runs
  // first — parsing here with a bare constructor would throw
  // "TypeError: Invalid URL" and pre-empt the purpose-built errors that
  // parseConnectionUrl raises for exactly this failure.
  const { host: hostname, port, user: username } = parseConnectionUrl(url);
  // ECS injects AWS_REGION; AWS_DEFAULT_REGION is the CLI/SDK fallback.
  const region =
    getEnvironmentVariable("AWS_REGION") ??
    getEnvironmentVariable("AWS_DEFAULT_REGION");

  if (!region) {
    throw new Error(
      "DB_IAM_AUTH is on but neither AWS_REGION nor AWS_DEFAULT_REGION is set; " +
        "the RDS signer cannot build a token without a region.",
    );
  }

  let signer: { getAuthToken: () => Promise<string> } | undefined;

  return async () => {
    if (!signer) {
      const { Signer } = await import("@aws-sdk/rds-signer");
      signer = new Signer({ hostname, port, username, region });
    }
    return signer.getAuthToken();
  };
}

export const driverKind: DriverKind = detectDriver(databaseUrl);

// Both drivers expose the node-postgres Pool API surface; the Neon Pool is
// a drop-in mimic of pg.Pool. We type the exports against the Neon flavors
// (the historical types every consumer already compiles against) and cast
// the node-postgres instances into them — they are structurally compatible
// for every call site in this codebase (query/connect/end/on, and the
// drizzle query-builder / transaction API).
let poolInstance: NeonPool | pg.Pool;
let dbInstance: NeonDatabase<typeof schema>;
let tlsDescription: string;

/**
 * How long a connection checkout may take before it fails (Task #1350).
 *
 * Without this, `pool.connect()` waits forever: an unreachable or saturated
 * database turns every boot step — and the wait for the schema bring-up lock,
 * which needs a connection before it can even ask — into an indefinite hang
 * with the process deliberately staying alive. A bounded checkout makes an
 * unreachable database a NAMED boot failure instead.
 */
const connectionTimeoutMillis = (() => {
  const raw = getEnvironmentVariable("DB_CONNECT_TIMEOUT_MS");
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 15_000;
})();

// The EFFECTIVE connection string (post pooler-rewrite for Neon). Used only
// to derive credential-free display info below.
let effectiveDatabaseUrl = databaseUrl;

if (driverKind === "neon") {
  neonConfig.webSocketConstructor = ws;
  const neonUrl = rewriteNeonPoolerUrl(databaseUrl);
  effectiveDatabaseUrl = neonUrl;
  poolInstance = new NeonPool({ connectionString: neonUrl, connectionTimeoutMillis });
  dbInstance = drizzleNeon({ client: poolInstance as NeonPool, schema });
  tlsDescription = "TLS terminated by the Neon WebSocket proxy";
  console.log("[db] driver=neon (serverless/WebSocket)");
} else {
  const ssl = sslConfigFromUrl(databaseUrl);
  // Under IAM auth this passes discrete host/port/database/user fields and NO
  // connection string, because pg applies the parsed connection string over the
  // explicit config — a password-less URL parses to `password: undefined` and
  // would overwrite the token provider, producing the proxy's "authentication
  // token is empty". See server/storage/pg-pool-config.ts.
  // Read ONCE. isIamAuth() now derives from the environment on each call, so
  // two reads could in principle disagree and yield a config that is IAM in one
  // field and password in another — the sort of half-state that produced the
  // empty-token failure.
  const iamAuth = isIamAuth();
  poolInstance = new pg.Pool({
    ...buildPgPoolConfig(
      databaseUrl,
      ssl,
      iamAuth,
      // Built only in IAM mode: iamPasswordProvider validates its inputs and
      // throws when they are absent, which must not happen on the password path.
      iamAuth ? iamPasswordProvider(databaseUrl) : (async () => ""),
      stripSslParams,
    ),
    // Bounded checkout applies on BOTH paths: an unreachable database must be a
    // named boot failure whether we authenticate with a password or an IAM token.
    connectionTimeoutMillis,
  });
  dbInstance = drizzlePg({
    client: poolInstance as pg.Pool,
    schema,
  }) as unknown as NeonDatabase<typeof schema>;
  const sslDesc =
    ssl === false
      ? "disabled (plaintext)"
      : ssl.rejectUnauthorized
        ? "encrypted, certificate verified"
        : "encrypted, certificate NOT verified";
  tlsDescription = sslDesc;
  console.log(`[db] driver=pg (node-postgres/TCP), tls=${sslDesc}`);
  if (ssl !== false && !ssl.rejectUnauthorized) {
    console.warn(
      "[db] TLS certificate verification is OFF (sslmode is missing or set to " +
        "require/no-verify). For production, use sslmode=verify-full and provide " +
        "the server CA via NODE_EXTRA_CA_CERTS — see docs/aurora.md.",
    );
  }
}

/**
 * Which database this process actually reached — host, database, user,
 * driver, TLS mode, and whether the URL was handed to us or assembled from
 * DB_HOST/DB_NAME/DB_SECRET parts.
 *
 * NEVER includes the password. On a target with no shell, a wrong DB_* part
 * is a plausible cause of "the migrations didn't run" and was previously
 * invisible: the log said only which driver was chosen.
 */
export function getDatabaseIdentity(): BringUpDatabaseIdentity {
  let host = "(unparseable URL)";
  let port = "";
  let database = "";
  let user = "";
  try {
    const parsed = new URL(databaseUrl!);
    host = parsed.hostname;
    port = parsed.port || "5432";
    database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "(default)";
    user = parsed.username ? decodeURIComponent(parsed.username) : "(none in URL)";
  } catch {
    // Leave the placeholders; the driver will surface its own error.
  }
  return {
    host,
    port,
    database,
    user,
    driver: driverKind === "neon" ? "neon (serverless/WebSocket)" : "pg (node-postgres/TCP)",
    tls: tlsDescription,
    urlSource:
      getDatabaseUrlSource() === "assembled-from-parts"
        ? "assembled from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_SECRET parts"
        : "DATABASE_URL supplied directly",
  };
}

// Log it immediately, before anything queries the database, so the deploy
// log answers "is this even the right database?" on its own.
const identity = getDatabaseIdentity();
recordDatabaseIdentity(identity);
console.log(
  `[db] connected target: host=${identity.host}:${identity.port} database=${identity.database} ` +
    `user=${identity.user} driver=${identity.driver} tls=${identity.tls} ` +
    `url=${getDatabaseUrlSource()}`,
);

// Postgres servers will drop idle pooled connections — e.g. when Neon's
// compute autosuspends or an Aurora failover occurs, the server sends
// "terminating connection due to administrator command". node-postgres
// surfaces that as an 'error' event on the Pool. If no listener is attached,
// Node treats an emitted 'error' as an uncaught exception and crashes the
// process, which shows up as intermittent "Internal Server Error" responses
// for whoever is using the app at that moment. Handling the event keeps the
// process alive; the dead client is discarded and the next query
// transparently gets a fresh connection from the pool.
poolInstance.on("error", (err: Error) => {
  console.error("PG Pool error (idle client terminated, recovering):", err.message);
});

/**
 * Keep every database session in the same time zone as this process.
 *
 * The core tables store `timestamp without time zone`, so a value's meaning
 * comes entirely from the zone of whoever writes it — and there are TWO
 * writers. The application writes a JavaScript Date, which the driver
 * serializes using the PROCESS zone. A column default of `now()` is evaluated
 * by Postgres using the SESSION zone, which starts at the server's own default
 * (commonly GMT) and knows nothing about `TZ`. Left alone the two disagree,
 * and rows in the same table end up offset from each other depending on which
 * writer produced them — considerably worse than both being uniformly wrong,
 * because no single correction fixes it.
 *
 * Applied per checkout rather than baked into the pool config because the zone
 * is not known when this module is evaluated: `TZ` may come from an in-app
 * override that is only readable once the database itself is up. Reading the
 * live process zone here means connections opened before the override loaded
 * are corrected on their next checkout, with no pool recycling.
 *
 * Cost in steady state is a property comparison; the round-trip happens only
 * on a connection's first checkout, and again on any that predate a change.
 */
const APPLIED_TIME_ZONE = Symbol("sessionTimeZoneApplied");

poolInstance.on("acquire", (client: any) => {
  const desired = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (client[APPLIED_TIME_ZONE] === desired) return;
  client[APPLIED_TIME_ZONE] = desired;
  // Parameterizing is not available for SET; the value is an IANA zone name
  // validated at boot (server/config/system-timezone.ts refuses to start on
  // anything Intl does not recognise), and it originates from the runtime
  // rather than from a request.
  client.query(`SET TIME ZONE '${desired.replace(/'/g, "''")}'`).catch((error: unknown) => {
    // Unknown state: clear the marker so the next checkout retries.
    client[APPLIED_TIME_ZONE] = undefined;
    console.error(
      "[db] Failed to set session time zone; timestamps written by column " +
        "defaults may be offset from those written by the app:",
      error instanceof Error ? error.message : String(error),
    );
  });
});

// Exported as pg.Pool for the rare infrastructure consumer that needs the
// raw pool (application code goes through the drizzle `db` / storage layer).
// The Neon Pool is a runtime drop-in for the node-postgres API surface.
export const pool = poolInstance as pg.Pool;
export const db = dbInstance;

/**
 * Create a small, independent pool for infrastructure protocols that must
 * hold session-scoped state (for example advisory locks) across application
 * work. Keeping these clients out of the main storage pool prevents a set of
 * long-lived leases from consuming every connection handlers need to finish.
 */
export function createInfrastructurePool(options: { max: number }): pg.Pool {
  let infrastructurePool: NeonPool | pg.Pool;
  if (driverKind === "neon") {
    infrastructurePool = new NeonPool({
      connectionString: effectiveDatabaseUrl,
      max: options.max,
    });
  } else {
    infrastructurePool = new pg.Pool({
      connectionString: stripSslParams(databaseUrl),
      ssl: sslConfigFromUrl(databaseUrl),
      max: options.max,
    });
  }
  infrastructurePool.on("error", (err: Error) => {
    console.error("PG infrastructure pool error (idle client terminated, recovering):", err.message);
  });
  return infrastructurePool as pg.Pool;
}

/**
 * Credential-free description of the resolved database target, for admin
 * display (Task #178). Derived from the EFFECTIVE connection string (after
 * the Neon pooler rewrite), so the Neon endpoint ID matches the endpoint the
 * app actually connects to. Never includes username, password, or the full
 * connection string.
 */
export interface DatabaseSourceInfo {
  /** Effective hostname the app connects to. */
  host: string;
  /** Database name (URL path without leading slash). */
  database: string;
  /** Which env var supplied the connection string. */
  source: "EXTERNAL_DATABASE_URL" | "DATABASE_URL";
  /** Selected driver: Neon serverless (WebSocket) or node-postgres (TCP). */
  driver: DriverKind;
  /** Neon endpoint ID (`ep-…` hostname prefix) when the host is a Neon endpoint. */
  neonEndpointId: string | null;
  /** True when the original URL targeted the `-pooler.` endpoint and was rewritten. */
  poolerRewritten: boolean;
}

export const databaseSourceInfo: DatabaseSourceInfo = (() => {
  let host = "<unparseable>";
  let database = "<unparseable>";
  try {
    const u = new URL(effectiveDatabaseUrl);
    host = u.hostname;
    database = u.pathname.replace(/^\//, "");
  } catch {
    // leave placeholders — never fall back to the raw string (credentials).
  }
  const isNeonHost = host.endsWith(".neon.tech");
  const neonEndpointId =
    isNeonHost && host.startsWith("ep-") ? host.split(".")[0] : null;
  let poolerRewritten = false;
  try {
    poolerRewritten =
      new URL(databaseUrl).hostname !== host && isNeonHost;
  } catch {
    poolerRewritten = false;
  }
  return {
    host,
    database,
    source: resolvedDatabaseUrl.source,
    driver: driverKind,
    neonEndpointId,
    poolerRewritten,
  };
})();
