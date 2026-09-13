import { randomBytes } from "crypto";
import type {
  WcVendorPlugin,
  WcVendorContext,
  GatewayConnectionTest,
} from "../types";
import { registerWcVendorPlugin } from "../registry";
import { WcVendorError } from "../errors";
import { logger } from "../../../logger";
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../../config/env-registry";

/**
 * The remote Teamsters 631 service, as a webclient vendor.
 *
 * Before this it was a module-level fetch function reading five global
 * environment variables, which meant the connection could only be changed by
 * redeploying, was invisible to an administrator, and could only ever be one
 * per site. As a vendor plugin the connection is an editable configuration row
 * like Stripe's, and the environment holds only the credential.
 *
 * Provider-only, like every plugin of this kind: the handlers below ask the
 * remote system and hand its answer back. Every database write that follows —
 * the worker, TOS, facility and job-group syncs — stays in
 * `server/modules/sitespecific/t631/client/`, outside this file.
 */

export const T631_PLUGIN_ID = "t631";
export const T631_COMPONENT = "sitespecific.t631.client";

/** Default name of the secret a seeded connection points at. */
export const T631_DEFAULT_SECRET_NAME = "SITESPECIFIC_T631_CLIENT_CREDENTIAL";

/**
 * The stable identifier the seeded connection is created with.
 *
 * It is what makes seeding safe when more than one process boots against this
 * database at once. T631 is deliberately not a singleton — several connections
 * are allowed — so nothing in the schema stops two boots that both saw no
 * connection from each creating one, and the result would be two enabled
 * connections and an ambiguous default that fails every scheduled sync. The
 * `sirius_id` unique constraint is the one thing here the database enforces, so
 * the seed claims it and the losing boot is told, by the database, that the row
 * it wanted already exists.
 *
 * Not the `auto.<component>.<local>` spelling: that scheme belongs to rows the
 * component lifecycle owns and reconciles, and this row is the operator's from
 * the moment it exists.
 */
const T631_SEED_SIRIUS_ID = "seed.sitespecific.t631.client";

/**
 * The environment variables a seeded connection is built from.
 *
 * They are declared here rather than beside the fetch function because seeding
 * is now the only thing that reads them: once the connection row exists, the
 * URL, account id and employer id are read from the row, and changing one is an
 * edit in the admin page rather than a redeploy. They keep
 * `changeTakesEffect: "immediate"` because the seeder reads them afresh on each
 * boot and keeps nothing between boots.
 *
 * The two token variables are no longer read anywhere. They stay declared so
 * that an environment which still carries them shows them (masked) on the
 * environment screen with a description saying they are spent, rather than
 * leaving an operator with two live-looking secrets and no way to learn they
 * are dead.
 */
registerEnvironmentVariables([
  {
    name: "SITESPECIFIC_T631_CLIENT_URL",
    description:
      "Base URL of the remote T631 service. Seed value only: once the T631 connection row exists, its URL is edited on the connection, not here.",
    secret: false,
    category: T631_COMPONENT,
    changeTakesEffect: "immediate",
  },
  {
    name: "SITESPECIFIC_T631_CLIENT_ACCOUNT_ID",
    description:
      "Account id for the remote T631 service. Seed value only: once the T631 connection row exists, its account id is edited on the connection, not here.",
    secret: false,
    category: T631_COMPONENT,
    changeTakesEffect: "immediate",
  },
  {
    name: "SITESPECIFIC_T631_CLIENT_EMPLOYER_ID",
    description:
      "Employer id for the remote T631 service. Seed value only: once the T631 connection row exists, its employer id is edited on the connection, not here.",
    secret: false,
    category: T631_COMPONENT,
    changeTakesEffect: "immediate",
  },
  {
    name: "SITESPECIFIC_T631_CLIENT_ACCESS_TOKEN",
    description:
      `No longer read. The T631 connection draws both of its tokens from the single JSON credential secret it names (by default ${T631_DEFAULT_SECRET_NAME}). Safe to delete once that secret is in place.`,
    secret: true,
    category: T631_COMPONENT,
    changeTakesEffect: "immediate",
  },
  {
    name: "SITESPECIFIC_T631_CLIENT_EMPLOYER_TOKEN",
    description:
      `No longer read. The T631 connection draws both of its tokens from the single JSON credential secret it names (by default ${T631_DEFAULT_SECRET_NAME}). Safe to delete once that secret is in place.`,
    secret: true,
    category: T631_COMPONENT,
    changeTakesEffect: "immediate",
  },
]);

