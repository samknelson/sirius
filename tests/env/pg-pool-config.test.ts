/**
 * The IAM pool config must NOT carry a connection string.
 *
 * node-postgres merges as `Object.assign({}, config, parse(connectionString))`,
 * so the parsed string is applied SECOND and every field it produces — including
 * `password: undefined` from a deliberately password-less IAM URL — overwrites
 * the explicit config. Passing both `connectionString` and a `password` provider
 * therefore silently drops the provider, and the pool connects with an empty
 * password.
 *
 * That is not hypothetical: it is what shipped. The RDS Proxy reported
 *
 *   Proxy authentication with IAM authentication failed for user
 *   "fls_api_service_user" with TLS on. Reason: The proxy couldn't authenticate
 *   using IAM. The authentication token is empty.
 *
 * and nothing upstream caught it — typecheck passed, the unit suite passed, the
 * image built, and the migrate task reached the database before failing. Only
 * enabling RDS Proxy debug logging surfaced the real reason.
 *
 * These assertions are about the SHAPE of the config, which is exactly the part
 * that was wrong.
 */
import { describe, expect, it } from "vitest";
import { buildPgPoolConfig, parseConnectionUrl } from "../../server/storage/pg-pool-config";

const IAM_URL = "postgresql://fls_api_service_user@proxy.host.rds.amazonaws.com:5432/heliumdb?sslmode=require";
const PW_URL = "postgresql://dbadmin:secret@cluster.host.rds.amazonaws.com:5432/heliumdb?sslmode=require";
const SSL = { rejectUnauthorized: false } as const;
const provider = async () => "token";
const strip = (u: string) => u;

describe("IAM mode", () => {
  const cfg = buildPgPoolConfig(IAM_URL, SSL, true, provider, strip);

  it("passes NO connectionString — the whole point", () => {
    // If this ever reappears, pg's merge order silently wins and the token is
    // replaced by undefined.
    expect(cfg.connectionString).toBeUndefined();
  });

  it("keeps the password provider as a callable", () => {
    expect(typeof cfg.password).toBe("function");
  });

  it("passes the connection as discrete fields", () => {
    expect(cfg.host).toBe("proxy.host.rds.amazonaws.com");
    expect(cfg.port).toBe(5432);
    expect(cfg.database).toBe("heliumdb");
    expect(cfg.user).toBe("fls_api_service_user");
  });

  it("still applies the explicit ssl config", () => {
    expect(cfg.ssl).toEqual(SSL);
  });

  it("simulating pg's merge does not clobber the password", () => {
    // Mirrors Object.assign({}, config, parse(connectionString)). With no
    // connection string there is nothing to merge, so the provider survives.
    const merged = Object.assign({}, cfg, cfg.connectionString ? { password: undefined } : {});
    expect(typeof merged.password).toBe("function");
  });
});

describe("password mode is unchanged", () => {
  const cfg = buildPgPoolConfig(PW_URL, SSL, false, provider, strip);

  it("uses the connection string", () => {
    expect(cfg.connectionString).toBe(PW_URL);
  });

  it("sets no password provider", () => {
    expect(cfg.password).toBeUndefined();
  });
});

describe("parseConnectionUrl fails loudly rather than producing an empty token", () => {
  it("rejects a URL with no user", () => {
    expect(() => parseConnectionUrl("postgresql://host.example:5432/db")).toThrow(/user/);
  });

  it("names BOTH ways to supply the missing part, not just DB_USER", () => {
    // DB_USER only affects the URL when assembleDatabaseUrl() builds it from
    // DB_* parts. When DATABASE_URL is supplied directly that function is a
    // no-op, so advising DB_USER alone sends the reader after a variable that
    // cannot fix their case.
    let message = "";
    try {
      parseConnectionUrl("postgresql://host.example:5432/db");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/DB_USER/);
    expect(message).toMatch(/DATABASE_URL/);
  });

  it("rejects a URL with no database", () => {
    expect(() => parseConnectionUrl("postgresql://someone@host.example:5432/")).toThrow(
      /database/,
    );
  });

  it("rejects an unparseable URL", () => {
    expect(() => parseConnectionUrl("not a url")).toThrow(/could not be parsed/);
  });

  it("defaults the port to 5432 when absent", () => {
    expect(parseConnectionUrl("postgresql://u@h.example/db").port).toBe(5432);
  });

  it("rejects port 0 — the one bad port new URL() lets through", () => {
    // ":abc" and ":99999" are rejected by the URL parser itself, so 0 is the
    // only invalid port that would otherwise reach pg and the RDS signer.
    expect(() => parseConnectionUrl("postgresql://u@h.example:0/db")).toThrow(
      /invalid port/i,
    );
  });

  it("accepts ordinary ports", () => {
    expect(parseConnectionUrl("postgresql://u@h.example:5432/db").port).toBe(5432);
    expect(parseConnectionUrl("postgresql://u@h.example:65535/db").port).toBe(65535);
  });
});
