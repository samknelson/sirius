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
import { toOrdinal } from "./bao-shared";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

const DEFAULT_ALTERNATE_MONTHS = 24;

/**
 * Raw config as persisted on the rule. Both criteria are OR'd; each is
 * only enforced when fully configured.
 */
interface BaoStartDeltaConfig extends BaseEligibilityConfig {
  priorDelta?: {
    benefitTypeId?: string;
  };
  alternateDental?: {
    benefitTypeIds?: string[];
    months?: number;
  };
}

/** Flattened, shape-agnostic view of the config used by validate/evaluate. */
interface NormalizedConfig {
  deltaBenefitTypeId?: string;
  alternateBenefitTypeIds?: string[];
  alternateMonths?: number;
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartDeltaConfig;
  return {
    deltaBenefitTypeId: c.priorDelta?.benefitTypeId,
    alternateBenefitTypeIds: c.alternateDental?.benefitTypeIds,
    alternateMonths: c.alternateDental?.months,
  };
}

function isPriorDeltaConfigured(n: NormalizedConfig): boolean {
  return typeof n.deltaBenefitTypeId === "string" && n.deltaBenefitTypeId.length > 0;
}

function isAlternateConfigured(n: NormalizedConfig): boolean {
  return (
    Array.isArray(n.alternateBenefitTypeIds) &&
    n.alternateBenefitTypeIds.length > 0 &&
    typeof n.alternateMonths === "number" &&
    Number.isInteger(n.alternateMonths) &&
    n.alternateMonths >= 1
  );
}

function monthLabel(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  const name = new Date(2000, month - 1, 1).toLocaleString("default", { month: "short" });
  return `${name} ${year}`;
}

/**
 * Shape of the subset of `storage.trust.wmb.getWorkerBenefits` rows the
 * plugin depends on. Other columns exist on the row but are not consumed.
 */
interface BenefitHistoryRow {
  month: number;
  year: number;
  benefit?: { benefitType?: string | null } | null;
}

