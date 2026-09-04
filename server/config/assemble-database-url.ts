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

/**
 * How the DATABASE_URL this process is using came to be. Read by the
 * bring-up report so "is this even the right database?" is answerable from
 * the deploy log: an assembled URL means a wrong DB_* part is plausible.
 *
 * Starts as "explicit" because {@link assembleDatabaseUrl} is only called by
 * the production entry point — when it never runs (Replit dev), the URL can
 * only have come from the environment.
 */
let urlSource: "explicit" | "assembled-from-parts" = "explicit";

export function getDatabaseUrlSource(): "explicit" | "assembled-from-parts" {
  return urlSource;
}

/**
 * IAM database authentication (RDS Proxy).
 *
 * When `DB_IAM_AUTH` is truthy the connection carries NO password: the app
 * mints a short-lived AWS IAM token per connection instead (see
 * `server/storage/db.ts`). The assembled URL is therefore password-less, and
 * the pool is given a `password` callback rather than a literal.
 *
 * Opt-in via an explicit env var rather than inferred from "no password
 * present" on purpose: inferring would turn a MISSING `DB_SECRET` — a
 * misconfiguration the current error message diagnoses precisely — into a
 * silent switch to IAM mode that then fails later with an opaque auth error.
 */
function envFlag(name: string): boolean {
  const v = getEnvironmentVariable(name);
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

/**
 * True when this process authenticates to Postgres with IAM tokens.
 *
 * Derived from the environment on every call, NOT from a flag set as a side
 * effect of {@link assembleDatabaseUrl}. It used to be the latter, which made
 * the answer depend on whether an entry point happened to have run: only
 * the production entry point calls `assembleDatabaseUrl()`, so
 * anything importing `server/storage/db` directly — `scripts/db-push.ts` does —
 * saw `false` regardless of `DB_IAM_AUTH`. With a password-less URL that
 * silently selects the password path and connects with an empty password, which
 * is exactly the failure this codebase already spent a long time diagnosing
 * once. Reading the env removes the ordering dependency entirely.
 */
export function isIamAuth(): boolean {
  return envFlag("DB_IAM_AUTH");
}

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
    urlSource = "explicit";
    return;
  }

  // Local copy so every branch below reasons about one consistent value for
  // the duration of this call; isIamAuth() is the shared accessor elsewhere.
  const iamAuth = isIamAuth();

  if (existing || getEnvironmentVariable("DATABASE_URL")) {
    urlSource = "explicit";
    return;
  }

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

  // IAM auth: no password exists to embed. Emit a password-less URL — still a
  // valid postgres:// URL, so URL parsing (getDatabaseIdentity) and pg's
  // connectionString handling both keep working — and let db.ts supply a
  // `password` callback that mints a token per connection.
  if (iamAuth && host && dbname && user) {
    const url = `postgresql://${encodeURIComponent(user)}@${host}:${port}/${dbname}?sslmode=${sslmode}`;
    // Environment-sourced: every part of this URL came from the deployment, so
    // the assembled whole is a deployment value too and keeps outranking any
    // stored one.
    setEnvironmentVariable("DATABASE_URL", url, "environment");
    urlSource = "assembled-from-parts";
    console.log(
      `[db-config] Assembled password-less DATABASE_URL for IAM auth ` +
        `(host=${host} port=${port} db=${dbname} user=${user} sslmode=${sslmode}).`,
    );
    return;
  }

  if (host && dbname && user && password) {
    const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
      password,
    )}@${host}:${port}/${dbname}?sslmode=${sslmode}`;
    // Environment-sourced, as above: assembled out of deployment-supplied parts.
    setEnvironmentVariable("DATABASE_URL", url, "environment");
    // Provenance for the bring-up report: "assembled from parts" is the case
    // where a single wrong DB_* value silently points the deployment at the
    // wrong database, so the report has to say which case this was.
    urlSource = "assembled-from-parts";
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
    // Under IAM auth a password is not merely optional — none exists — so
    // listing it as unresolved would send whoever reads this log looking for a
    // secret that was deliberately removed.
    !iamAuth && !password && "password (DB_PASSWORD or DB_SECRET.password / raw DB_SECRET)",
  ].filter(Boolean);

  throw new Error(
    "DATABASE_URL is not set and could not be assembled from component env " +
      `vars. Present DB-related env var names: [${dbEnvNames.join(", ") || "none"}]. ` +
      `Unresolved: ${missing.join("; ")}.` +
      (iamAuth ? " (DB_IAM_AUTH is on: no password is required, but DB_HOST, DB_NAME and DB_USER all are.)" : ""),
  );
}
