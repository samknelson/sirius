import { EligibilityPlugin } from "../base";
import type {
  BaseEligibilityConfig,
  EligibilityContext,
  EligibilityPluginMetadata,
  EligibilityResult,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";

interface BaoEeContributionsConfig extends BaseEligibilityConfig {
  accountId: string;
}

export class BaoEeContributionsPlugin extends EligibilityPlugin<BaoEeContributionsConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-ee-contributions",
    name: "BAO EE Contributions",
    description:
      "Blocks subscriber and dependent benefits when the subscriber owes a positive net balance in two or more statement months on the selected ledger account. Only the evaluated month is excluded; months need not be consecutive and future months count.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      required: ["accountId"],
      properties: {
        accountId: {
          type: "string",
          format: "uuid",
          title: "Ledger account",
          description: "Select the employee contribution account (initially H&W EE).",
          "x-options-endpoint": "/api/ledger/accounts",
        },
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const result = await super.validateConfig(config);
    if (!result.valid) return result;
    const { accountId } = config as BaoEeContributionsConfig;
    if (!await storage.ledger.accounts.get(accountId)) {
      return { valid: false, errors: ["Ledger account does not exist"] };
    }
    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoEeContributionsConfig,
  ): Promise<EligibilityResult> {
    // Executor calls evaluate directly, so stale/deleted configuration must
    // fail explicitly here too, before an absent worker account can pass.
    const validation = await this.validateConfig(config);
    if (!validation.valid) {
      return {
        eligible: false,
        reason: `Invalid BAO EE Contributions configuration: ${validation.errors?.join("; ")}`,
      };
    }
    const excluded = `${context.asOfYear}-${String(context.asOfMonth).padStart(2, "0")}`;
    const ea = await storage.ledger.ea.getByEntityAndAccount(
      "worker", context.subscriberWorker.id, config.accountId,
    );
    if (!ea) {
      return {
        eligible: true,
        reason: `0 outstanding statement months (excluding ${excluded}); subscriber has no worker-linked account on the configured ledger account.`,
      };
    }
    // Ledger entries, not payment records or FIFO state, are authoritative.
    // The database compares exact numeric sums; no floating-point tolerance.
    const outstanding = await storage.ledger.entries.getOutstandingStatementMonths(
      ea.id, { year: context.asOfYear, month: context.asOfMonth },
    );
    const months = outstanding.months.map(
      ({ year, month }) => `${year}-${String(month).padStart(2, "0")}`,
    );
    const remainder = outstanding.count - months.length;
    const detail = months.length
      ? `: ${months.join(", ")}${remainder > 0 ? ` (and ${remainder} more)` : ""}`
      : "";
    return {
      eligible: outstanding.count < 2,
      reason: `${outstanding.count} outstanding statement month${outstanding.count === 1 ? "" : "s"}${detail} (excluding ${excluded}) on the subscriber's configured ledger account; two or more blocks subscriber and dependent benefits.`,
    };
  }
}

registerEligibilityPlugin(new BaoEeContributionsPlugin());