// ---------------------------------------------------------------------------
// The operations this vendor declares
// ---------------------------------------------------------------------------

/**
 * The remote actions, added to the kind's operation vocabulary by declaration
 * merging (see `WcVendorOperations`). The operation name IS the remote action
 * name, and it is also the web client request type the registry registers, so
 * these calls keep the exact framework identity they had before this plugin
 * existed — the same names on the usage figures and in the diagnostics.
 */
declare module "../types" {
  interface WcVendorOperations {
    sirius_service_ping: { args: void; result: T631FetchResult };
    sirius_edls_server_worker_list: { args: void; result: T631FetchResult };
    sirius_dispatch_group_search: { args: void; result: T631FetchResult };
    sirius_dispatch_facility_dropdown: { args: void; result: T631FetchResult };
    sirius_edls_server_tos_list: { args: void; result: T631FetchResult };
  }
}

export const T631_ACTIONS = [
  "sirius_service_ping",
  "sirius_edls_server_worker_list",
  "sirius_dispatch_group_search",
  "sirius_dispatch_facility_dropdown",
  "sirius_edls_server_tos_list",
] as const;

export type T631Action = (typeof T631_ACTIONS)[number];

/** Plain words for each action, used in the framework's refusal wording. */
const ACTION_DESCRIPTIONS: Record<T631Action, string> = {
  sirius_service_ping: "ping the T631 service",
  sirius_edls_server_worker_list: "read the T631 worker list",
  sirius_dispatch_group_search: "read the T631 dispatch groups",
  sirius_dispatch_facility_dropdown: "read the T631 facility list",
  sirius_edls_server_tos_list: "read the T631 time-off-sick list",
};

export interface T631RequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown[];
}

export interface T631ResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/**
 * What one remote action produced, including enough of the request to diagnose
 * it. The admin diagnostics page renders this shape directly, so it is the
 * plugin's published result and not an internal detail.
 */
