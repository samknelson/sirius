/**
 * node-postgres Pool configuration, built as a pure function so it can be
 * tested without importing `db.ts` (which requires DATABASE_URL at module load
 * and opens a pool as a side effect).
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE. node-postgres merges its config with
 * the parsed connection string as:
 *
 *     Object.assign({}, config, parse(connectionString))
 *
 * The connection string is applied SECOND, so every field it parses to — even
 * `undefined` — overwrites the explicit config. That is fine for password auth,
 * where the string carries everything. It is fatal under IAM auth, where the
 * URL is deliberately password-less: `parse()` yields `password: undefined`,
 * which silently replaces the token-provider function, and the pool then sends
 * an empty password. The RDS Proxy reports this as
 *
 *     The proxy couldn't authenticate using IAM.
 *     The authentication token is empty.
 *
 * which names the symptom and not the cause. So in IAM mode we do NOT pass a
 * connection string at all: the URL is decomposed into discrete fields and the
 * password provider is passed alongside them, where nothing can overwrite it.
 */
import type { PoolConfig } from "pg";

export type SslConfig = false | { rejectUnauthorized: boolean };

/** Fields decomposed from a postgres:// URL. */
export interface ParsedConnection {
  host: string;
  port: number;
  database: string;
  user: string;
}

/**
 * Decompose a postgres:// URL into the fields pg needs. Throws on a URL that
 * cannot be parsed or is missing a part IAM auth requires — better a named
 * error at boot than an empty-token rejection from the proxy.
 */
export function parseConnectionUrl(url: string): ParsedConnection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "DATABASE_URL could not be parsed as a URL, which IAM auth requires in " +
        "order to pass host/port/database/user to the pool as discrete fields.",
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(parsed.username);
  const missing = [
    !parsed.hostname && "host",
    !database && "database",
    !user && "user",
  ].filter(Boolean);
  if (missing.length > 0) {
    // Names BOTH levers deliberately. DB_USER only affects the URL when
    // assembleDatabaseUrl() builds it from DB_* parts; when DATABASE_URL is
    // supplied directly that function is a no-op and DB_USER is ignored, so
    // advising DB_USER alone would send the reader after a variable that
    // cannot fix their case.
    throw new Error(
      `DATABASE_URL is missing ${missing.join(", ")}, which IAM auth requires. ` +
        "Under DB_IAM_AUTH the URL carries no password, so every other part must be present. " +
        "Either set the DB_* parts (DB_HOST, DB_NAME, DB_USER) and let them be assembled, " +
        "or include the missing part in an explicitly-provided DATABASE_URL " +
        "(e.g. postgresql://fls_api_service_user@host:5432/dbname?sslmode=require).",
    );
  }

  // `new URL()` already rejects non-numeric and out-of-range ports (":abc" and
  // ":99999" both throw above), so the only bad value that reaches here is 0.
  // Catch it explicitly rather than letting a zero port flow into both pg and
  // the RDS signer and resurface as a vaguer connection error.
  const port = Number(parsed.port || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `DATABASE_URL has an invalid port (${parsed.port || port}). ` +
        "Expected an integer between 1 and 65535; Postgres is conventionally 5432.",
    );
  }

  return {
    host: parsed.hostname,
    port,
    database,
    user,
  };
}

/**
 * Build the Pool config.
 *
 * @param url            the assembled DATABASE_URL
 * @param ssl            SSL config derived from the URL's sslmode
 * @param iamAuth        whether this process authenticates with IAM tokens
 * @param passwordProvider  called per new connection to mint a token; only used
 *                          when iamAuth is true
 * @param stripSslParams  removes ssl* query params (password path only, where
 *                        the connection string is still used)
 */
export function buildPgPoolConfig(
  url: string,
  ssl: SslConfig,
  iamAuth: boolean,
  passwordProvider: () => Promise<string>,
  stripSslParams: (u: string) => string,
): PoolConfig {
  if (!iamAuth) {
    // Password path: unchanged. The connection string carries the credentials
    // and pg's merge order is harmless.
    return { connectionString: stripSslParams(url), ssl };
  }

  // IAM path: discrete fields ONLY. Passing `connectionString` here would let
  // pg's merge overwrite `password` with undefined — see the module docblock.
  const { host, port, database, user } = parseConnectionUrl(url);
  return { host, port, database, user, password: passwordProvider, ssl };
}
