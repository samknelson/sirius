import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { cardchecks } from "@shared/schema";
import { and, eq } from "drizzle-orm";

interface CardcheckConfig extends BaseEligibilityConfig {
  cardcheckDefinitionId: string;
}

class CardcheckPlugin extends EligibilityPlugin<CardcheckConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "cardcheck",
    name: "Cardcheck",
    description:
      "Worker must have a signed cardcheck of the specified definition to be eligible.",
    requiredComponent: "cardcheck",
    needsReadOnlyDb: true,
    configSchema: {
      type: "object",
      required: ["cardcheckDefinitionId"],
      properties: {
        cardcheckDefinitionId: {
          type: "string",
          title: "Cardcheck definition",
          description:
            "Worker must have a cardcheck of this definition with status 'signed' to be eligible.",
          minLength: 1,
          "x-options-resource": "cardcheck-definition",
        },
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;
    const c = (config ?? {}) as CardcheckConfig;
    if (!c.cardcheckDefinitionId || typeof c.cardcheckDefinitionId !== "string") {
      return { valid: false, errors: ["cardcheckDefinitionId is required"] };
    }
    const def = await storage.cardcheckDefinitions.getCardcheckDefinitionById(
      c.cardcheckDefinitionId,
    );
    if (!def) {
      return {
        valid: false,
        errors: [`Unknown cardcheck definition: ${c.cardcheckDefinitionId}`],
      };
    }
    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: CardcheckConfig,
  ): Promise<EligibilityResult> {
    const def = await storage.cardcheckDefinitions.getCardcheckDefinitionById(
      config.cardcheckDefinitionId,
    );
    if (!def) {
      return {
        eligible: false,
        reason: `Configured cardcheck definition (${config.cardcheckDefinitionId}) no longer exists`,
      };
    }

    const hasSigned = await storage.readOnly.query(async (client) => {
      const [row] = await client
        .select({ id: cardchecks.id })
        .from(cardchecks)
        .where(
          and(
            eq(cardchecks.workerId, context.subscriberWorker.id),
            eq(cardchecks.cardcheckDefinitionId, config.cardcheckDefinitionId),
            eq(cardchecks.status, "signed"),
          ),
        )
        .limit(1);
      return !!row;
    });

    if (hasSigned) {
      return {
        eligible: true,
        reason: `Worker has a signed ${def.name} cardcheck`,
      };
    }
    return {
      eligible: false,
      reason: `Worker has no signed ${def.name} cardcheck`,
    };
  }
}

const plugin = new CardcheckPlugin();
registerEligibilityPlugin(plugin);

export { CardcheckPlugin };
