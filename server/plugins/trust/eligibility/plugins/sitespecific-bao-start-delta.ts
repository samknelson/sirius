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
import { toOrdinal, measureDistance, getPrimaryCoords } from "./bao-shared";

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
  geographic?: {
    distanceMiles?: number;
    facilityIds?: string[];
  };
}

/** Flattened, shape-agnostic view of the config used by validate/evaluate. */
interface NormalizedConfig {
  deltaBenefitTypeId?: string;
  alternateBenefitTypeIds?: string[];
  alternateMonths?: number;
  distanceMiles?: number;
  facilityIds?: string[];
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartDeltaConfig;
  return {
    deltaBenefitTypeId: c.priorDelta?.benefitTypeId,
    alternateBenefitTypeIds: c.alternateDental?.benefitTypeIds,
    alternateMonths: c.alternateDental?.months,
    distanceMiles: c.geographic?.distanceMiles,
    facilityIds: c.geographic?.facilityIds,
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
      "3. Outside the dental service area — the subscriber's primary address is MORE than the chosen distance from EVERY selected site (same geographic test as the Healthnet rule; driving distance preferred, straight-line fallback).\n" +
      "New enrollees inside the service area with no qualifying history are not eligible for Delta; they choose among the alternate dental plans instead.",
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

    const priorDelta = isPriorDeltaConfigured(n);
    const alternate = isAlternateConfigured(n);
    const geographic = isGeographicConfigured(n);

    if (!priorDelta && !alternate && !geographic) {
      return {
        eligible: false,
        reason:
          "Not eligible — the rule has no criterion configured. Configure the Delta benefit type, the alternate dental types, and/or the service-area distance and sites.",
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