export interface T631FetchResult {
  success: boolean;
  action: string;
  request: T631RequestDiagnostics;
  response?: T631ResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  error?: string;
  timestamp: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Settings and credential
// ---------------------------------------------------------------------------

/** The connection is unusable as configured. Never carries a credential value. */
export class T631ConfigurationError extends WcVendorError {
  constructor(message: string) {
    super(503, message);
    this.name = "T631ConfigurationError";
  }
}

interface T631Settings {
  url: string;
  accountId: string;
  employerId: string;
}

interface T631Credential {
  accessToken: string;
  employerToken: string;
}

const CREDENTIAL_KEYS = ["accessToken", "employerToken"] as const;

/** See the check in {@link readCredential} for why there is a floor at all. */
const MIN_TOKEN_LENGTH = 8;

function configData(ctx: WcVendorContext): Record<string, unknown> {
  const data = ctx.config.data;
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function secretNameOf(ctx: WcVendorContext): string {
  const name = configData(ctx).secretName;
  return typeof name === "string" && name ? name : "(unnamed)";
}

function readSettings(ctx: WcVendorContext): T631Settings {
  const data = configData(ctx);
  const read = (key: keyof T631Settings): string =>
    typeof data[key] === "string" ? (data[key] as string).trim() : "";

  const settings = {
    url: read("url"),
    accountId: read("accountId"),
    employerId: read("employerId"),
  };
  const missing = (Object.keys(settings) as (keyof T631Settings)[]).filter(
    (key) => !settings[key],
  );
  if (missing.length > 0) {
    throw new T631ConfigurationError(
      `T631 connection '${ctx.config.name ?? ctx.config.id}' is missing: ${missing.join(", ")}.`,
    );
  }
  return settings;
}

/**
 * Decode the one secret this connection names into the two tokens T631 needs.
 *
 * The framework resolves exactly one secret per configuration, deliberately, so
 * the two tokens travel as one JSON object rather than as a second secret
 * field. The plugin owns that shape, which is why the decoding is here and not
 * in the generic resolver.
 *
 * Every failure message names the secret and what is wrong with it, and none of
 * them can carry any part of its value. `JSON.parse` in particular quotes the
 * offending input back in its own message ("Unexpected token … in JSON at
 * position 4"), which for a credential is a fragment of the credential heading
 * for a log line, so its message is discarded rather than wrapped.
 */
function readCredential(ctx: WcVendorContext): T631Credential {
  const secretName = secretNameOf(ctx);
  const shape = `a JSON object carrying ${CREDENTIAL_KEYS.join(" and ")}`;

  const raw = ctx.apiKey.trim();
  if (!raw) {
    throw new T631ConfigurationError(
      `T631 credential secret '${secretName}' is not set. Create it as ${shape}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new T631ConfigurationError(
      `T631 credential secret '${secretName}' is not valid JSON. It must be ${shape}.`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new T631ConfigurationError(
      `T631 credential secret '${secretName}' must be ${shape}.`,
    );
  }

  const record = parsed as Record<string, unknown>;
  const missing = CREDENTIAL_KEYS.filter((key) => {
    const value = record[key];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new T631ConfigurationError(
      `T631 credential secret '${secretName}' is missing: ${missing.join(", ")}. It must be ${shape}.`,
    );
  }

  // A token has to be long enough to be a token. The floor is not arithmetic
  // fussiness: redaction works by finding the value in what comes back, and a
  // two-character "token" would match half the reply and shred it, so the
  // choice would be between mangled diagnostics and an unredacted credential.
  // Nothing T631 issues is this short, and saying so is better than either.
  const tooShort = CREDENTIAL_KEYS.filter(
    (key) => (record[key] as string).trim().length < MIN_TOKEN_LENGTH,
  );
  if (tooShort.length > 0) {
    throw new T631ConfigurationError(
      `T631 credential secret '${secretName}' has an implausibly short value for: ${tooShort.join(", ")}. ` +
        `Each token must be at least ${MIN_TOKEN_LENGTH} characters.`,
    );
  }

  return {
    accessToken: (record.accessToken as string).trim(),
    employerToken: (record.employerToken as string).trim(),
  };
}

/**
 * Take the credential back out of anything on its way to a caller.
 *
 * Two routes lead there and both are easy to miss. The request diagnostics are
 * built here, so they simply never receive a token. The remote system's own
 * answer is not ours to shape: T631 replies to a malformed or rejected request
 * by echoing what it was sent, which puts the employer token in `rawBody` and
 * in the parsed `data` — and the admin page renders that, and the HTTP logger
 * previews it. So the reply is scrubbed as text before it is parsed, which
 * covers both copies at once.
 *
 * Whole values only, never a masked fragment. A first-four-and-last-four
 * rendering is still credential bytes in a log line, and the two ends are the
 * most useful part of a token to an attacker who has the rest from elsewhere.
 * There is nothing a fragment tells an operator that "(redacted)" does not.
 */
const REDACTED = "(redacted)";

interface CredentialScrubber {
  /** Replace every occurrence in one string. */
  text(value: string): string;
  /** The same, through a parsed structure: strings, keys, arrays, objects. */
  deep<T>(value: T): T;
}

function credentialScrubber(secrets: string[]): CredentialScrubber {
  // Each secret is hunted in both of the spellings it can arrive in: its own,
  // and the one JSON escaping gives it. A token containing a quote or a
  // backslash appears in the response TEXT with that character escaped, so the
  // plain spelling does not match there.
  //
  // The deep pass over the parsed value is not enough on its own to cover this.
  // A reply can echo the credential and still fail to parse — truncated by the
  // remote, or not JSON in the first place — and then it is the raw text that
  // is handed back and rendered, with nothing else having looked at it.
  const candidates = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    candidates.add(secret);
    candidates.add(JSON.stringify(secret).slice(1, -1));
  }

  // Longest first. Replacing a shorter secret that is a prefix of a longer one
  // first would leave the longer one's tail behind, un-redacted.
  const ordered = Array.from(candidates).sort((a, b) => b.length - a.length);

  const text = (value: string): string => {
    let out = value;
    for (const secret of ordered) out = out.split(secret).join(REDACTED);
    return out;
  };

  const deep = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[text(key)] = deep(nested);
      }
      return out;
    }
    return value;
  };

  return { text, deep: (value) => deep(value) as typeof value };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

async function performT631Fetch(
  ctx: WcVendorContext,
  action: T631Action,
): Promise<T631FetchResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const settings = readSettings(ctx);
  const credential = readCredential(ctx);

  const basicAuth = Buffer.from(
    `${settings.accountId}:${credential.accessToken}`,
  ).toString("base64");

  // Every string that must not leave this function. The base64 header is
  // included because it is the access token, merely re-spelt.
  const scrub = credentialScrubber([
    credential.accessToken,
    credential.employerToken,
    basicAuth,
  ]);

  let requestBody: unknown[];
  let diagnosticsBody: unknown[];

  if (action === "sirius_service_ping") {
    const echoText = randomBytes(6).toString("hex");
    requestBody = [action, "Echo Text Follows", echoText];
    diagnosticsBody = [action, "Echo Text Follows", echoText];
  } else if (action === "sirius_dispatch_group_search") {
    const ts = Math.floor(Date.now() / 1000);
    requestBody = [action, { domain_root: 1, limit: 500, ts }];
    diagnosticsBody = [action, { domain_root: 1, limit: 500, ts }];
  } else {
    requestBody = [action, settings.employerId, credential.employerToken];
    // The employer id is shown whole: it is a setting on the connection, edited
    // and displayed in the vendors admin page, not a credential.
    diagnosticsBody = [action, settings.employerId, REDACTED];
  }

  const requestDiagnostics: T631RequestDiagnostics = {
    url: settings.url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${REDACTED}`,
    },
    body: diagnosticsBody,
  };

  try {
    const response = await fetch(settings.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(requestBody),
    });

    const durationMs = Date.now() - startTime;

    // Headers are scrubbed too. A debugging proxy in front of T631 that mirrors
    // the request's Authorization back in its own response would otherwise walk
    // the credential straight into the diagnostics page and the HTTP log.
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[scrub.text(key)] = scrub.text(value);
    });

    const responseDiagnostics: T631ResponseDiagnostics = {
      status: response.status,
      statusText: scrub.text(response.statusText),
      headers: responseHeaders,
    };

    // Scrubbed as text first, which is what protects `rawBody` when the reply
    // is not JSON. T631 answers a rejected request by echoing it.
    const rawBody = scrub.text(await response.text().catch(() => ""));

    let parsedData: unknown = undefined;
    try {
      // Scrubbed AGAIN after parsing, and not redundantly: JSON escaping means
      // a token containing a quote or a backslash is spelt differently in the
      // text than in the value, so the literal pass above can miss it and
      // parsing then puts the real one back together.
      parsedData = scrub.deep(JSON.parse(rawBody));
    } catch {
      // not JSON
    }

    return {
      success: response.ok,
      action,
      request: requestDiagnostics,
      response: responseDiagnostics,
      data: parsedData,
      rawBody: parsedData === undefined ? rawBody : undefined,
      // From the scrubbed diagnostics, not from `response` again. This string
      // travels furthest of anything here — the admin page shows it, and the
      // cron callers put it in the message they throw and log — so reaching
      // back to the raw reason phrase would undo the scrubbing for the one
      // value most likely to be read.
      error: !response.ok
        ? `HTTP ${response.status} ${responseDiagnostics.statusText}`
        : undefined,
      timestamp,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      action,
      request: requestDiagnostics,
      // A transport error quotes the request it failed on, so it is scrubbed
      // for the same reason the body is.
      error: scrub.text(
        error instanceof Error ? error.message : "Unknown error",
      ),
      timestamp,
      durationMs,
    };
  }
}

/**
 * One declared operation per remote action.
 *
 * None of them needs a writable database: each is a read that records nothing
 * here, and the diagnostics page running a ping is exactly what an operator
 * reaches for while the site is read-only.
 */
function actionOperations(): WcVendorPlugin["operations"] {
  const operations: Record<string, unknown> = {};
  for (const action of T631_ACTIONS) {
    operations[action] = {
      operation: ACTION_DESCRIPTIONS[action],
      needsWritableDatabase: false,
      run: (ctx: WcVendorContext) => performT631Fetch(ctx, action),
    };
  }
  return operations as WcVendorPlugin["operations"];
}

// Not exported: the only supported handle on this plugin is the one the
// registry hands out, whose operations are already on the web client framework.
// An exported literal would be the same plugin with the refusal missing.
const t631WcVendorPlugin: WcVendorPlugin = {
  id: T631_PLUGIN_ID,
  name: "Teamsters 631",
  description:
    "The remote Teamsters 631 service. The connection holds the URL, account id and employer id; the secret it names holds both tokens as one JSON object.",
  requiredComponent: T631_COMPONENT,

  // The credential is checked by this plugin, not by the generic resolver, so
  // resolution is allowed to succeed with it absent. That is what lets the
  // connection test answer "the secret is not set" instead of the framework
  // refusing before the vendor is ever asked — and an operator looking at a
  // freshly seeded connection needs exactly that sentence.
  requiresSecret: false,

  configFields: [
    { name: "url", label: "Service URL", type: "string", required: true },
    { name: "accountId", label: "Account ID", type: "string", required: true },
    { name: "employerId", label: "Employer ID", type: "string", required: true },
  ],

  validateConfig(data: Record<string, unknown>) {
    const url = typeof data.url === "string" ? data.url.trim() : "";
    if (!url) return { valid: true }; // presence is the generic check's job
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { valid: false, errors: ["Service URL must be an http or https URL."] };
      }
    } catch {
      return { valid: false, errors: ["Service URL must be a valid absolute URL."] };
    }
    return { valid: true };
  },

  // T631 as the maintenance guard and the web client framework name it.
  // Declaring it is what puts every operation below on the framework.
  service: "T631",

  operations: {
    ...actionOperations(),

    "test-connection": {
      operation: "test the T631 connection",
      needsWritableDatabase: false,
      async run(ctx): Promise<GatewayConnectionTest> {
        try {
          const result = await performT631Fetch(ctx, "sirius_service_ping");
          if (result.success) {
            return {
              connected: true,
              account: {
                id: `${readSettings(ctx).accountId} @ ${hostOf(result.request.url)}`,
                capabilities: [
                  { label: `Ping answered in ${result.durationMs}ms`, enabled: true },
                ],
              },
            };
          }
          return {
            connected: false,
            error: {
              message: result.error ?? "The T631 service did not answer the ping.",
              code: result.response ? String(result.response.status) : undefined,
            },
          };
        } catch (error) {
          // A misconfigured connection is the answer this test exists to give,
          // so it is reported rather than thrown. A maintenance refusal is not
          // ours to report and is left to propagate, exactly as it was before.
          if (error instanceof T631ConfigurationError) {
            return { connected: false, error: { message: error.message } };
          }
          throw error;
        }
      },
    },
  },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(invalid URL)";
  }
}

registerWcVendorPlugin(t631WcVendorPlugin);

// ---------------------------------------------------------------------------
// Boot-time seeding
// ---------------------------------------------------------------------------

/**
 * Create the T631 connection on the first boot after this plugin ships.
 *
 * Boot-time rather than a SQL migration because the decision depends on
 * component state, which the SQL layer cannot see: a site with the T631 client
 * switched off must not acquire a connection it never asked for. This mirrors
 * the other boot-time plugin-config backfills.
 *
 * It cannot produce a working connection on its own, and does not pretend to.
 * There is no existing variable holding the combined JSON credential, so the
 * seeded row names a secret that does not exist yet and every T631 call fails —
 * loudly, naming that secret — until an operator creates it. That is the
 * intended upgrade path, not an oversight.
 *
 * Safe on every boot: it creates nothing while a T631 connection exists, so
 * whatever an operator makes of the seeded row — editing its settings, pointing
 * it at a different secret, disabling it — survives every restart untouched.
 * Deleting the last one while the component is still on does bring a fresh seed
 * back on the next boot, deliberately: the component cannot work without a
 * connection, and a row that says which secret is missing is a better place to
 * land than no row and no explanation. Turning the component off is how you
 * mean it. It never writes a token value into the row; the row holds the
 * secret's NAME.
 *
 * Storage is imported lazily, matching the other seeders in this kind: this
 * module is reached through the plugins barrel, which sits inside the storage
 * boot chain, and a top-level storage import would close that cycle.
 */
export async function seedT631VendorConfig(): Promise<void> {
  const { isComponentEnabled } = await import("../../../modules/components");
  if (!(await isComponentEnabled(T631_COMPONENT))) return;

  const { storage } = await import("../../../storage");
  const existing = await storage.pluginConfigs.getByKindAndPlugin(
    "wc-vendors",
    T631_PLUGIN_ID,
  );
  if (existing.length > 0) return;

  const { runInTransaction } = await import("../../../storage/transaction-context");
  const { withFrameworkWrite } = await import(
    "../../../middleware/request-context"
  );

  const data = {
    secretName: T631_DEFAULT_SECRET_NAME,
    url: getEnvironmentVariable("SITESPECIFIC_T631_CLIENT_URL") ?? "",
    accountId: getEnvironmentVariable("SITESPECIFIC_T631_CLIENT_ACCOUNT_ID") ?? "",
    employerId: getEnvironmentVariable("SITESPECIFIC_T631_CLIENT_EMPLOYER_ID") ?? "",
  };

  try {
    // Seeding a connection the component needs is the framework's own doing,
    // not an administrator's: provenance with no person, and no audit entry, so
    // a restart does not read as somebody having created it.
    await withFrameworkWrite(() =>
      runInTransaction(async () => {
        const row = await storage.pluginConfigs.create({
          pluginKind: "wc-vendors",
          pluginId: T631_PLUGIN_ID,
          enabled: true,
          name: "Teamsters 631",
          siriusId: T631_SEED_SIRIUS_ID,
          data,
        } as Parameters<typeof storage.pluginConfigs.create>[0]);
        // The generic search inner-joins the subsidiary table, so a row without
        // one would be invisible in the vendors admin page.
        await storage.pluginConfigs.upsertSubsidiary("wc-vendors", { id: row.id });
      }),
    );
    logger.info("Seeded the T631 connection from the environment", {
      service: "wc-vendor-plugins",
      secretName: T631_DEFAULT_SECRET_NAME,
    });
  } catch (error) {
    if (isSeedIdentityTaken(error)) {
      // The identity is taken, but by what? A concurrent boot's seed and an
      // operator who happened to type this sirius_id onto an unrelated row
      // raise the identical violation, so the error cannot tell them apart and
      // the row has to be looked at. Reading it as "already seeded" either way
      // would swallow a genuine collision and leave the component with no
      // connection and nothing said about it.
      const winner = await storage.pluginConfigs.findBySiriusId(
        T631_SEED_SIRIUS_ID,
      );
      if (
        winner &&
        winner.pluginKind === "wc-vendors" &&
        winner.pluginId === T631_PLUGIN_ID
      ) {
        logger.info("The T631 connection was seeded by another process", {
          service: "wc-vendor-plugins",
        });
        return;
      }
      logger.error(
        "Could not seed the T631 connection: its identifier is in use by another record",
        {
          service: "wc-vendor-plugins",
          siriusId: T631_SEED_SIRIUS_ID,
          conflictingPluginKind: winner?.pluginKind,
          conflictingPluginId: winner?.pluginId,
        },
      );
      return;
    }
    logger.error("Failed to seed the T631 connection", {
      service: "wc-vendor-plugins",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Did this insert fail because the seed's identifier was already claimed?
 *
 * Matched on the constraint by name rather than on "some unique violation", so
 * that a future unique constraint on this table cannot quietly start being read
 * as a lost seeding race.
 */
function isSeedIdentityTaken(error: unknown): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown } | null;
  return (
    !!candidate &&
    candidate.code === "23505" &&
    candidate.constraint === "plugin_configs_sirius_id_unique"
  );
}
