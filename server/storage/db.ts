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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

type DriverKind = "neon" | "pg";

function detectDriver(url: string): DriverKind {
  const override = process.env.DATABASE_DRIVER;
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

export const driverKind: DriverKind = detectDriver(databaseUrl);

// Both drivers expose the node-postgres Pool API surface; the Neon Pool is
// a drop-in mimic of pg.Pool. We type the exports against the Neon flavors
// (the historical types every consumer already compiles against) and cast
// the node-postgres instances into them — they are structurally compatible
// for every call site in this codebase (query/connect/end/on, and the
// drizzle query-builder / transaction API).
let poolInstance: NeonPool | pg.Pool;
let dbInstance: NeonDatabase<typeof schema>;

if (driverKind === "neon") {
  neonConfig.webSocketConstructor = ws;
  poolInstance = new NeonPool({ connectionString: databaseUrl });
  dbInstance = drizzleNeon({ client: poolInstance as NeonPool, schema });
  console.log("[db] driver=neon (serverless/WebSocket)");
} else {
  const ssl = sslConfigFromUrl(databaseUrl);
  poolInstance = new pg.Pool({
    connectionString: stripSslParams(databaseUrl),
    ssl,
  });
  dbInstance = drizzlePg({
    client: poolInstance as pg.Pool,
    schema,
  }) as unknown as NeonDatabase<typeof schema>;
  const sslDesc = ssl === false ? "disabled" : ssl.rejectUnauthorized ? "verified" : "unverified";
  console.log(`[db] driver=pg (node-postgres/TCP), tls=${sslDesc}`);
  if (ssl !== false && !ssl.rejectUnauthorized) {
    console.warn(
      "[db] TLS certificate verification is OFF (sslmode is missing or set to " +
        "require/no-verify). For production, use sslmode=verify-full and provide " +
        "the server CA via NODE_EXTRA_CA_CERTS — see docs/aurora.md.",
    );
  }
}

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

// Exported as pg.Pool: the only consumer of the pool outside this file is
// connect-pg-simple (session store), whose types expect node-postgres. The
// Neon Pool is a runtime drop-in for every API surface used there.
export const pool = poolInstance as pg.Pool;
export const db = dbInstance;
