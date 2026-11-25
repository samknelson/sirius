import { registerWcVendorPlugin } from "../../../../../../server/plugins/wc-vendors/registry";
import type { WcVendorContext } from "../../../../../../server/plugins/wc-vendors/types";
import { WcVendorError } from "../../../../../../server/plugins/wc-vendors/errors";
import type { ContractChatAnswer, ContractChatCatalogEntry } from "../../../../shared/types";
import { feedbackArgs, manualSchemas, parseArgs, routeArgs, searchArgs, validateAsk } from "../../../contract";

const scenarios = ["normal", "refusal", "truncated", "budget_exceeded", "rate_limited", "service_error"] as const;
const contract: ContractChatCatalogEntry = {
  id: "synthetic-contract",
  name: "SYNTHETIC — Example Collective Bargaining Agreement",
  status: "expired",
  notice: "SYNTHETIC TEST DATA — not a real agreement or legal advice. This example agreement is expired.",
  externalRef: null, termEnd: "2025-12-31", version: 1,
  documents: [{ id: "synthetic-document", name: "SYNTHETIC Example Agreement.pdf" }],
};

function scenario(ctx: WcVendorContext): typeof scenarios[number] {
  const value = (ctx.config.data as Record<string, unknown> | null)?.scenario ?? "normal";
  if (!scenarios.includes(value as typeof scenarios[number])) {
    throw new WcVendorError(400, "Unknown dummy contract-chat simulation scenario.");
  }
  return value as typeof scenarios[number];
}

function simulateFailure(ctx: WcVendorContext): void {
  const value = scenario(ctx);
  if (value === "budget_exceeded" || value === "rate_limited" || value === "service_error") {
    throw Object.assign(new WcVendorError(value === "service_error" ? 503 : 429, `SYNTHETIC simulation: ${value}`), { code: value });
  }
}

function requireContract(id: string): void {
  if (id !== contract.id) throw new WcVendorError(404, "Unknown synthetic contract. Use synthetic-contract.");
}

registerWcVendorPlugin({
  id: "contract-chat-dummy",
  name: "Contract Chat — Dummy (Testing)",
  description: "Deterministic, synthetic contract chat with no credentials, outbound calls, charges or transcript storage.",
  requiredComponent: "contract.chat",
  credential: { secretName: "none" },
  // No service: synthetic work must not appear as network usage.
  configFields: [{
    name: "scenario", label: "Simulation scenario", type: "string",
    options: { choices: scenarios.map((value) => ({ value, label: value.replaceAll("_", " ") })) },
    description: "Defaults to normal. Failure scenarios affect all operations; refusal/truncated affect chat answers.",
  }],
  validateConfig(data) {
    return data.scenario === undefined || scenarios.includes(data.scenario as typeof scenarios[number])
      ? { valid: true }
      : { valid: false, errors: ["Unknown dummy contract-chat simulation scenario."] };
  },
  operations: {
    "service.test-connection": {
      description: "test the local synthetic contract-chat provider",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.empty, effect: "read" },
      async run(ctx) {
        const value = scenario(ctx);
        return value === "service_error" || value === "rate_limited" || value === "budget_exceeded"
          ? { status: "unreachable", testMode: true, error: { message: `SYNTHETIC simulation: ${value}`, code: value } }
          : { status: "connected", testMode: true, account: { id: "synthetic-contract-chat", type: "Local simulation; no network" } };
      },
    },
    "contract.chat.catalog": {
      description: "list synthetic contracts",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.empty, effect: "read" },
      async run(ctx) { simulateFailure(ctx); return structuredClone([contract]); },
    },
    "contract.chat.ask": {
      description: "simulate a contract answer (no AI call or charge)",
      needsWritableDatabase: true, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.ask, effect: "write" },
      async run(ctx, input): Promise<ContractChatAnswer> {
        const args = validateAsk(input);
        simulateFailure(ctx);
        requireContract(args.contractId);
        const value = scenario(ctx);
        const refused = value === "refusal";
        const truncated = value === "truncated";
        return {
          requestId: "synthetic-request", contractId: contract.id, contractName: contract.name,
          contractStatus: contract.status, externalRef: null, notice: contract.notice,
          answer: refused ? "" : truncated
            ? "SYNTHETIC partial answer: the example agreement provides…"
            : "SYNTHETIC answer: the example agreement provides a thirty-minute meal break. This is sample text only.",
          citations: refused ? [] : [{
            document: contract.documents[0].name, page: 3, endPage: 3,
            article: null, section: "Breaks", quote: "SYNTHETIC: A thirty-minute meal break shall be provided.",
          }],
          status: refused ? "refusal" : truncated ? "truncated" : "ok",
          error: refused ? { code: "refusal", message: "SYNTHETIC refusal: this question could not be answered." } : null,
          likelyGrievance: null, scope: refused ? "off_purpose" : "in_contract",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
          costUsd: 0, latencyMs: 0, timeToFirstTokenMs: 0, model: "synthetic-no-model",
          stopReason: truncated ? "max_tokens" : "end_turn",
        };
      },
    },
    "contract.chat.search": {
      description: "search synthetic contract pages",
      needsWritableDatabase: false, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.search, effect: "read" },
      async run(ctx, input) {
        const args = parseArgs(searchArgs, input);
        simulateFailure(ctx);
        if (args.contractIds && !args.contractIds.includes(contract.id)) return [];
        return [{
          contractId: contract.id, contractName: contract.name, contractStatus: contract.status, notice: contract.notice,
          document: contract.documents[0].name, documentId: contract.documents[0].id,
          page: 3, article: null, section: "Breaks",
          snippet: "SYNTHETIC search result: a thirty-minute meal break shall be provided.",
        }];
      },
    },
    "contract.chat.route": {
      description: "simulate a contract suggestion (no AI call or charge)",
      needsWritableDatabase: true, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.route, effect: "write" },
      async run(ctx, input) {
        const { question } = parseArgs(routeArgs, input);
        simulateFailure(ctx);
        // Deliberate fixture selectors, not a fake inference engine.
        if (question.trim().toLowerCase() === "ask") return { kind: "ask" };
        if (question.trim().toLowerCase() === "none") return { kind: "none" };
        return { kind: "contract", contractId: contract.id };
      },
    },
    "contract.chat.feedback": {
      description: "acknowledge synthetic feedback (not persisted)",
      needsWritableDatabase: true, externalSideEffect: false, cache: { mode: "uncached" },
      manualRun: { argsSchema: manualSchemas.feedback, effect: "write" },
      async run(ctx, input) {
        parseArgs(feedbackArgs, input);
        simulateFailure(ctx);
        return { ok: true, persisted: false };
      },
    },
  },
});
