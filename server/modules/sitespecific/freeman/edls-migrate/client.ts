/**
 * Client for the legacy Freeman EDLS system.
 *
 * EDLS data for Freeman lives in a legacy system on a different platform, and
 * it will be brought across in stages. This module is the connection itself:
 * it composes a call to that system's generic web service and reports, in
 * detail, what happened. Nothing here reads or writes migration data yet.
 *
 * The legacy service's answering conventions, established by probing it, and
 * the reasons this module is shaped the way it is:
 *
 *  - Authentication is HTTP Basic: the account id as the user, the access code
 *    as the password. Both are per-installation, and there is more than one
 *    host (a development one and a live one), so all three are environment
 *    variables rather than constants.
 *
 *  - The request body is a JSON array whose first element is the action and
 *    whose remaining elements are that action's arguments. A request is
 *    therefore modelled as `{ action, args }` data — the next stage swaps the
 *    action for a data-fetching one and varies the arguments, so the ping is
 *    ONE request this module can build, not the only thing it can send.
 *
 *  - A refusal is an HTTP 401 whose body is a bare JSON array of message
 *    strings, and those strings distinguish the causes ("No account id.",
 *    "No node found with that account ID.", "Invalid access token."). That
 *    text is the most useful thing an administrator can see, so it is carried
 *    through verbatim instead of being flattened into "failed".
 *
 *  - A successful call is an HTTP 200 carrying an envelope with its OWN
 *    success flag. HTTP 200 therefore does not mean the call worked: overall
 *    success is the envelope's flag, and a body that cannot be parsed or
 *    recognised is a failure rather than an assumed success.
 *
 * The access code never appears in a result: the Authorization header is
 * reported fully masked, and the account id (declared non-secret) is reported
 * separately so an administrator can see WHICH account was used. Masking our
 * own request is not enough, though — everything the legacy system says is
 * relayed verbatim to an admin screen, so a service (or a proxy in front of
 * it) that reflects the credential back in a body, a header, or an error
 * message would put it on that screen. Every result therefore leaves through
 * one redaction pass that removes the access code and its base64 Basic form
 * from the whole object.
 */
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../../../config/env-registry";
import {
  registerUncachedWcRequest,
  wcUncachedRequest,
} from "../../../../services/webclient";

export const FREEMAN_EDLS_MIGRATE_COMPONENT_ID = "sitespecific.freeman.edls_migrate";

/**
 * One framework entry for the whole client: every call is the same generic
 * web-service request with a different action, and the action is data rather
 * than a fixed list this module could enumerate.
 *
 * Never cached — the legacy system is being migrated FROM, so a stored answer
 * would be a copy of data that is actively moving — and no writable database
 * is needed, because nothing here writes anything down. What the caller does
 * with the answer is the caller's decision.
 */
const EDLS_MIGRATE_REQUEST = "request";

registerUncachedWcRequest({
  service: "Freeman EDLS",
  requestType: EDLS_MIGRATE_REQUEST,
  operation: "contact the legacy Freeman EDLS system",
  needsWritableDatabase: false,
});

export const FREEMAN_EDLS_MIGRATE_URL_VAR = "SITESPECIFIC_FREEMAN_EDLS_MIGRATE_URL";
export const FREEMAN_EDLS_MIGRATE_USER_VAR = "SITESPECIFIC_FREEMAN_EDLS_MIGRATE_USER";
export const FREEMAN_EDLS_MIGRATE_PASS_VAR = "SITESPECIFIC_FREEMAN_EDLS_MIGRATE_PASS";

// changeTakesEffect: "immediate" for all three. readConfig() re-reads every one
// of them through the registry on each call and keeps nothing between calls.
registerEnvironmentVariables([
  {
    name: FREEMAN_EDLS_MIGRATE_URL_VAR,
    description:
      "Full URL of the legacy Freeman EDLS generic web service endpoint.",
    secret: false,
    category: FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
    changeTakesEffect: "immediate",
  },
  {
    name: FREEMAN_EDLS_MIGRATE_USER_VAR,
    description:
      "Account id for the legacy Freeman EDLS service, sent as the HTTP Basic user.",
    secret: false,
    category: FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
    changeTakesEffect: "immediate",
  },
  {
    name: FREEMAN_EDLS_MIGRATE_PASS_VAR,
    description:
      "Access code for the legacy Freeman EDLS service, sent as the HTTP Basic password.",
    secret: true,
    category: FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
    changeTakesEffect: "immediate",
  },
]);

/** How long to wait for the legacy service before giving up. */
export const FREEMAN_EDLS_MIGRATE_TIMEOUT_MS = 15_000;

/** The connection-test action. */
export const FREEMAN_EDLS_MIGRATE_PING_ACTION = "sirius_service_ping";

interface FreemanEdlsMigrateConfig {
  url: string;
  user: string;
  pass: string;
}

/** A request to the generic service: the action, then its arguments. */
export interface FreemanEdlsMigrateRequestSpec {
  action: string;
  args: unknown[];
}

export interface FreemanEdlsMigrateRequestDiagnostics {
  url: string;
  method: string;
  /** Authorization is always fully masked here. */
  headers: Record<string, string>;
  /** The account id the call authenticated as (non-secret). */
  authUser: string;
  body: unknown[];
}

export interface FreemanEdlsMigrateResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/**
 * How the attempt ended. Distinguishing these is the whole point of the
 * connection test: "the settings are missing" and "the legacy system refused
 * the access code" are different problems with different fixes.
 */
export type FreemanEdlsMigrateOutcome =
  | "success"
  | "not_configured"
  | "network_error"
  | "http_error"
  | "remote_failure"
  | "unrecognized_response";

export interface FreemanEdlsMigrateResult {
  /** True ONLY when the legacy system itself reported the call succeeded. */
  success: boolean;
  outcome: FreemanEdlsMigrateOutcome;
  action: string;
  /** Names of the settings that are not configured (outcome "not_configured"). */
  missingSettings?: string[];
  /** Absent only when no call was attempted. */
  request?: FreemanEdlsMigrateRequestDiagnostics;
  response?: FreemanEdlsMigrateResponseDiagnostics;
  /** The parsed response body, when it was JSON. */
  data?: unknown;
  /** The response body as text, when it was not JSON. */
  rawBody?: string;
  /** Message strings the legacy system returned, verbatim. */
  remoteMessages?: string[];
  /** For the ping: the value sent, and whether the legacy system echoed it. */
  echo?: { sent: string; returned: boolean };
  error?: string;
  timestamp: string;
  durationMs: number;
}

type ConfigRead =
  | { ok: true; config: FreemanEdlsMigrateConfig }
  | { ok: false; missing: string[] };

/**
 * Read the three settings. A missing setting is an ANSWER, not an exception:
 * the page has to be able to say which one is missing without the request
 * having been attempted.
 */
function readConfig(): ConfigRead {
  const url = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_URL_VAR)?.trim();
  const user = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_USER_VAR)?.trim();
  const pass = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_PASS_VAR);

  const missing: string[] = [];
  if (!url) missing.push(FREEMAN_EDLS_MIGRATE_URL_VAR);
  if (!user) missing.push(FREEMAN_EDLS_MIGRATE_USER_VAR);
  if (!pass) missing.push(FREEMAN_EDLS_MIGRATE_PASS_VAR);
  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, config: { url: url!, user: user!, pass: pass! } };
}

/** Which settings are configured. Never reveals the access code. */
export function getFreemanEdlsMigrateSettingsStatus(): {
  configured: boolean;
  missingSettings: string[];
  /** The configured endpoint (non-secret), or null when unset. */
  url: string | null;
  /** The configured account id (non-secret), or null when unset. */
  user: string | null;
} {
  const read = readConfig();
  if (!read.ok) {
    const url = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_URL_VAR)?.trim() || null;
    const user = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_USER_VAR)?.trim() || null;
    return { configured: false, missingSettings: read.missing, url, user };
  }
  return {
    configured: true,
    missingSettings: [],
    url: read.config.url,
    user: read.config.user,
  };
}

/**
 * The ping request. The legacy ping echoes the arguments it was given back as
 * `arg_0`, `arg_1`, … so a random token is sent and looked for in the reply:
 * a matched echo proves the payload itself arrived, not merely that the host
 * answered.
 */
export function buildPingRequest(echoToken: string): FreemanEdlsMigrateRequestSpec {
  return { action: FREEMAN_EDLS_MIGRATE_PING_ACTION, args: [echoToken] };
}

const REDACTED = "****";

/**
 * The forms of the access code that must never appear in anything we hand
 * back: the code itself, and the base64 Basic value it is half of.
 */
function secretForms(): string[] {
  const user = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_USER_VAR)?.trim();
  const pass = getEnvironmentVariable(FREEMAN_EDLS_MIGRATE_PASS_VAR);
  if (!pass) return [];
  const forms = [pass];
  if (user) forms.push(Buffer.from(`${user}:${pass}`).toString("base64"));
  return forms;
}

function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return out;
}

/**
 * Strip every form of the access code out of a value of any shape. Applied to
 * the whole result on the way out, so relayed content (parsed body, raw text,
 * response headers, the legacy system's own messages, error text) cannot carry
 * the credential onto the page.
 */
function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0 || value === null || value === undefined) return value;
  if (typeof value === "string") return redactText(value, secrets) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, secrets)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[redactText(key, secrets)] = redactDeep(entry, secrets);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Remove the access code from a string bound for a client. For callers (route
 * error handlers) that produce text outside a result object.
 */
export function redactFreemanEdlsMigrateSecrets(text: string): string {
  return redactText(text, secretForms());
}

/** Message strings the legacy system returned, in either of its two shapes. */
function extractRemoteMessages(parsed: unknown): string[] | undefined {
  // A refusal: a bare array of strings.
  if (Array.isArray(parsed)) {
    const strings = parsed.filter((entry): entry is string => typeof entry === "string");
    return strings.length > 0 ? strings : undefined;
  }
  // An envelope: Drupal-style messages alongside the payload.
  if (parsed && typeof parsed === "object") {
    const messages = (parsed as { drupal_messages?: unknown }).drupal_messages;
    if (Array.isArray(messages)) {
      const strings = messages.filter((m): m is string => typeof m === "string");
      return strings.length > 0 ? strings : undefined;
    }
  }
  return undefined;
}

/** Whether the token we sent came back in the ping's echoed arguments. */
function echoReturned(parsed: unknown, token: string): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return Object.values(data as Record<string, unknown>).some((v) => v === token);
}

/**
 * Send one request to the legacy service and describe the outcome.
 *
 * Never throws for a remote or network condition — every failure comes back as
 * a result an administrator can read. The single exception is a
 * `MaintenanceModeError` from the framework: nothing was asked, so there is no
 * outcome to describe, and calling it a failed request would say the legacy
 * system is unwell when it was never contacted. Routes turn it into the shared
 * refusal.
 */
export async function freemanEdlsMigrateRequest(
  spec: FreemanEdlsMigrateRequestSpec,
  options: { echoToken?: string } = {},
): Promise<FreemanEdlsMigrateResult> {
  let outcome: FreemanEdlsMigrateResult | undefined;

  await wcUncachedRequest<FreemanEdlsMigrateResult>({
    service: "Freeman EDLS",
    requestType: EDLS_MIGRATE_REQUEST,
    fetch: async () => {
      outcome = await performRequest(spec, options);
      return { answered: outcome.success, error: outcome.error };
    },
  });

  // Only reachable if the framework declined to make the call, which this
  // entry cannot ask for: it does not need a writable database.
  if (!outcome) {
    throw new Error(`The legacy Freeman EDLS request "${spec.action}" was not attempted.`);
  }

  // ONE exit point for redaction: everything above may relay remote content.
  return redactDeep(outcome, secretForms());
}

async function performRequest(
  spec: FreemanEdlsMigrateRequestSpec,
  options: { echoToken?: string },
): Promise<FreemanEdlsMigrateResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const base = { action: spec.action, timestamp };

  const read = readConfig();
  if (!read.ok) {
    return {
      ...base,
      success: false,
      outcome: "not_configured",
      missingSettings: read.missing,
      error: `Not configured: ${read.missing.join(", ")}`,
      durationMs: Date.now() - startTime,
    };
  }
  const { url, user, pass } = read.config;

  const body = [spec.action, ...spec.args];
  const request: FreemanEdlsMigrateRequestDiagnostics = {
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Fully masked: the access code must not be reconstructable from a
      // screenshot of this page.
      Authorization: "Basic ****",
    },
    authUser: user,
    body,
  };
  const echo = options.echoToken !== undefined
    ? { sent: options.echoToken, returned: false }
    : undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FREEMAN_EDLS_MIGRATE_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ...base,
      success: false,
      outcome: "network_error",
      request,
      echo,
      error: timedOut
        ? `No answer within ${FREEMAN_EDLS_MIGRATE_TIMEOUT_MS / 1000}s`
        : message,
      durationMs: Date.now() - startTime,
    };
  }

  const durationMs = Date.now() - startTime;

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const responseDiagnostics: FreemanEdlsMigrateResponseDiagnostics = {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  };

  const rawBody = await response.text().catch(() => "");
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = JSON.parse(rawBody);
    isJson = true;
  } catch {
    // Left as raw text below.
  }

  const common = {
    ...base,
    request,
    response: responseDiagnostics,
    data: isJson ? parsed : undefined,
    rawBody: isJson ? undefined : rawBody,
    remoteMessages: isJson ? extractRemoteMessages(parsed) : undefined,
    echo:
      echo && isJson
        ? { sent: echo.sent, returned: echoReturned(parsed, echo.sent) }
        : echo,
    durationMs,
  };

  if (!response.ok) {
    const messages = common.remoteMessages;
    return {
      ...common,
      success: false,
      outcome: "http_error",
      error: messages?.length
        ? `HTTP ${response.status}: ${messages.join(" ")}`
        : `HTTP ${response.status} ${response.statusText}`,
    };
  }

  // A 200 is not an answer on its own — the envelope's own flag decides.
  const envelopeSuccess =
    isJson && parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { success?: unknown }).success
      : undefined;

  if (envelopeSuccess === true) {
    return { ...common, success: true, outcome: "success" };
  }
  if (envelopeSuccess === false) {
    const messages = common.remoteMessages;
    return {
      ...common,
      success: false,
      outcome: "remote_failure",
      error: messages?.length
        ? `The legacy system reported a failure: ${messages.join(" ")}`
        : "The legacy system reported a failure.",
    };
  }
  return {
    ...common,
    success: false,
    outcome: "unrecognized_response",
    error:
      "The legacy system answered HTTP 200 with a body that does not carry a success flag.",
  };
}

/** Run the connection test. */
export async function freemanEdlsMigratePing(): Promise<FreemanEdlsMigrateResult> {
  const echoToken = `ping-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return freemanEdlsMigrateRequest(buildPingRequest(echoToken), { echoToken });
}
