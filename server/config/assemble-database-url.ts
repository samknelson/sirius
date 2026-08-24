/**
 * DATABASE_URL assembly from component parts (deploy-time / no-Terraform fix).
 *
 * Background: the ECS deploy pipeline's Terraform-owned task definition
 * injects the database connection *parts* into the container — `DB_HOST`,
 * `DB_PORT`, `DB_NAME`, and credentials via `DB_SECRET` — but it never
 * assembles a single `DATABASE_URL`. The app (`server/storage/db.ts`)
 * hard-requires `DATABASE_URL` at module load, so the container dies before
 * boot. Editing the Terraform task definition is out of scope for this repo
 * (and unavailable without AWS access), so we assemble the URL here at
 * process start from env vars that are already present in the container.
 *
 * This runs BEFORE anything imports `server/storage/db.ts`. In production
 * that means it must be called at the very start of `production-entry.ts`
 * `main()`, before the dynamic `import('./app-init')`. When `DATABASE_URL`
 * is already set (Replit dev, or a future Terraform revision that wires it
 * directly), this is a no-op — an explicit URL always wins.
 *
 * `DB_SECRET` shape handling: AWS Secrets Manager RDS/Aurora secrets are a
 * JSON blob (`{"username":..,"password":..,"host":..,"port":..,"dbname":..}`).
 * If `DB_SECRET` parses as JSON we pull credentials (and host/port/dbname as
 * fallbacks) from it; otherwise we treat the raw value as the password and
 * take the username from `DB_USER` / `DB_USERNAME`.
 *
 * All env access goes through the env registry (a pure leaf module, safe on
 * this pre-init boot path); the DB_* part names are registered there as core
 * variables, credentials flagged secret.
 */
import {
  getEnvironmentVariable,
  setEnvironmentVariable,
  listPresentEnvironmentVariableNames,
} from "./env-registry";
import { resolveDatabaseUrlOptional } from "@shared/database-url";

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

interface ParsedSecret {
  username?: string;
  password?: string;
  host?: string;
  port?: string;
  dbname?: string;
}

function parseDbSecret(raw: string | undefined): { json?: ParsedSecret; rawPassword?: string } {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const str = (k: string): string | undefined =>
        typeof obj[k] === "string" ? (obj[k] as string) : obj[k] != null ? String(obj[k]) : undefined;
      return {
        json: {
          username: str("username") ?? str("user"),
          password: str("password"),
          host: str("host"),
          port: str("port"),
          dbname: str("dbname") ?? str("database"),
        },
      };
    } catch {
      // Looked like JSON but wasn't — fall through to treating it as a password.
    }
  }
  return { rawPassword: trimmed };
}

/**
 * Assemble and set `DATABASE_URL` from component parts if it is not already
 * set. Throws a descriptive error (listing only the env var NAMES that are
 * present, never their values) when assembly is impossible, so the failure
 * is diagnosable remotely without leaking secrets.
 */
export function assembleDatabaseUrl(): void {
  // An explicit EXTERNAL_DATABASE_URL is authoritative for every DB consumer
  // (see server/storage/db.ts). When it is set, assembly is unnecessary — an
  // assembled DATABASE_URL must never win over the explicit external URL.
  const existing = resolveDatabaseUrlOptional();
  if (existing?.source === "EXTERNAL_DATABASE_URL") {
    console.log(
      "[db-config] EXTERNAL_DATABASE_URL is set — skipping DATABASE_URL assembly (external URL is authoritative).",
    );
    return;
  }
  if (existing || getEnvironmentVariable("DATABASE_URL")) return;

  const { json, rawPassword } = parseDbSecret(getEnvironmentVariable("DB_SECRET"));

  const host = firstNonEmpty(getEnvironmentVariable("DB_HOST"), json?.host);
  const port = firstNonEmpty(getEnvironmentVariable("DB_PORT"), json?.port) ?? "5432";
  const dbname = firstNonEmpty(getEnvironmentVariable("DB_NAME"), json?.dbname);
  const user = firstNonEmpty(
    getEnvironmentVariable("DB_USER"),
    getEnvironmentVariable("DB_USERNAME"),
    json?.username,
  );
  const password = firstNonEmpty(getEnvironmentVariable("DB_PASSWORD"), json?.password, rawPassword);
  const sslmode = firstNonEmpty(getEnvironmentVariable("DB_SSLMODE")) ?? "require";

  if (host && dbname && user && password) {
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
      password,
    )}@${host}:${port}/${dbname}?sslmode=${sslmode}`;
    setEnvironmentVariable("DATABASE_URL", url);
    console.log(
      `[db-config] Assembled DATABASE_URL from parts (host=${host} port=${port} db=${dbname} sslmode=${sslmode}).`,
    );
    return;
  }

  // Could not assemble. Report only the NAMES of DB-related env vars that are
  // present so the shape can be diagnosed remotely without exposing values.
  const dbEnvNames = listPresentEnvironmentVariableNames(
    (k) => k === "DATABASE_URL" || k.startsWith("DB_"),
  );
  const missing = [
    !host && "host (DB_HOST or DB_SECRET.host)",
    !dbname && "dbname (DB_NAME or DB_SECRET.dbname)",
    !user && "username (DB_USER/DB_USERNAME or DB_SECRET.username)",
    !password && "password (DB_PASSWORD or DB_SECRET.password / raw DB_SECRET)",
  ].filter(Boolean);

  throw new Error(
    "DATABASE_URL is not set and could not be assembled from component env " +
      `vars. Present DB-related env var names: [${dbEnvNames.join(", ") || "none"}]. ` +
      `Unresolved: ${missing.join("; ")}.`,
  );
}