class BaoStartDeltaPlugin extends EligibilityPlugin<BaoStartDeltaConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-delta",
    name: "BAO - Start Delta",
    description:
      "Trustee-approved Delta Dental election rule. A subscriber is eligible if they meet ANY ONE of the following criteria (each is checked only when configured):\n" +
      "1. Prior Delta coverage — the subscriber held any benefit of the chosen Delta benefit type in at least ONE month before the evaluated date (even a single month qualifies, at this and all subsequent open enrollments).\n" +
      "2. Continuous alternate dental — the subscriber held a benefit of ANY of the chosen alternate dental types (e.g. Liberty, UHDC) in EVERY one of the preceding months (default 24) immediately before the evaluated date.\n" +
      "New enrollees with no qualifying history are never eligible for Delta; they choose among the alternate dental plans instead.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        priorDelta: {
          type: "object",
          title: "Criterion 1 — Prior Delta coverage",
          description:
            "Eligible if the worker held any benefit of the chosen Delta benefit type in at least one month before the evaluated date. Set the field to enable; leave unset to skip.",
          properties: {
            benefitTypeId: {
              type: "string",
              title: "Delta benefit type",
              description: "Pick the benefit type that counts as Delta Dental.",
              "x-options-resource": "trust-benefit-type",
            },
          },
        },
        alternateDental: {
          type: "object",
          title: "Criterion 2 — Continuous alternate dental coverage",
          description:
            "Eligible if the worker held any benefit of ANY of the chosen alternate dental types (Liberty, UHDC) in EVERY one of the preceding months (counting back from the evaluated date). Set both fields to enable; leave unset to skip.",
          properties: {
            benefitTypeIds: {
              type: "array",
              title: "Alternate dental benefit types",
              description:
                "Pick the benefit types that count as alternate dental (e.g. Liberty, UHDC). Coverage under any of them counts toward the consecutive-month requirement.",
              items: {
                type: "string",
              },
              "x-options-resource": "trust-benefit-type",
            },
            months: {
              type: "integer",
              title: "Required preceding months",
              description:
                "How many consecutive months immediately before the evaluated date must each have alternate dental coverage.",
              minimum: 1,
              default: DEFAULT_ALTERNATE_MONTHS,
            },
          },
        },
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;

    const n = normalizeConfig(config);

    // Prior Delta: when configured, the chosen benefit type must exist.
    if (isPriorDeltaConfigured(n)) {
      const benefitType = await unifiedOptionsStorage.get(
        "trust-benefit-type",
        n.deltaBenefitTypeId!,
      );
      if (!benefitType) {
        return {
          valid: false,
          errors: [`Prior Delta criterion: unknown benefit type (${n.deltaBenefitTypeId})`],
        };
      }
    }

    // Alternate dental: when configured, every chosen benefit type must exist.
    if (isAlternateConfigured(n)) {
      for (const id of n.alternateBenefitTypeIds!) {
        const benefitType = await unifiedOptionsStorage.get("trust-benefit-type", id);
        if (!benefitType) {
          return {
            valid: false,
            errors: [`Alternate dental criterion: unknown benefit type (${id})`],
          };
        }
      }
    }

    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartDeltaConfig,
  ): Promise<EligibilityResult> {
    const n = normalizeConfig(config);

    const priorDelta = isPriorDeltaConfigured(n);
    const alternate = isAlternateConfigured(n);

    if (!priorDelta && !alternate) {
      return {
        eligible: false,
        reason:
          "Not eligible — the rule has no criterion configured. Configure the Delta benefit type and/or the alternate dental types.",
      };
    }

    const failures: string[] = [];

    // Benefit history is needed by both criteria; load it once. All
    // comparisons use the month BEFORE the as-of month as the upper bound
    // (the as-of month itself is excluded, matching the Kaiser window).
    const rows = (await storage.trust.wmb.getWorkerBenefits(
      context.subscriberWorker.id,
    )) as BenefitHistoryRow[];
    const asOfOrdinal = toOrdinal(context.asOfYear, context.asOfMonth);

    // Criterion 1 — Prior Delta coverage: ANY month strictly before the
    // evaluated date with a benefit of the Delta type.
    if (priorDelta) {
      const deltaOrdinals = rows
        .filter((r) => r.benefit?.benefitType === n.deltaBenefitTypeId)
        .map((r) => toOrdinal(r.year, r.month))
        .filter((ord) => ord < asOfOrdinal);
      if (deltaOrdinals.length > 0) {
        const earliest = Math.min(...deltaOrdinals);
        const latest = Math.max(...deltaOrdinals);
        return {
          eligible: true,
          reason: `Eligible (prior Delta coverage): worker held the Delta benefit type in ${deltaOrdinals.length} prior ${deltaOrdinals.length === 1 ? "month" : "months"} (${monthLabel(earliest)}${earliest === latest ? "" : ` → ${monthLabel(latest)}`}), before ${monthLabel(asOfOrdinal)} — any prior Delta month qualifies at this and all subsequent open enrollments`,
        };
      }
      failures.push(
        `Prior Delta coverage: worker has never held the Delta benefit type in any month before ${monthLabel(asOfOrdinal)}`,
      );
    }

    // Criterion 2 — Continuous alternate dental across the preceding window.
    if (alternate) {
      const typeSet = new Set(n.alternateBenefitTypeIds!);
      const coveredOrdinals = new Set(
        rows
          .filter((r) => {
            const t = r.benefit?.benefitType;
            return typeof t === "string" && typeSet.has(t);
          })
          .map((r) => toOrdinal(r.year, r.month)),
      );

      // Window: the N consecutive months immediately preceding the as-of
      // month (the as-of month itself is excluded).
      const windowStart = asOfOrdinal - n.alternateMonths!; // inclusive
      const windowEnd = asOfOrdinal - 1; // inclusive

      const missing: number[] = [];
      for (let ord = windowStart; ord <= windowEnd; ord++) {
        if (!coveredOrdinals.has(ord)) missing.push(ord);
      }

      if (missing.length === 0) {
        return {
          eligible: true,
          reason: `Eligible (continuous alternate dental): worker held an alternate dental benefit type (Liberty/UHDC) in every one of the ${n.alternateMonths} months preceding ${monthLabel(asOfOrdinal)} (${monthLabel(windowStart)} → ${monthLabel(windowEnd)})`,
        };
      }

      const preview = missing.slice(0, 6).map(monthLabel).join(", ");
      const suffix = missing.length > 6 ? `, … (+${missing.length - 6} more)` : "";
      failures.push(
        `Continuous alternate dental: ${missing.length} of the ${n.alternateMonths} preceding months had no alternate dental coverage (missing: ${preview}${suffix})`,
      );
    }

    return {
      eligible: false,
      reason: `Not eligible — no criterion was met. ${failures.join(". ")}.`,
    };
  }
}

const plugin = new BaoStartDeltaPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartDeltaPlugin };
