import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { createUnifiedOptionsStorage } from "../../../../storage/unified-options";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

interface RelationshipTypeConfig extends BaseEligibilityConfig {
  allowedRelationTypeIds: string[];
  allowSelf: boolean;
}

function endOfMonth(year: number, month: number): Date {
  const d = new Date(year, month - 1, 1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function lookupRelationTypeName(id: string): Promise<string> {
  const opt = await unifiedOptionsStorage.get("worker-relation-type", id);
  return opt?.name ?? id;
}

async function lookupAllowedNames(ids: string[]): Promise<string> {
  if (ids.length === 0) return "(none)";
  const names = await Promise.all(ids.map(lookupRelationTypeName));
  return names.join(", ");
}

class RelationshipTypePlugin extends EligibilityPlugin<RelationshipTypeConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "relationship-type",
    name: "Relationship Type",
    description:
      "Dependent is eligible only when its relationship to the subscriber is one of the configured types (active on the as-of date). Optionally allows the subscriber themselves (no relationship) to qualify.",
    configSchema: {
      type: "object",
      required: ["allowedRelationTypeIds", "allowSelf"],
      properties: {
        allowedRelationTypeIds: {
          type: "array",
          title: "Allowed relationship types",
          description:
            "An active relationship of one of these types between the subscriber and the dependent makes the dependent eligible.",
          items: { type: "string", format: "uuid" },
          uniqueItems: true,
          default: [],
          "x-options-resource": "worker-relation-type",
        },
        allowSelf: {
          type: "boolean",
          title: "Allow self (subscriber is the dependent)",
          description:
            "When enabled, the subscriber themselves passes this rule even when no relationship row exists.",
          default: false,
        },
      },
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: RelationshipTypeConfig,
  ): Promise<EligibilityResult> {
    const allowed = config.allowedRelationTypeIds ?? [];
    const allowSelf = config.allowSelf === true;
    const isSelf = context.subscriberWorker.id === context.dependentWorker.id;

    if (isSelf) {
      if (allowSelf) {
        return {
          eligible: true,
          reason: "Subscriber is the dependent and self is allowed",
        };
      }
      return {
        eligible: false,
        reason: "Subscriber is the dependent and self is not allowed",
      };
    }

    const asOfDate = endOfMonth(context.asOfYear, context.asOfMonth);
    const asOfStr = formatDate(asOfDate);

    const relation = await storage.workerRelations.findActiveBetween(
      context.subscriberWorker.id,
      context.dependentWorker.id,
      asOfDate,
    );

    if (!relation) {
      return {
        eligible: false,
        reason: `No active relationship between subscriber and dependent on ${asOfStr}`,
      };
    }

    if (allowed.includes(relation.relationType)) {
      const typeName = await lookupRelationTypeName(relation.relationType);
      return {
        eligible: true,
        reason: `Active "${typeName}" relationship on ${asOfStr}`,
      };
    }

    const [actualName, allowedNames] = await Promise.all([
      lookupRelationTypeName(relation.relationType),
      lookupAllowedNames(allowed),
    ]);
    return {
      eligible: false,
      reason: `Active relationship type "${actualName}" is not in the allowed list: ${allowedNames}`,
    };
  }
}

const plugin = new RelationshipTypePlugin();
registerEligibilityPlugin(plugin);

export { RelationshipTypePlugin };
