/**
 * Central environment-variable registry (Task #1053).
 *
 * Every environment variable the application reads MUST be declared here (or
 * registered by the owning module at load time) with a description, a secret
 * flag, and a category. All reads go through {@link getEnvironmentVariable},
 * which fails loudly on unregistered names. This makes the environment
 * contract explicit, provides the data source for the future system-status
 * plugin, and supports on-the-fly value filtering via per-variable transform
 * hooks and overrides.
 *
 * Design constraints:
 *  - PURE LEAF MODULE: no imports (not even the logger). It must be usable by
 *    the earliest boot code — DATABASE_URL assembly and the production entry
 *    point — before any app initialization.
 *  - Direct `process.env` access is allowed ONLY inside this module. The
 *    author-time check `scripts/dev/check-env-registry.ts` enforces this
 *    across server/, shared/, and scripts/.
 *
 * Categories:
 *  - "core":     application-level configuration (DATABASE_URL, AUTH_*, ...)
 *  - "platform": injected by the hosting platform (REPLIT_*, REPL_*, ...)
 *  - any component id (e.g. "sitespecific.t631.client"): variables owned by a
 *    component, registered by that component's module at load time.
 */

export type EnvironmentVariableCategory = "core" | "platform" | (string & {});

/**
 * Last-resort public base URL used in local development when neither an
 * explicit PUBLIC_URL nor any Replit platform domain is available. Consumers
 * that must NOT hand a localhost URL to an external service (e.g. Twilio
 * status callbacks) compare against this constant.
 */
export const PUBLIC_URL_LOCAL_FALLBACK = "https://localhost:5000";

/**
 * Resolver for PUBLIC_URL — the ONLY place in the codebase that knows about
 * the Replit platform domain variables. Order: explicit PUBLIC_URL value →
 * REPLIT_DEV_DOMAIN → REPLIT_DEPLOYMENT_DOMAIN → first of REPLIT_DOMAINS →
 * localhost last resort. Result is normalized to an absolute https origin
 * with no trailing slash.
 */
function resolvePublicUrl(value: string | undefined): string {
  const explicit = value?.trim();
  if (explicit) return canonicalHttpsOrigin(explicit, "PUBLIC_URL");
  const domain = (
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DEPLOYMENT_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    ""
  ).trim();
  if (domain) return canonicalHttpsOrigin(domain, "platform domain");
  return PUBLIC_URL_LOCAL_FALLBACK;
}

/**
 * Canonicalize to an https origin only: scheme added when missing, any
 * path/query/fragment dropped, http upgraded to https (except localhost,
 * where a local dev server may genuinely be http). Throws loudly on values
 * that cannot be parsed as a URL — a silently wrong public origin breaks
 * SAML validation and outbound links in ways that are hard to trace.
 */
function canonicalHttpsOrigin(raw: string, sourceLabel: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(
      `Invalid public base URL from ${sourceLabel}: "${raw}" cannot be parsed as a URL.`,
    );
  }
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    url.protocol = "https:";
  }
  return url.origin;
}

/**
 * When a change to a variable's effective value is picked up by the RUNNING
 * application (Task #1256). Documentation only — nothing in the app reads
 * this to decide behaviour; it is advisory guidance for whoever edits the
 * value on the Environment Variables page.
 *
 *  - "immediate": every consumer re-reads through {@link getEnvironmentVariable}
 *    at the point of use, so a new value applies to the next use.
 *  - "restart":   the running app captured the value at startup (module-level
 *    constant, boot-time initialization, or a memoized config), so the change
 *    only applies after the app is restarted.
 *  - "reload":    the running app captured the value at startup, but a
 *    reloadable subsystem can re-read it in place, so an operator can apply
 *    the change from the Restart & Reload page without downtime (Task #1258).
 *    A variable may only carry this when a reloadable subsystem actually
 *    names it — `server/services/reload-registry.ts` asserts that at boot, so
 *    the two surfaces cannot drift apart.
 *
 * Leaving it undeclared is a valid third state, meaning "not stated". Callers
 * must NOT treat undeclared as "immediate": the page shows nothing rather
 * than making a claim nobody made deliberately.
 *
 * The same rule applies to variables a component or service registers from
 * its own module, classified from how that component consumes the value. Two
 * cautions for those:
 *  - Registration is last-one-wins (see {@link registerEnvironmentVariable}),
 *    so when several modules register the same name, every copy must carry
 *    the SAME classification — otherwise what the page states depends on
 *    module load order.
 *  - When a variable has both a re-reading consumer and a memoizing one, the
 *    honest answer is "restart": a change is not in effect everywhere until
 *    the process starts again.
 */
export type EnvironmentVariableChangeEffect = "immediate" | "restart" | "reload";

export interface EnvironmentVariableDeclaration {
  /** Exact environment variable name, e.g. "DATABASE_URL". */
  name: string;
  /** Human-readable purpose, shown by future status/registry consumers. */
  description: string;
  /** True when the VALUE must never be displayed (keys, tokens, passwords). */
  secret: boolean;
  /** "core", "platform", or the owning component id. */
  category: EnvironmentVariableCategory;
  /** Optional: throw from the getter when the value is unset/empty. */
  required?: boolean;
  /**
   * Optional: when a change to this variable is picked up by the running app.
   * Advisory documentation only — see {@link EnvironmentVariableChangeEffect}.
   * Omit when the answer is genuinely ambiguous; omitted means "not stated".
   */
  changeTakesEffect?: EnvironmentVariableChangeEffect;
  /**
   * Optional per-variable transform hook applied to the raw value on every
   * read (in-application filtering, normalization, defaulting).
   */
  transform?: (value: string | undefined) => string | undefined;
}

const registry = new Map<string, EnvironmentVariableDeclaration>();
const overrides = new Map<string, (value: string | undefined) => string | undefined>();

/**
 * DB-backed override source (Task #1080). Installed at boot (after the
 * database is up) by `server/services/env-overrides.ts`; consulted ONLY when
 * the variable is absent from the real process environment, so a value set
 * in the deployment pipeline always "locks" the variable. Must be a
 * synchronous lookup (in-memory cache) — this module stays a pure leaf.
 */
let dbOverrideSource: ((name: string) => string | undefined) | null = null;

export function setEnvironmentVariableOverrideSource(
  fn: ((name: string) => string | undefined) | null,
): void {
  dbOverrideSource = fn;
}

/**
 * Variables that can never be safely overridden from the database:
 * anything needed to *reach* the database (chicken-and-egg: the override
 * store lives in the DB), the session-signing secret (allowing an app-admin
 * to rotate it would be a privilege escalation), and boot/diagnostic escape
 * hatches that must travel through the deployment pipeline only.
 *
 * OWNER DECISION (2026-08-16): The original denylist also included
 * authentication-provider config (SAML_*, OKTA_*, AUTH_*, OAUTH_*, CLERK_*,
 * etc.) via ENV_OVERRIDE_DENY_PREFIXES. Those prefix rules have been removed
 * so that SAML/Okta/OAuth variables can be set in-app without a redeploy.
 * The security tradeoff is explicitly accepted: an app-admin can now update
 * IdP URLs and callback paths through the UI. The truly destructive items
 * (DB credentials, session key, boot escape hatches) remain in the denylist
 * below. Re-enable selective prefix rules here if a narrower trust boundary
 * is later required.
 */
// OWNER DECISION (2026-08-16): NO denylist. Every registered variable is
// overridable from the variables table when it is not set in the real
// environment (set = present, non-empty, and not __UNSET__). The owner has
// explicitly and repeatedly directed that no variable be privileged: the
// ONLY lock is a real environment value winning over the stored override.
// The original denylist is kept below, commented, for historical reference.
// const ENV_OVERRIDE_DENYLIST = new Set<string>([
//   "NODE_ENV",
//   "PORT",
//   "DATABASE_URL",
//   "DATABASE_DRIVER",
//   "DB_HOST",
//   "DB_PORT",
//   "DB_NAME",
//   "DB_USER",
//   "DB_USERNAME",
//   "DB_PASSWORD",
//   "DB_SECRET",
//   "DB_SSLMODE",
//   "SESSION_SECRET",
//   "ALLOW_INSECURE_SESSION_SECRET",
//   // Boot/debug escape hatches: deployment-pipeline decisions only.
//   "ALLOW_EMPTY_DB_BOOTSTRAP",
//   "ALLOW_DB_PUSH",
//   "SKIP_SCHEMA_DRIFT_CHECK",
//   "SKIP_DIST_FRESHNESS_CHECK",
//   "EXPOSE_BOOT_ERRORS",
// ]);

/**
 * Authentication bootstrap configuration was previously blocked here to
 * prevent an app-admin from redirecting IdP traffic via a DB write.
 *
 * OWNER DECISION (2026-08-16): Removed. SAML_*, AUTH_*, OKTA_*, OAUTH_*,
 * CLERK_*, SESSION_TTL, and DB_* *configuration* variables (not DB credentials
 * — formerly in ENV_OVERRIDE_DENYLIST above) are now overridable in-app.
 * Re-add prefix entries below to restore narrower restrictions if needed.
 */
// const ENV_OVERRIDE_DENY_PREFIXES = [
//   "AUTH_",
//   "LOCAL_AUTH_",
//   "OKTA_",
//   "SAML_",
//   "OAUTH_",
//   "CLERK_",
//   "VITE_CLERK_",
//   "SESSION_",
//   "DB_",
// ];

/**
 * Whether a registered variable may be overridden from the database.
 *
 * OWNER DECISION (2026-08-16): every registered variable is overridable.
 * The only runtime lock is a real environment value (non-empty, not
 * __UNSET__) winning over the stored override — enforced by the
 * precedence rules in getEnvironmentVariable, not here.
 */
export function isEnvironmentVariableOverridable(name: string): boolean {
  return registry.has(name);
  // Original restrictions (removed per owner decision, see above):
  // const decl = registry.get(name);
  // if (!decl) return false;
  // if (decl.category === "platform") return false;
  // if (ENV_OVERRIDE_DENYLIST.has(name)) return false;
  // return !ENV_OVERRIDE_DENY_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Release sentinel (Task #1085). Deployed containers can carry stale env
 * vars forever (ECS bakes env into the task definition revision), and some
 * pipelines (GitHub) refuse empty-string variables. Setting a variable to
 * this exact value — or to the empty string, where the pipeline allows it —
 * declares "this variable is no longer set": the app treats it as absent
 * everywhere (reads as unset; DB override applies where the rules allow).
 * The consent to release travels through the deploy pipeline itself.
 */
export const ENV_RELEASE_SENTINEL = "__UNSET__";

function isReleasedValue(value: string | undefined): boolean {
  return value === "" || value === ENV_RELEASE_SENTINEL;
}

/**
 * The process-env value with release semantics applied: a released value
 * (empty string or the sentinel) reads as undefined. THE single presence
 * rule — the getter, the lock check, and the listing all use it.
 */
function readProcessEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || isReleasedValue(value) ? undefined : value;
}

/**
 * True when the variable is effectively set in the real process env (a
 * released value — empty or the sentinel — counts as NOT set).
 */
export function isEnvironmentVariableSetInProcess(name: string): boolean {
  return readProcessEnv(name) !== undefined;
}

/**
 * True when the variable is present in the process env but carries a
 * released value (deliberately neutralized in the deployment settings).
 */
export function isEnvironmentVariableReleased(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && isReleasedValue(value);
}

/**
 * Declare an environment variable. Idempotent: re-registering the same name
 * replaces the declaration (last one wins), so modules that share a variable
 * can each register it at load time without ordering hazards.
 */
export function registerEnvironmentVariable(decl: EnvironmentVariableDeclaration): void {
  if (!decl.name || typeof decl.name !== "string") {
    throw new Error("registerEnvironmentVariable: declaration requires a non-empty name");
  }
  registry.set(decl.name, { ...decl });
}

/** Bulk form of {@link registerEnvironmentVariable}. */
export function registerEnvironmentVariables(
  decls: readonly EnvironmentVariableDeclaration[],
): void {
  for (const decl of decls) registerEnvironmentVariable(decl);
}

/**
 * Whether a registered variable is declared secret. Unregistered names
 * return true (redact defensively — an unknown ENV_* override row may
 * hold anything).
 */
export function isEnvironmentVariableSecret(name: string): boolean {
  const decl = registry.get(name);
  return decl ? decl.secret : true;
}

export function isEnvironmentVariableRegistered(name: string): boolean {
  return registry.has(name);
}

/**
 * Read an environment variable's value. THE single sanctioned read path.
 *
 * Throws when the variable was never registered — using an undeclared
 * variable is a programming error and must fail loudly, not silently return
 * undefined. Applies the declaration's transform hook and any runtime
 * override, then enforces `required`.
 */
export function getEnvironmentVariable(name: string): string | undefined {
  const decl = registry.get(name);
  if (!decl) {
    throw new Error(
      `Environment variable "${name}" is not registered. Declare it with ` +
        `registerEnvironmentVariable() (see server/config/env-registry.ts) before reading it.`,
    );
  }
  let value: string | undefined = readProcessEnv(name);
  if (value === undefined && dbOverrideSource && isEnvironmentVariableOverridable(name)) {
    value = dbOverrideSource(name);
  }
  if (decl.transform) value = decl.transform(value);
  const override = overrides.get(name);
  if (override) value = override(value);
  if (decl.required && (value === undefined || value === "")) {
    throw new Error(
      `Environment variable "${name}" is required but not set (${decl.description}).`,
    );
  }
  return value;
}

/**
 * Read a variable that is a claim the PLATFORM makes about the running
 * process — an orchestrator marker such as a task-metadata endpoint address.
 * Identical to {@link getEnvironmentVariable} except that the database
 * override map is never consulted.
 *
 * WHY A SECOND READ PATH. Every registered variable is overridable in-app by
 * design, and that stays true: this is not a denylist and it does not block
 * anyone from setting a value. It is about what the value MEANS. An ordinary
 * variable is configuration — the operator is entitled to choose it. A
 * platform marker is evidence: code reads it to conclude "an orchestrator put
 * this here, therefore I am running under that orchestrator", and then acts
 * on the conclusion — deciding where to send a request, or telling an
 * operator their app is supervised. A value an application user can write is
 * not evidence about the environment, so honouring an override here would let
 * an in-app setting forge a fact about the host and steer server-side
 * behaviour (a request address being the sharp end of it).
 *
 * Use this ONLY for variables injected by the platform itself. Anything the
 * deployer is meant to choose belongs on {@link getEnvironmentVariable}.
 */
export function getPlatformEnvironmentVariable(name: string): string | undefined {
  const decl = registry.get(name);
  if (!decl) {
    throw new Error(
      `Environment variable "${name}" is not registered. Declare it with ` +
        `registerEnvironmentVariable() (see server/config/env-registry.ts) before reading it.`,
    );
  }
  let value: string | undefined = readProcessEnv(name);
  if (decl.transform) value = decl.transform(value);
  const override = overrides.get(name);
  if (override) value = override(value);
  return value;
}

/**
 * Install (fn) or remove (null) a runtime override applied after the
 * declaration transform on every read of `name`. For in-application
 * filtering/overriding without touching the process environment.
 */
export function setEnvironmentVariableOverride(
  name: string,
  fn: ((value: string | undefined) => string | undefined) | null,
): void {
  if (!registry.has(name)) {
    throw new Error(
      `Cannot set override for unregistered environment variable "${name}".`,
    );
  }
  if (fn === null) overrides.delete(name);
  else overrides.set(name, fn);
}

/**
 * Write an environment variable value into the process environment. Only for
 * registry-sanctioned boot-time writes (e.g. DATABASE_URL assembly from
 * DB_* parts). The name must be registered.
 */
export function setEnvironmentVariable(name: string, value: string): void {
  if (!registry.has(name)) {
    throw new Error(
      `Cannot set unregistered environment variable "${name}". Register it first.`,
    );
  }
  process.env[name] = value;
}

export interface EnvironmentVariableInfo {
  name: string;
  description: string;
  secret: boolean;
  category: EnvironmentVariableCategory;
  required: boolean;
  /** Whether the variable currently has a non-empty value. Never the value. */
  isSet: boolean;
  /** Where the current value comes from (null when unset). */
  source: "environment" | "override" | null;
  /** Whether a DB override is allowed for this variable. */
  overridable: boolean;
  /** Present in the process env but deliberately released (empty/sentinel). */
  released: boolean;
  /**
   * When a change is picked up by the running app, or null when the
   * declaration does not state it. Advisory documentation only — null must
   * never be presented as "immediate".
   */
  changeTakesEffect: EnvironmentVariableChangeEffect | null;
}

/**
 * Enumerate all registered variables with metadata and presence (never
 * values). Data source for the future system-status plugin.
 */
export function listEnvironmentVariables(): EnvironmentVariableInfo[] {
  return Array.from(registry.values())
    .map((d) => {
      // Presence must match the getter's fallback rule exactly: released
      // values (empty/sentinel) read as absent everywhere.
      const envSet = readProcessEnv(d.name) !== undefined;
      const overridable = isEnvironmentVariableOverridable(d.name);
      const overrideValue =
        !envSet && overridable && dbOverrideSource ? dbOverrideSource(d.name) : undefined;
      const source: EnvironmentVariableInfo["source"] = envSet
        ? "environment"
        : overrideValue !== undefined
          ? "override"
          : null;
      return {
        name: d.name,
        description: d.description,
        secret: d.secret,
        category: d.category,
        required: d.required === true,
        isSet: source !== null,
        source,
        overridable,
        released: isEnvironmentVariableReleased(d.name),
        changeTakesEffect: d.changeTakesEffect ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Names of environment variables currently PRESENT in the process
 * environment that match `predicate` (registered or not). For diagnostics
 * that report which vars exist without exposing values (e.g. DATABASE_URL
 * assembly failure messages).
 */
export function listPresentEnvironmentVariableNames(
  predicate: (name: string) => boolean,
): string[] {
  return Object.keys(process.env).filter(predicate).sort();
}

/**
 * The raw process environment object. SANCTIONED USES ONLY: passing an
 * environment to a spawned child process, or handing the environment to an
 * injection surface that filters it itself. NEVER for reading individual
 * variables — use {@link getEnvironmentVariable}.
 */
export function getRawProcessEnv(): NodeJS.ProcessEnv {
  return process.env;
}

// ---------------------------------------------------------------------------
// Core variables — application-level configuration, registered at module load
// so they are available to the earliest boot code.
//
// `changeTakesEffect` is advisory documentation (Task #1256), classified from
// how each value is actually consumed:
//   - "restart"   the running app captures the value at startup — a
//                 module-level constant, boot-time initialization, or a
//                 memoized config (e.g. the auth config snapshot).
//   - "immediate" every consumer re-reads it through getEnvironmentVariable
//                 at the point of use.
//   - "reload"    captured at startup, but a registered reloadable subsystem
//                 (server/services/reload-registry.ts) can re-read it in
//                 place from the admin Restart & Reload page.
//   - omitted     genuinely ambiguous, or the running app never reads it
//                 (a separate CLI process, or a cache that is filled once and
//                 not refreshed). Omitted means "not stated", NOT "immediate".
// ---------------------------------------------------------------------------
registerEnvironmentVariables([
  { name: "NODE_ENV", description: "Runtime mode: development | production.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "PORT", description: "HTTP port the server listens on (default 5000).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DATABASE_URL", description: "PostgreSQL connection URL. Assembled from DB_* parts at boot when absent.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "EXTERNAL_DATABASE_URL", description: "External PostgreSQL connection URL; wins over DATABASE_URL everywhere (split-brain guard, see shared/database-url.ts).", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "DATABASE_DRIVER", description: "Force the DB driver: neon | pg (auto-detected from the URL otherwise).", secret: false, category: "core", changeTakesEffect: "restart", },
  // DATABASE_URL assembly parts (ECS/Terraform task definition injects parts,
  // not a full URL — see server/config/assemble-database-url.ts).
  { name: "DB_HOST", description: "Database host (URL assembly part).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DB_PORT", description: "Database port (URL assembly part).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DB_NAME", description: "Database name (URL assembly part).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DB_USER", description: "Database username (URL assembly part).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DB_USERNAME", description: "Database username, alternate spelling (URL assembly part).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "DB_PASSWORD", description: "Database password (URL assembly part).", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "DB_SECRET", description: "AWS Secrets Manager DB secret: JSON blob or raw password (URL assembly part).", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "DB_SSLMODE", description: "sslmode for the assembled DATABASE_URL (default require).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "SESSION_SECRET", description: "Express session signing secret.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "SESSION_TTL", description: "Session time-to-live in milliseconds.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "ALLOW_INSECURE_SESSION_SECRET", description: "Set to 1 to permit the fixed insecure session-secret fallback in non-prod deploys.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "ALLOW_EMPTY_DB_BOOTSTRAP", description: "Set to 1 to let boot create the full schema on a completely empty database.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "ALLOW_DB_PUSH", description: "Set to 1 to permit scripts/db-push.ts to run (guarded: push is hazardous).", secret: false, category: "core" },
  { name: "SKIP_SCHEMA_DRIFT_CHECK", description: "Set to 1 to skip the startup schema-drift boot gate (dev escape hatch).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "SKIP_DIST_FRESHNESS_CHECK", description: "Set to 1 to skip the stale-dist build freshness guard in production entry.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "EXPOSE_BOOT_ERRORS", description: "Set to 1 to render init-failure details (message + stack) on the boot failure page.", secret: false, category: "core", changeTakesEffect: "restart", },
  // "reload": the filesystem registry re-parses this and drops its cached
  // providers when the "Filesystem registry" subsystem is reloaded from the
  // admin Restart & Reload page (Task #1258) — no restart needed.
  { name: "FILESYSTEMS", description: "JSON map of filesystem configs (see server/services/files/config.ts). *_secret settings name further env vars.", secret: false, category: "core", changeTakesEffect: "reload", },
  {
    name: "PUBLIC_URL",
    description:
      "Public base URL (absolute https origin) of this deployment. Explicit value wins; " +
      "otherwise derived from the Replit platform domains, with a localhost last resort " +
      "for local development. All base-URL consumers read this ONE variable.",
    secret: false,
    category: "core",
    changeTakesEffect: "immediate",
    transform: resolvePublicUrl,
  },
  // Auth (multi-provider) configuration.
  { name: "AUTH_PROVIDER", description: "Comma-separated list of enabled auth providers (replit,okta,saml,oauth,local,clerk).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "AUTH_DEFAULT_PROVIDER", description: "Which configured auth provider is the default.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "AUTH_LOCAL_ENABLED", description: "Set to false to disable the local auth provider without editing AUTH_PROVIDER.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "AUTH_LOCAL_PEPPER", description: "Pepper concatenated to passwords before hashing for local auth.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "LOCAL_AUTH_EMAIL", description: "Email of the local-auth credential to seed at boot.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "LOCAL_AUTH_PASSWORD_HASH", description: "Password hash of the local-auth credential to seed at boot.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "ISSUER_URL", description: "OIDC issuer URL for the Replit auth provider (legacy name).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "REPLIT_ISSUER_URL", description: "OIDC issuer URL for the Replit auth provider.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "REPLIT_CLIENT_ID", description: "OIDC client id for the Replit auth provider.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OKTA_ISSUER_URL", description: "Okta OIDC issuer URL.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OKTA_CLIENT_ID", description: "Okta OIDC client id.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OKTA_CLIENT_SECRET", description: "Okta OIDC client secret.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "OKTA_CALLBACK_PATH", description: "Override for the Okta OIDC callback path.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "SAML_ENTRY_POINT", description: "SAML IdP entry point URL.", secret: false, category: "core", changeTakesEffect: "immediate", },
  { name: "SAML_ISSUER", description: "SAML issuer (SP entity id).", secret: false, category: "core", changeTakesEffect: "immediate", },
  { name: "SAML_CERT", description: "SAML IdP signing certificate (PEM).", secret: true, category: "core", changeTakesEffect: "immediate", },
  { name: "SAML_CALLBACK_PATH", description: "Override for the SAML callback path. Must be a local path starting with a slash, such as /api/auth/saml/callback, and never a fully-qualified URL with a domain name. The default is almost always correct; leave this unset unless you have a specific reason.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_AUTHORIZATION_URL", description: "Generic OAuth2 authorization endpoint.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_TOKEN_URL", description: "Generic OAuth2 token endpoint.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_USERINFO_URL", description: "Generic OAuth2 userinfo endpoint.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_CLIENT_ID", description: "Generic OAuth2 client id.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_CLIENT_SECRET", description: "Generic OAuth2 client secret.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_SCOPE", description: "Generic OAuth2 scope string.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "OAUTH_CALLBACK_PATH", description: "Override for the generic OAuth2 callback path.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "CLERK_PUBLISHABLE_KEY", description: "Clerk publishable key (dev/default).", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "CLERK_PUBLISHABLE_KEY_PROD", description: "Clerk publishable key used when NODE_ENV=production.", secret: false, category: "core", changeTakesEffect: "restart", },
  { name: "CLERK_SECRET_KEY", description: "Clerk secret key (dev/default).", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "CLERK_SECRET_KEY_PROD", description: "Clerk secret key used when NODE_ENV=production.", secret: true, category: "core", changeTakesEffect: "restart", },
  { name: "VITE_CLERK_PUBLISHABLE_KEY", description: "Clerk publishable key as exposed to the Vite client bundle (server fallback read).", secret: false, category: "core", changeTakesEffect: "restart", },
]);

// ---------------------------------------------------------------------------
// Platform variables — injected by the hosting environment (Replit / deploys).
// ---------------------------------------------------------------------------
registerEnvironmentVariables([
  { name: "REPL_ID", description: "Replit workspace id; doubles as the Replit OIDC client id.", secret: false, category: "platform", changeTakesEffect: "restart", },
  { name: "REPL_IDENTITY", description: "Replit workspace identity token (connector auth).", secret: true, category: "platform" },
  { name: "WEB_REPL_RENEWAL", description: "Replit deployment identity token (connector auth).", secret: true, category: "platform" },
  { name: "REPLIT_CONNECTORS_HOSTNAME", description: "Hostname of the Replit connectors API.", secret: false, category: "platform" },
  { name: "REPLIT_DEPLOYMENT", description: "Set to 1 inside a Replit deployment container.", secret: false, category: "platform", changeTakesEffect: "restart", },
  // Container-platform markers injected by the orchestrator, read by the
  // container facts service (server/services/container-facts.ts) on every
  // scan — hence "immediate". They are set by the platform, not by a
  // deployer, and are listed here so the facts service can read them
  // through the registry getter like every other variable (Task #1258).
  { name: "ECS_CONTAINER_METADATA_URI_V4", description: "Amazon ECS task metadata endpoint (v4), injected into every ECS task.", secret: false, category: "platform", changeTakesEffect: "immediate", },
  { name: "ECS_CONTAINER_METADATA_URI", description: "Amazon ECS task metadata endpoint (v3), the older spelling of the above.", secret: false, category: "platform", changeTakesEffect: "immediate", },
  { name: "AWS_EXECUTION_ENV", description: "Name of the AWS runtime executing this process, e.g. AWS_ECS_FARGATE.", secret: false, category: "platform", changeTakesEffect: "immediate", },
  { name: "KUBERNETES_SERVICE_HOST", description: "Kubernetes API service address, injected into every pod by the kubelet.", secret: false, category: "platform", changeTakesEffect: "immediate", },
  { name: "DEFAULT_OBJECT_STORAGE_BUCKET_ID", description: "Replit object storage default bucket id.", secret: false, category: "platform", changeTakesEffect: "restart", },
  { name: "PUBLIC_OBJECT_SEARCH_PATHS", description: "Comma-separated public search paths in object storage.", secret: false, category: "platform", changeTakesEffect: "restart", },
  { name: "PRIVATE_OBJECT_DIR", description: "Private directory prefix in object storage.", secret: false, category: "platform", changeTakesEffect: "restart", },
]);
