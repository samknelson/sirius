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

const DEFAULT_MEDICAL_MONTHS = 24;

/**
 * Raw config as persisted on the rule. Both criteria are optional and
 * independent (OR). A criterion is only enforced when it is fully
 * configured.
 */
interface BaoStartKaiserConfig extends BaseEligibilityConfig {
  medical?: {
    benefitTypeId?: string;
    months?: number;
  };
  immediateEligibility?: {
    enabled?: boolean;
  };
}

/** Flattened, shape-agnostic view of the config used by validate/evaluate. */
interface NormalizedConfig {
  medicalBenefitTypeId?: string;
  medicalMonths?: number;
  immediateEligibilityEnabled?: boolean;
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartKaiserConfig;
  return {
    medicalBenefitTypeId: c.medical?.benefitTypeId,
    medicalMonths: c.medical?.months,
    immediateEligibilityEnabled: c.immediateEligibility?.enabled === true,
  };
}

function isMedicalConfigured(n: NormalizedConfig): boolean {
  return (
    typeof n.medicalBenefitTypeId === "string" &&
    n.medicalBenefitTypeId.length > 0 &&
    typeof n.medicalMonths === "number" &&
    Number.isInteger(n.medicalMonths) &&
    n.medicalMonths >= 1
  );
}

function isImmediateEligibilityConfigured(n: NormalizedConfig): boolean {
  return n.immediateEligibilityEnabled === true;
}

