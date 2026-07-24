import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import {
  continuousCoverageSchema,
  isContinuousCoverageConfigured,
  validateContinuousCoverage,
  evaluateContinuousCoverage,
} from "./bao-shared";

const DEFAULT_MONTHS = 24;

/**
 * Raw config as persisted on the rule. The continuous-coverage criterion is
 * optional and only enforced when fully configured; the employer
 * immediate-eligibility criterion is always evaluated (OR).
 */
interface BaoStartKaiserConfig extends BaseEligibilityConfig {
  medical?: {
    benefitTypeId?: string;
    months?: number;
  };
}

function normalizeContinuous(config: unknown): { benefitTypeId?: string; months?: number } {
  const c = (config ?? {}) as BaoStartKaiserConfig;
  return { benefitTypeId: c.medical?.benefitTypeId, months: c.medical?.months };
}

function ymdFromYearMonth(asOfYear: number, asOfMonth: number): string {
  // Last day of the asOf month — matches the executor's as-of convention.
  const d = new Date(asOfYear, asOfMonth, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

class BaoStartKaiserPlugin extends EligibilityPlugin<BaoStartKaiserConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-kaiser",
    name: "BAO - Start Kaiser",
    description:
      "A subscriber is eligible if they meet ANY ONE of the following criteria:\n" +
      "1. Continuous coverage (optional) — the subscriber has held any benefit of the chosen type for the required number of consecutive months (default 24) at some point on or before the evaluated date.\n" +
      "2. Employer immediate-eligibility (always checked) — the subscriber's employer is inside an immediate-eligibility window covering the evaluated date.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        medical: continuousCoverageSchema(1, DEFAULT_MONTHS),
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;

    // Continuous coverage: when configured, the chosen benefit type must exist.
    const cc = normalizeContinuous(config);
    if (isContinuousCoverageConfigured(cc)) {
      const error = await validateContinuousCoverage(cc);
      if (error) return { valid: false, errors: [error] };
    }

    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartKaiserConfig,
  ): Promise<EligibilityResult> {
    const cc = normalizeContinuous(config);
    const continuous = isContinuousCoverageConfigured(cc);

    const failures: string[] = [];

    // Criterion 1 — Continuous coverage (shared BAO criterion).
    if (continuous) {
      const result = await evaluateContinuousCoverage({
        workerId: context.subscriberWorker.id,
        benefitTypeIds: [cc.benefitTypeId],
        months: cc.months,
        asOfYear: context.asOfYear,
        asOfMonth: context.asOfMonth,
      });
      if (result.met) {
        return { eligible: true, reason: `Eligible (continuous coverage): ${result.reason}` };
      }
      failures.push(`Continuous coverage: ${result.reason}`);
    }

    // Criterion 2 — Employer immediate-eligibility window (always checked).
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

    return {
      eligible: false,
      reason: `Not eligible — no criterion was met. ${failures.join(". ")}.`,
    };
  }
}

const plugin = new BaoStartKaiserPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartKaiserPlugin };
