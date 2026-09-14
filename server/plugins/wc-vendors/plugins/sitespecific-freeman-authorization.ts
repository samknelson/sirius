import type {
  WcVendorContext,
  WcVendorOperationDeclaration,
  WcVendorPlugin,
} from "../types";
import { registerWcVendorPlugin } from "../registry";
import { WcVendorError } from "../errors";

export const FREEMAN_AUTHORIZATION_PLUGIN_ID =
  "sitespecific-freeman-authorization";
export const FREEMAN_AUTHORIZATION_COMPONENT_ID =
  "sitespecific.freeman.authorization";

const REQUEST_TIMEOUT_MS = 15_000;
const REDACTED = "(redacted)";

export type FreemanAuthorizationOutcome =
  | "success"
  | "network_error"
  | "http_error"
  | "malformed_response"
  | "unexpected_ping_status";

export interface FreemanAuthorizationResult {
  success: boolean;
  outcome: FreemanAuthorizationOutcome;
  status?: number;
  response?: unknown;
  error?: string;
}

interface FreemanAuthorizationSettings {
  url: string;
}

interface FreemanBearerAuthorizationArgs {
  bearerCredential: string;
}

class FreemanAuthorizationConfigurationError extends WcVendorError {
  constructor(message: string) {
    super(503, message);
    this.name = "FreemanAuthorizationConfigurationError";
  }
}

function readSettings(ctx: WcVendorContext): FreemanAuthorizationSettings {
  const data =
    ctx.config.data && typeof ctx.config.data === "object"
      ? (ctx.config.data as Record<string, unknown>)
      : {};
  const url =
    typeof data.authorizationUrl === "string"
      ? data.authorizationUrl.trim()
      : "";
  if (!url) {
    throw new FreemanAuthorizationConfigurationError(
      `Freeman authorization connection '${ctx.config.name ?? ctx.config.id}' is missing: authorizationUrl.`,
    );
  }
  return { url };
}

function credentialScrubber(token: string): {
  text(value: string): string;
  deep<T>(value: T): T;
} {
  const candidates = new Set([token, JSON.stringify(token).slice(1, -1)]);
  const ordered = Array.from(candidates)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const text = (value: string): string => {
    let scrubbed = value;
    for (const candidate of ordered) {
      scrubbed = scrubbed.split(candidate).join(REDACTED);
    }
    return scrubbed;
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

async function fetchFreemanAuthorization(
  ctx: WcVendorContext,
  bearerToken?: string,
): Promise<FreemanAuthorizationResult> {
  const { url } = readSettings(ctx);
  const authenticated = bearerToken !== undefined;
  const scrub = credentialScrubber(bearerToken ?? "");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: authenticated
        ? { Authorization: `Bearer ${bearerToken}` }
        : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      success: false,
      outcome: "network_error",
      error: scrub.text(
        timedOut
          ? `No answer within ${REQUEST_TIMEOUT_MS / 1000}s`
          : error instanceof Error
            ? error.message
            : "Unknown network error",
      ),
    };
  }

  if (!authenticated) {
    return response.status === 401
      ? { success: true, outcome: "success", status: response.status }
      : {
          success: false,
          outcome: "unexpected_ping_status",
          status: response.status,
          error: `Expected HTTP 401 but received HTTP ${response.status}.`,
        };
  }

  const rawBody = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = scrub.deep(JSON.parse(rawBody));
  } catch {
    return {
      success: false,
      outcome: "malformed_response",
      status: response.status,
      error: "The Freeman authorization service returned malformed JSON.",
    };
  }

  if (!response.ok) {
    return {
      success: false,
      outcome: "http_error",
      status: response.status,
      response: parsed,
      error: `The Freeman authorization service returned HTTP ${response.status}.`,
    };
  }

  return {
    success: true,
    outcome: "success",
    status: response.status,
    response: parsed,
  };
}

const operations = {
  ping: {
    description: "check the Freeman authorization endpoint",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      effect: "read",
    },
    run: (ctx: WcVendorContext, _args: void) =>
      fetchFreemanAuthorization(ctx),
  },
  "authorize-bearer": {
    description: "authorize a bearer token with Freeman",
    needsWritableDatabase: false,
    manualRun: {
      argsSchema: {
        type: "object",
        properties: {
          bearerCredential: {
            type: "string",
            title: "Bearer credential",
            minLength: 1,
            pattern: "\\S",
          },
        },
        required: ["bearerCredential"],
        additionalProperties: false,
      },
      uiSchema: {
        bearerCredential: {
          "ui:widget": "password",
        },
      },
      effect: "read",
    },
    run: (ctx: WcVendorContext, args: FreemanBearerAuthorizationArgs) => {
      const bearerToken = args.bearerCredential.trim();
      if (!bearerToken) {
        throw new WcVendorError(400, "Bearer credential is required.");
      }
      return fetchFreemanAuthorization(ctx, bearerToken);
    },
  },
} satisfies {
  ping: WcVendorOperationDeclaration<void, FreemanAuthorizationResult>;
  "authorize-bearer": WcVendorOperationDeclaration<
    FreemanBearerAuthorizationArgs,
    FreemanAuthorizationResult
  >;
};

type FreemanAuthorizationOperationContract = {
  [N in keyof typeof operations]: {
    args: Parameters<(typeof operations)[N]["run"]>[1];
    result: Awaited<ReturnType<(typeof operations)[N]["run"]>>;
  };
};

declare module "../types" {
  interface WcVendorOperations
    extends FreemanAuthorizationOperationContract {}
}

const freemanAuthorizationVendorPlugin: WcVendorPlugin = {
  id: FREEMAN_AUTHORIZATION_PLUGIN_ID,
  name: "Freeman Bearer Authorization",
  description: "Bearer authorization service for Freeman integrations.",
  requiredComponent: FREEMAN_AUTHORIZATION_COMPONENT_ID,
  credential: {
    secretName: "none",
  },
  configFields: [
    {
      name: "authorizationUrl",
      label: "Bearer Authorization URL",
      type: "string",
      required: true,
    },
  ],
  validateConfig(data) {
    const url =
      typeof data.authorizationUrl === "string"
        ? data.authorizationUrl.trim()
        : "";
    if (!url) return { valid: true };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return {
          valid: false,
          errors: [
            "Bearer Authorization URL must be an http or https URL.",
          ],
        };
      }
    } catch {
      return {
        valid: false,
        errors: ["Bearer Authorization URL must be a valid absolute URL."],
      };
    }
    return { valid: true };
  },
  service: "Freeman Authorization",
  operations,
};

registerWcVendorPlugin(freemanAuthorizationVendorPlugin);