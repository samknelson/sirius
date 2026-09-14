import { randomBytes } from "crypto";
import type {
  GatewayConnectionTest,
  WcVendorContext,
  WcVendorOperationDeclaration,
  WcVendorPlugin,
} from "../types";
import { registerWcVendorPlugin } from "../registry";
import { WcVendorError } from "../errors";

export const FREEMAN_EDLS_MIGRATE_PLUGIN_ID =
  "sitespecific-freeman-edls-migrate";
export const FREEMAN_EDLS_MIGRATE_COMPONENT_ID =
  "sitespecific.freeman.edls_migrate";
export const FREEMAN_EDLS_MIGRATE_OPERATION =
  "sitespecific.freeman.edls.migrate";
export const FREEMAN_EDLS_MIGRATE_RAWDATA_ACTION =
  "sirius_freeman_rawdata";
const FREEMAN_EDLS_MIGRATE_PING_ACTION = "sirius_service_ping";
const FREEMAN_EDLS_MIGRATE_TIMEOUT_MS = 15_000;

export interface FreemanEdlsRawDataArgs {
  table: string;
  orderColumn: string;
  limit: number;
  offset: number;
}

export interface FreemanEdlsRequestDiagnostics {
  url: string;
  method: string;
  headers: Record<string, string>;
  authUser: string;
  body: unknown[];
}

export interface FreemanEdlsResponseDiagnostics {
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export type FreemanEdlsOutcome =
  | "success"
  | "network_error"
  | "http_error"
  | "remote_failure"
  | "unrecognized_response";

export interface FreemanEdlsResult {
  success: boolean;
  outcome: FreemanEdlsOutcome;
  action: string;
  request: FreemanEdlsRequestDiagnostics;
  response?: FreemanEdlsResponseDiagnostics;
  data?: unknown;
  rawBody?: string;
  remoteMessages?: string[];
  echo?: { sent: string; returned: boolean };
  error?: string;
  timestamp: string;
  durationMs: number;
}

interface FreemanEdlsSettings {
  url: string;
  accountId: string;
  accessCode: string;
}

class FreemanEdlsConfigurationError extends WcVendorError {
  constructor(message: string) {
    super(503, message);
    this.name = "FreemanEdlsConfigurationError";
  }
}

function configData(ctx: WcVendorContext): Record<string, unknown> {
  const data = ctx.config.data;
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}

function readSettings(ctx: WcVendorContext): FreemanEdlsSettings {
  const data = configData(ctx);
  const url = typeof data.url === "string" ? data.url.trim() : "";
  const accountId =
    typeof data.accountId === "string" ? data.accountId.trim() : "";
  const accessCode = ctx.credential.value;
  const missing: string[] = [];
  if (!url) missing.push("url");
  if (!accountId) missing.push("accountId");
  if (!accessCode) missing.push("credential");
  if (missing.length > 0) {
    throw new FreemanEdlsConfigurationError(
      `Freeman EDLS connection '${ctx.config.name ?? ctx.config.id}' is missing: ${missing.join(", ")}.`,
    );
  }
  return { url, accountId, accessCode };
}

const REDACTED = "(redacted)";

function credentialScrubber(
  accountId: string,
  accessCode: string,
): { text(value: string): string; deep<T>(value: T): T } {
  const basic = Buffer.from(`${accountId}:${accessCode}`).toString("base64");
  const candidates = new Set<string>();
  for (const secret of [accessCode, basic]) {
    candidates.add(secret);
    candidates.add(JSON.stringify(secret).slice(1, -1));
  }
  const ordered = Array.from(candidates).sort((a, b) => b.length - a.length);
  const text = (value: string): string => {
    let result = value;
    for (const secret of ordered) result = result.split(secret).join(REDACTED);
    return result;
  };
  const deep = (value: unknown): unknown => {
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          text(key),
          deep(nested),
        ]),
      );
    }
    return value;
  };
  return { text, deep: (value) => deep(value) as typeof value };
}

function extractRemoteMessages(parsed: unknown): string[] | undefined {
  if (Array.isArray(parsed)) {
    const strings = parsed.filter(
      (entry): entry is string => typeof entry === "string",
    );
    return strings.length > 0 ? strings : undefined;
  }
  if (parsed && typeof parsed === "object") {
    const messages = (parsed as { drupal_messages?: unknown }).drupal_messages;
    if (Array.isArray(messages)) {
      const strings = messages.filter(
        (message): message is string => typeof message === "string",
      );
      return strings.length > 0 ? strings : undefined;
    }
  }
  return undefined;
}

function echoReturned(parsed: unknown, token: string): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const data = (parsed as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return Object.values(data as Record<string, unknown>).some(
    (value) => value === token,
  );
}

async function performFreemanEdlsRequest(
  ctx: WcVendorContext,
  action: string,
  args: unknown[],
  echoToken?: string,
): Promise<FreemanEdlsResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const settings = readSettings(ctx);
  const scrub = credentialScrubber(settings.accountId, settings.accessCode);
  const body = [action, ...args];
  const request: FreemanEdlsRequestDiagnostics = {
    url: settings.url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${REDACTED}`,
    },
    authUser: settings.accountId,
    body,
  };
  const base = { action, request, timestamp };
  const echo =
    echoToken === undefined
      ? undefined
      : { sent: echoToken, returned: false };

  let response: Response;
  try {
    response = await fetch(settings.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(
          `${settings.accountId}:${settings.accessCode}`,
        ).toString("base64")}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FREEMAN_EDLS_MIGRATE_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ...base,
      success: false,
      outcome: "network_error",
      echo,
      error: scrub.text(
        timedOut
          ? `No answer within ${FREEMAN_EDLS_MIGRATE_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : "Unknown error",
      ),
      durationMs: Date.now() - started,
    };
  }

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[scrub.text(key)] = scrub.text(value);
  });
  const responseDiagnostics: FreemanEdlsResponseDiagnostics = {
    status: response.status,
    statusText: scrub.text(response.statusText),
    headers: responseHeaders,
  };
  const rawBody = scrub.text(await response.text().catch(() => ""));
  let parsed: unknown;
  let isJson = false;
  try {
    parsed = scrub.deep(JSON.parse(rawBody));
    isJson = true;
  } catch {
    // Preserve the scrubbed raw response below.
  }
  const remoteMessages = isJson
    ? extractRemoteMessages(parsed)
    : undefined;
  const common = {
    ...base,
    response: responseDiagnostics,
    data: isJson ? parsed : undefined,
    rawBody: isJson ? undefined : rawBody,
    remoteMessages,
    echo:
      echo && isJson
        ? { sent: echo.sent, returned: echoReturned(parsed, echo.sent) }
        : echo,
    durationMs: Date.now() - started,
  };

  if (!response.ok) {
    return {
      ...common,
      success: false,
      outcome: "http_error",
      error: remoteMessages?.length
        ? `HTTP ${response.status}: ${remoteMessages.join(" ")}`
        : `HTTP ${response.status} ${responseDiagnostics.statusText}`,
    };
  }
  const envelopeSuccess =
    isJson && parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { success?: unknown }).success
      : undefined;
  if (envelopeSuccess === true) {
    return { ...common, success: true, outcome: "success" };
  }
  if (envelopeSuccess === false) {
    return {
      ...common,
      success: false,
      outcome: "remote_failure",
      error: remoteMessages?.length
        ? `The legacy system reported a failure: ${remoteMessages.join(" ")}`
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

const remoteOperations = {
  [FREEMAN_EDLS_MIGRATE_OPERATION]: {
    description: "read a page from the legacy Freeman EDLS system",
    needsWritableDatabase: false,
    run: (ctx: WcVendorContext, args: FreemanEdlsRawDataArgs) =>
      performFreemanEdlsRequest(ctx, FREEMAN_EDLS_MIGRATE_RAWDATA_ACTION, [
        args.table,
        args.orderColumn,
        String(args.limit),
        String(args.offset),
      ]),
  },
} satisfies Record<
  string,
  WcVendorOperationDeclaration<FreemanEdlsRawDataArgs, FreemanEdlsResult>
>;

type FreemanEdlsOperationContract = {
  [N in keyof typeof remoteOperations]: {
    args: Parameters<(typeof remoteOperations)[N]["run"]>[1];
    result: Awaited<ReturnType<(typeof remoteOperations)[N]["run"]>>;
  };
};

declare module "../types" {
  interface WcVendorOperations extends FreemanEdlsOperationContract {}
}

const freemanEdlsMigrateVendorPlugin: WcVendorPlugin = {
  id: FREEMAN_EDLS_MIGRATE_PLUGIN_ID,
  name: "Freeman EDLS Migration",
  description:
    "Connection to Freeman's legacy EDLS system for staging historical sheets.",
  requiredComponent: FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
  credential: {
    secretName: "required",
    setupGuidance:
      "The named secret must contain the legacy Freeman EDLS access code used as the HTTP Basic password.",
  },
  configFields: [
    {
      name: "url",
      label: "Service URL",
      type: "string",
      required: true,
    },
    {
      name: "accountId",
      label: "Account ID",
      type: "string",
      required: true,
    },
  ],
  validateConfig(data) {
    const url = typeof data.url === "string" ? data.url.trim() : "";
    if (!url) return { valid: true };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          valid: false,
          errors: ["Service URL must be an http or https URL."],
        };
      }
    } catch {
      return {
        valid: false,
        errors: ["Service URL must be a valid absolute URL."],
      };
    }
    return { valid: true };
  },
  service: "Freeman EDLS",
  operations: {
    ...remoteOperations,
    "service.test-connection": {
      description: "test the legacy Freeman EDLS connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      async run(ctx): Promise<GatewayConnectionTest> {
        try {
          const token = randomBytes(8).toString("hex");
          const result = await performFreemanEdlsRequest(
            ctx,
            FREEMAN_EDLS_MIGRATE_PING_ACTION,
            [token],
            token,
          );
          if (result.success && result.echo?.returned) {
            const settings = readSettings(ctx);
            return {
              connected: true,
              account: {
                id: `${settings.accountId} @ ${new URL(settings.url).hostname}`,
                capabilities: [
                  {
                    label: `Ping answered and echoed payload in ${result.durationMs}ms`,
                    enabled: true,
                  },
                ],
              },
            };
          }
          return {
            connected: false,
            error: {
              message:
                result.error ??
                (result.success
                  ? "The legacy service answered but did not echo the ping payload."
                  : "The legacy Freeman EDLS service did not answer the ping."),
              code: result.response
                ? String(result.response.status)
                : undefined,
            },
          };
        } catch (error) {
          if (error instanceof FreemanEdlsConfigurationError) {
            return {
              connected: false,
              error: { message: error.message },
            };
          }
          throw error;
        }
      },
    },
  },
};

registerWcVendorPlugin(freemanEdlsMigrateVendorPlugin);