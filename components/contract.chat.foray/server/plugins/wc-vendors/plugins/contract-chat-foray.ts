import { z } from "zod";
import { registerWcVendorPlugin } from "../../../../../../server/plugins/wc-vendors/registry";
import type { WcVendorContext } from "../../../../../../server/plugins/wc-vendors/types";
import { redactCredentialText, redactCredentialValue } from "../../../../../../server/plugins/wc-vendors/plugins/credential-redaction";
import { isWcEndpointPolicyError, isWcRateLimitError, WcTransportTimeoutError } from "../../../../../../server/services/webclient/refusals";
import { isMaintenanceModeError } from "../../../../../../server/services/maintenance-flag";
import { feedbackArgs, manualSchemas, parseArgs, routeArgs, searchArgs, validateAsk } from "../../../../../contract.chat/server/contract";
import { forayBaseUrl, forayDefaultUrl } from "../../../foray-url";
import { ContractChatProviderError, mapAnswer, mapCatalog, mapSearch, parseResponse } from "../../../foray-response";

/**
 * Only registered handlers reach this transport; no storage, direct fetch,
 * credential resolution, retries, or transcript logging belongs in a vendor.
 */
async function request(ctx: WcVendorContext, path: string, body?: unknown, timeout = 30_000): Promise<unknown> {
  const base = forayBaseUrl((ctx.config.data as Record<string, unknown> | null)?.baseUrl);
  let response: Response;
  try {
    response = await ctx.http.fetch(`${base}/v1/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${ctx.credential.value}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: timeout,
    });
  } catch (error) {
    if (isWcEndpointPolicyError(error) || isWcRateLimitError(error) || isMaintenanceModeError(error)) throw error;
    if (error instanceof WcTransportTimeoutError) throw new ContractChatProviderError(504, "Foray timed out.", "timeout");
    // Never relay an SDK/transport error containing request headers or content.
    throw new ContractChatProviderError(502, "Could not reach Foray (connection failed or timed out).", "transport_error");
  }
  let data: unknown;
  try {
    data = redactCredentialValue(await response.json(), ctx.credential.value);
  } catch {
    throw new ContractChatProviderError(502, `Foray returned invalid JSON (HTTP ${response.status}).`, "malformed_response");
  }
  const envelope = z.object({
    request_id: z.string().optional(), code: z.string().optional(),
    error: z.union([z.string(), z.object({ code: z.string(), message: z.string() })]).optional(),
  }).safeParse(data);
  if (!response.ok || (envelope.success && envelope.data.error && !(data && typeof data === "object" && "status" in data))) {
    const error = envelope.success ? envelope.data.error : undefined;
    const code = (envelope.success ? envelope.data.code : undefined) ??
      (error && typeof error === "object" ? error.code : `http_${response.status}`);
    const detail = typeof error === "string" ? error : error?.message;
    const requestId = (envelope.success ? envelope.data.request_id : undefined) ??
      response.headers.get("x-request-id") ?? undefined;
    throw new ContractChatProviderError(
      response.ok ? 502 : response.status,
      redactCredentialText(`Foray ${code}${requestId ? ` (request ${requestId})` : ""}: ${detail ?? `HTTP ${response.status}`}`, ctx.credential.value),
      redactCredentialText(code, ctx.credential.value),
      requestId ? redactCredentialText(requestId, ctx.credential.value) : undefined,
    );
  }
  return data;
}

registerWcVendorPlugin({
  id: "contract-chat-foray",
  name: "Contract Chat — Foray",
  description: "Foray contract catalog, chat, search, routing and feedback. Chat and routing are metered; questions are sent to Foray.",
  requiredComponent: "contract.chat.foray",
  service: "Foray Contract Chat",
  httpTransport: "webclient",
  endpointPolicy: {
    requiresAllowlist: true,
    defaultAllowedHosts: ["cba-service.foray-consulting.workers.dev"],
  },
  credential: {
    secretName: "required",
    setupGuidance: "Name an environment secret containing the Foray host bearer token (the raw token, without 'Bearer '). Never put the token in this configuration.",
    setupExample: "FORAY_CONTRACT_CHAT_TOKEN",
  },
  configFields: [{
    name: "baseUrl", label: "HTTPS base URL", type: "string",
    description: `Defaults to ${forayDefaultUrl}. Other hosts require a deployment destination-policy override.`,
  }],
  validateConfig(data) {
    try { forayBaseUrl(data.baseUrl); return { valid: true }; }
    catch { return { valid: false, errors: ["Foray requires an HTTPS base URL on port 443 without credentials, query or fragment."] }; }
  },
  operations: {
    "service.test-connection": {
      description: "test Foray credentials using the free authenticated catalog",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.empty, effect: "read" },
      async run(ctx) {
        try {
          mapCatalog(await request(ctx, "contracts"));
          return { status: "connected", account: { id: "foray-contract-chat", type: "Authenticated catalog access" } };
        } catch (error) {
          if (!(error instanceof ContractChatProviderError)) throw error;
          return {
            status: error.status === 401 || error.status === 403 ? "misconfigured" : "unreachable",
            error: { message: error.message, code: error.code },
          };
        }
      },
    },
    "contract.chat.catalog": {
      description: "list accessible contracts (free)",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.empty, effect: "read" },
      async run(ctx) { return mapCatalog(await request(ctx, "contracts")); },
    },
    "contract.chat.ask": {
      description: "ask about a contract (metered AI call; sends conversation to Foray)",
      needsWritableDatabase: true, externalSideEffect: true, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.ask, effect: "write" },
      async run(ctx, input) {
        const args = validateAsk(input);
        return mapAnswer(await request(ctx, "chat", {
          contract_id: args.contractId, role: args.role, messages: args.messages,
          user_ref: args.userRef, session_ref: args.sessionRef, mode: args.mode ?? "whole", stream: false,
        }, 180_000));
      },
    },
    "contract.chat.search": {
      description: "search published contract pages (free)",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.search, effect: "read" },
      async run(ctx, input) {
        const args = parseArgs(searchArgs, input);
        return mapSearch(await request(ctx, "search", { query: args.query, contract_ids: args.contractIds, limit: args.limit }));
      },
    },
    "contract.chat.route": {
      description: "suggest a contract for a question (metered AI call)",
      needsWritableDatabase: true, externalSideEffect: true, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.route, effect: "write" },
      async run(ctx, input) {
        const args = parseArgs(routeArgs, input);
        const { route } = parseResponse(z.object({ route: z.string().min(1) }), await request(ctx, "route", args));
        return route === "ask" || route === "none" ? { kind: route } : { kind: "contract", contractId: route };
      },
    },
    "contract.chat.feedback": {
      description: "record feedback for a Foray request (remote write)",
      needsWritableDatabase: true, externalSideEffect: true, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.feedback, effect: "write" },
      async run(ctx, input) {
        const args = parseArgs(feedbackArgs, input);
        parseResponse(z.object({ ok: z.literal(true) }), await request(ctx, "feedback", {
          request_id: args.requestId, rating: args.rating, comment: args.comment,
        }));
        return { ok: true, persisted: true };
      },
    },
  },
});
