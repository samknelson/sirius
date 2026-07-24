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
  toOrdinal,
  measureDistance,
  getPrimaryCoords,
  continuousCoverageSchema,
  isContinuousCoverageConfigured,
  validateContinuousCoverage,
  evaluateContinuousCoverage,
} from "./bao-shared";

const DEFAULT_CONTINUOUS_MONTHS = 24;

/**
 * Raw config as persisted on the rule. Both criteria are OR'd; each is
 * only enforced when fully configured.
 */
interface BaoStartDeltaConfig extends BaseEligibilityConfig {
  priorBenefits?: {
    benefitIds?: string[];
  };
  continuousCoverage?: {
    benefitTypeId?: string;
    months?: number;
  };
  // Legacy shape (pre benefit-type): specific benefits whose types are
  // resolved at evaluate/validate time. Read for backward compat only.
  continuousBenefits?: {
    benefitIds?: string[];
    months?: number;
  };
  geographic?: {
    distanceMiles?: number;
    facilityIds?: string[];
  };
}

/** Flattened, shape-agnostic view of the config used by validate/evaluate. */
interface NormalizedConfig {
  priorBenefitIds?: string[];
  continuousBenefitTypeId?: string;
  legacyContinuousBenefitIds?: string[];
  continuousMonths?: number;
  distanceMiles?: number;
  facilityIds?: string[];
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartDeltaConfig;
  return {
    priorBenefitIds: c.priorBenefits?.benefitIds,
    continuousBenefitTypeId: c.continuousCoverage?.benefitTypeId,
    legacyContinuousBenefitIds: c.continuousBenefits?.benefitIds,
    continuousMonths: c.continuousCoverage?.months ?? c.continuousBenefits?.months,
    distanceMiles: c.geographic?.distanceMiles,
    facilityIds: c.geographic?.facilityIds,
  };
}

function isLegacyContinuousConfigured(n: NormalizedConfig): boolean {
  return (
    !n.continuousBenefitTypeId &&
    Array.isArray(n.legacyContinuousBenefitIds) &&
    n.legacyContinuousBenefitIds.length > 0 &&
    typeof n.continuousMonths === "number" &&
    Number.isInteger(n.continuousMonths) &&
    n.continuousMonths >= 1
  );
}

/**
 * Resolve the benefit types of a legacy config's benefit list. Unknown
 * benefits and benefits without a type are skipped.
 */
async function resolveLegacyBenefitTypes(benefitIds: string[]): Promise<string[]> {
  const typeIds = new Set<string>();
  for (const id of benefitIds) {
    const benefit = await storage.trustBenefits.getTrustBenefit(id);
    if (benefit?.benefitType) typeIds.add(benefit.benefitType);
  }
  return Array.from(typeIds);
}

function isPriorConfigured(n: NormalizedConfig): boolean {
  return Array.isArray(n.priorBenefitIds) && n.priorBenefitIds.length > 0;
}

function isGeographicConfigured(n: NormalizedConfig): boolean {
  return (
    typeof n.distanceMiles === "number" &&
    n.distanceMiles > 0 &&
    Array.isArray(n.facilityIds) &&
    n.facilityIds.length > 0
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
  benefitId?: string | null;
}

class BaoStartDeltaPlugin extends EligibilityPlugin<BaoStartDeltaConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-delta",
    name: "BAO - Start Delta",
    description:
      "Trustee-approved Delta Dental election rule. A subscriber is eligible if they meet ANY ONE of the following criteria (each is checked only when configured):\n" +
      "1. Prior coverage — the subscriber held ANY of the selected benefits in at least ONE month before the evaluated date (even a single month qualifies, at this and all subsequent open enrollments).\n" +
      "2. Continuous coverage — the subscriber has held any benefit of the chosen type for the required number of consecutive months (default 24) at some point on or before the evaluated date.\n" +
      "3. Outside the dental service area — the subscriber's primary address is MORE than the chosen distance from EVERY selected site (same geographic test as the Healthnet rule; driving distance preferred, straight-line fallback).\n" +
      "New enrollees inside the service area with no qualifying history are not eligible for Delta; they choose among the alternate dental plans instead.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        priorBenefits: {
          type: "object",
          title: "Criterion 1 — Prior coverage of this benefit",
          description:
            "Eligible if the worker held ANY of the selected benefits in at least one month before the evaluated date. Select at least one benefit to enable; leave empty to skip.",
          properties: {
            benefitIds: {
              type: "array",
              title: "Benefits",
              description:
                "Pick the benefit(s) that count (e.g. the Delta Dental benefits). Any single prior month with any of them qualifies.",
              items: {
                type: "string",
              },
              "x-options-resource": "trust-benefit",
            },
          },
        },
        continuousCoverage: continuousCoverageSchema(2, DEFAULT_CONTINUOUS_MONTHS),
        geographic: {
          type: "object",
          title: "Criterion 3 — Outside the dental service area",
          description:
            "Eligible if the worker's primary address is MORE than this distance from EVERY selected site. Set both fields to enable; leave unset to skip.",
          properties: {
            distanceMiles: {
              type: "number",
              title: "Distance (miles)",
              description:
                "Worker is eligible if their primary address is more than this many miles from every chosen site.",
              exclusiveMinimum: 0,
              default: 20,
            },
            facilityIds: {
              type: "array",
              title: "Sites",
              description:
                "Choose one or more facilities. The worker must live more than the configured distance from every one of them.",
              items: {
                type: "string",
              },
              "x-options-resource": "facility",
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

    // Prior coverage: when configured, every chosen benefit must exist.
    if (isPriorConfigured(n)) {
      for (const id of n.priorBenefitIds!) {
        const benefit = await storage.trustBenefits.getTrustBenefit(id);
        if (!benefit) {
          return {
            valid: false,
            errors: [`Prior coverage criterion: unknown benefit (${id})`],
          };
        }
      }
    }

    // Continuous coverage: when configured, the chosen benefit type must exist.
    const cc = { benefitTypeId: n.continuousBenefitTypeId, months: n.continuousMonths };
    if (isContinuousCoverageConfigured(cc)) {
      const error = await validateContinuousCoverage(cc);
      if (error) return { valid: false, errors: [error] };
    }

    // Geographic: when configured, every chosen site must exist.
    if (isGeographicConfigured(n)) {
      for (const id of n.facilityIds!) {
        const facility = await storage.facilities.get(id);
        if (!facility) {
          return { valid: false, errors: [`Service-area criterion: unknown site (${id})`] };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Evaluate the geographic criterion: met when the worker lives MORE than
   * the configured distance from EVERY chosen site (outside the dental
   * service area). Missing/ungeocoded addresses (worker or site) mean the
   * criterion cannot be confirmed, so it is reported as not met rather than
   * throwing — the other criteria may still grant eligibility.
   */
  private async evaluateGeographic(
    contactId: string,
    distanceMiles: number,
    facilityIds: string[],
  ): Promise<{ met: boolean; reason: string }> {
    const workerCoords = await getPrimaryCoords(contactId);
    if (workerCoords.status === "no-address") {
      return { met: false, reason: "worker has no primary address, so distance from the chosen sites cannot be determined" };
    }
    if (workerCoords.status === "not-geocoded") {
      return { met: false, reason: "worker's primary address has not been geocoded, so distance from the chosen sites cannot be determined" };
    }

    // Measure EVERY chosen site before deciding, so a missing address /
    // geocode on any site is surfaced and the reason can name the closest
    // site deterministically. "Outside the service area" requires being
    // beyond the limit from every site, so any unmeasurable site means the
    // criterion cannot be confirmed.
    const distanceCache = new Map<string, { distance: number; method: string }>();
    const measured: { name: string; distance: number; method: string }[] = [];
    for (const facilityId of facilityIds) {
      const facility = await storage.facilities.get(facilityId);
      if (!facility) {
        return { met: false, reason: `configured site (${facilityId}) no longer exists, so the service-area criterion cannot be confirmed` };
      }
      const facilityCoords = await getPrimaryCoords(facility.contactId);
      if (facilityCoords.status === "no-address") {
        return { met: false, reason: `site "${facility.name}" has no address, so distance to it cannot be confirmed` };
      }
      if (facilityCoords.status === "not-geocoded") {
        return { met: false, reason: `site "${facility.name}" has not been geocoded, so distance to it cannot be confirmed` };
      }
      const { distance, method } = await measureDistance(
        workerCoords.coords,
        facilityCoords.coords,
        distanceCache,
      );
      measured.push({ name: facility.name, distance, method });
    }

    const nearest = measured.reduce((a, b) => (b.distance < a.distance ? b : a));
    if (nearest.distance <= distanceMiles) {
      return {
        met: false,
        reason: `worker is ${nearest.distance.toFixed(1)} miles from ${nearest.name} by ${nearest.method}, which is within the ${distanceMiles} mile service area`,
      };
    }
    return {
      met: true,
      reason: `worker is more than ${distanceMiles} miles from all ${measured.length} chosen ${measured.length === 1 ? "site" : "sites"} (nearest: ${nearest.name} at ${nearest.distance.toFixed(1)} miles by ${nearest.method})`,
    };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartDeltaConfig,
  ): Promise<EligibilityResult> {
    const n = normalizeConfig(config);

    const prior = isPriorConfigured(n);
    const cc = { benefitTypeId: n.continuousBenefitTypeId, months: n.continuousMonths };
    const legacyContinuous = isLegacyContinuousConfigured(n);
    const continuous = isContinuousCoverageConfigured(cc) || legacyContinuous;
    const geographic = isGeographicConfigured(n);

    if (!prior && !continuous && !geographic) {
      return {
        eligible: false,
        reason:
          "Not eligible — the rule has no criterion configured. Configure the prior-coverage benefits, the continuous-coverage benefits, and/or the service-area distance and sites.",
      };
    }

    const failures: string[] = [];

    const rows = (await storage.trust.wmb.getWorkerBenefits(
      context.subscriberWorker.id,
    )) as BenefitHistoryRow[];
    const asOfOrdinal = toOrdinal(context.asOfYear, context.asOfMonth);

    // Criterion 1 — Prior coverage: ANY month strictly before the
    // evaluated date with any of the selected benefits.
    if (prior) {
      const priorSet = new Set(n.priorBenefitIds!);
      const priorOrdinals = rows
        .filter((r) => typeof r.benefitId === "string" && priorSet.has(r.benefitId))
        .map((r) => toOrdinal(r.year, r.month))
        .filter((ord) => ord < asOfOrdinal);
      if (priorOrdinals.length > 0) {
        const earliest = Math.min(...priorOrdinals);
        const latest = Math.max(...priorOrdinals);
        return {
          eligible: true,
          reason: `Eligible (prior coverage): worker held one of the selected benefits in ${priorOrdinals.length} prior ${priorOrdinals.length === 1 ? "month" : "months"} (${monthLabel(earliest)}${earliest === latest ? "" : ` → ${monthLabel(latest)}`}), before ${monthLabel(asOfOrdinal)} — any prior month qualifies at this and all subsequent open enrollments`,
        };
      }
      failures.push(
        `Prior coverage: worker has never held any of the selected benefits in any month before ${monthLabel(asOfOrdinal)}`,
      );
    }

    // Criterion 2 — Continuous coverage (shared BAO criterion). Legacy
    // configs listed specific benefits; their types are resolved so old
    // rules keep working until re-saved with a benefit type.
    if (continuous) {
      const benefitTypeIds = isContinuousCoverageConfigured(cc)
        ? [cc.benefitTypeId]
        : await resolveLegacyBenefitTypes(n.legacyContinuousBenefitIds!);
      if (benefitTypeIds.length === 0) {
        failures.push(
          "Continuous coverage: none of the legacy configured benefits has a benefit type — re-save the rule with a benefit type",
        );
      } else {
        const result = await evaluateContinuousCoverage({
          workerId: context.subscriberWorker.id,
          benefitTypeIds,
          months: n.continuousMonths!,
          asOfYear: context.asOfYear,
          asOfMonth: context.asOfMonth,
        });
        if (result.met) {
          return { eligible: true, reason: `Eligible (continuous coverage): ${result.reason}` };
        }
        failures.push(`Continuous coverage: ${result.reason}`);
      }
    }

    // Criterion 3 — Outside the dental service area: more than the
    // configured distance from EVERY chosen site.
    if (geographic) {
      const geo = await this.evaluateGeographic(
        context.subscriberWorker.contactId,
        n.distanceMiles!,
        n.facilityIds!,
      );
      if (geo.met) {
        return {
          eligible: true,
          reason: `Eligible (outside dental service area): ${geo.reason}`,
        };
      }
      failures.push(`Outside dental service area: ${geo.reason}`);
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