function ymdFromYearMonth(asOfYear: number, asOfMonth: number): string {
  // Last day of the asOf month — matches the executor's as-of convention.
  const d = new Date(asOfYear, asOfMonth, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

/** year/month → a single comparable ordinal (months since year 0). */
function toOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function monthLabel(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = (ordinal % 12) + 1;
  const name = new Date(2000, month - 1, 1).toLocaleString("default", { month: "short" });
  return `${name} ${year}`;
}

/**
 * Shape of the subset of `storage.workers.getWorkerBenefits` rows that the
 * continuous-medical criterion depends on. Other columns exist on the row but
 * are not consumed here.
 */
interface BenefitHistoryRow {
  benefitId: string;
  month: number;
  year: number;
  benefit?: { benefitType?: string | null } | null;
}

class BaoStartKaiserPlugin extends EligibilityPlugin<BaoStartKaiserConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-kaiser",
    name: "BAO - Start Kaiser",
    description:
      "A subscriber is eligible if they meet ANY ONE of the following criteria (only configured criteria are checked):\n" +
      "1. Continuous medical — the subscriber held a benefit of the chosen Medical type in EVERY one of the preceding months (default 24) immediately before the evaluated date.\n" +
      "2. Employer immediate-eligibility — the subscriber's employer is inside an immediate-eligibility window covering the evaluated date.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        medical: {
          type: "object",
          title: "Criterion 1 — Continuous medical coverage",
          description:
            "Eligible if the worker held any benefit of the chosen Medical type in EVERY one of the preceding months (counting back from the evaluated date). Set both fields to enable; leave unset to skip.",
          properties: {
            benefitTypeId: {
              type: "string",
              title: "Medical benefit type",
              description: "Pick the benefit type that counts as Medical.",
              "x-options-resource": "trust-benefit-type",
            },
            months: {
              type: "integer",
              title: "Required preceding months",
              description:
                "How many consecutive months immediately before the evaluated date must each have medical coverage.",
              minimum: 1,
              default: DEFAULT_MEDICAL_MONTHS,
            },
          },
        },
        immediateEligibility: {
          type: "object",
          title: "Criterion 2 — Employer immediate-eligibility period",
          description:
            "Eligible if the subscriber's employer is inside an immediate-eligibility window covering the evaluated date. Turn this on to enable the criterion; leave it off to skip it.",
          properties: {
            enabled: {
              type: "boolean",
              title: "Enable employer immediate-eligibility",
              description:
                "When on, a worker qualifies if their resolved employer has an immediate-eligibility window covering the evaluated date.",
              default: false,
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

    // Medical: when configured, the chosen benefit type must exist.
    if (isMedicalConfigured(n)) {
      const benefitType = await unifiedOptionsStorage.get(
        "trust-benefit-type",
        n.medicalBenefitTypeId!,
      );
      if (!benefitType) {
        return {
          valid: false,
          errors: [`Medical criterion: unknown benefit type (${n.medicalBenefitTypeId})`],
        };
      }
    }

    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartKaiserConfig,
  ): Promise<EligibilityResult> {
    const n = normalizeConfig(config);

    const medical = isMedicalConfigured(n);
    const immediate = isImmediateEligibilityConfigured(n);

    if (!medical && !immediate) {
      return {
        eligible: false,
        reason: "BAO - Start Kaiser is misconfigured: no eligibility criteria are configured",
      };
    }

    const failures: string[] = [];

    // Criterion 1 — Continuous medical coverage across the preceding window.
    if (medical) {
      const rows = (await storage.workers.getWorkerBenefits(
        context.subscriberWorker.id,
      )) as BenefitHistoryRow[];
      const coveredOrdinals = new Set(
        rows
          .filter((r) => r.benefit?.benefitType === n.medicalBenefitTypeId)
          .map((r) => toOrdinal(r.year, r.month)),
      );

      // Window: the N consecutive months immediately preceding the as-of
      // month (the as-of month itself is excluded).
      const asOfOrdinal = toOrdinal(context.asOfYear, context.asOfMonth);
      const windowStart = asOfOrdinal - n.medicalMonths!; // inclusive
      const windowEnd = asOfOrdinal - 1; // inclusive

      const missing: number[] = [];
      for (let ord = windowStart; ord <= windowEnd; ord++) {
        if (!coveredOrdinals.has(ord)) missing.push(ord);
      }

      if (missing.length === 0) {
        return {
          eligible: true,
          reason: `Eligible (continuous medical): worker held the chosen medical benefit type in every one of the ${n.medicalMonths} months preceding ${monthLabel(asOfOrdinal)} (${monthLabel(windowStart)} → ${monthLabel(windowEnd)})`,
        };
      }

      const preview = missing.slice(0, 6).map(monthLabel).join(", ");
      const suffix = missing.length > 6 ? `, … (+${missing.length - 6} more)` : "";
      failures.push(
        `Continuous medical: ${missing.length} of the ${n.medicalMonths} preceding months had no medical coverage (missing: ${preview}${suffix})`,
      );
    }

    // Criterion 2 — Employer immediate-eligibility window.
    if (immediate) {
      const employer = context.employer;
      if (!employer) {
        failures.push(
          "Employer immediate-eligibility: no employer could be resolved for the subscriber on the evaluated date",
        );
      } else {
        const asOfYmd = ymdFromYearMonth(context.asOfYear, context.asOfMonth);
        const window = await storage.baoImmediateEligibility.getByEmployerId(employer.id);
        if (window && window.startYmd <= asOfYmd && window.endYmd >= asOfYmd) {
          return {
            eligible: true,
            reason: `Eligible (employer immediate-eligibility): employer "${employer.name}" is within an immediate-eligibility window (${window.startYmd} → ${window.endYmd}) covering ${asOfYmd}`,
          };
        }
        if (window) {
          failures.push(
            `Employer immediate-eligibility: employer "${employer.name}" has a window (${window.startYmd} → ${window.endYmd}) that does not cover ${asOfYmd}`,
          );
        } else {
          failures.push(
            `Employer immediate-eligibility: employer "${employer.name}" has no immediate-eligibility window`,
          );
        }
      }
    }

    return {
      eligible: false,
      reason: `Not eligible — no criterion was met. ${failures.join(". ")}.`,
    };
  }
}

const plugin = new BaoStartKaiserPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartKaiserPlugin };
