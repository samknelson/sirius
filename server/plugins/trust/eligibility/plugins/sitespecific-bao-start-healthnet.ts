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
import { distanceInMiles, type Coordinates } from "@shared/utils/geocode";

const unifiedOptionsStorage = createUnifiedOptionsStorage();

/**
 * Raw config as persisted on the rule. New configs use the nested
 * per-criterion shape below; older configs stored `distanceMiles` and
 * `facilityIds` at the top level (when only the geographic criterion
 * existed). `normalizeConfig` reads both so existing rules keep working.
 */
interface BaoStartHealthnetConfig extends BaseEligibilityConfig {
  geographic?: {
    distanceMiles?: number;
    facilityIds?: string[];
  };
  healthnet?: {
    benefitId?: string;
  };
  medical?: {
    benefitTypeId?: string;
    months?: number;
  };
  // Legacy top-level fields (pre-nesting). Read for backward compat only.
  distanceMiles?: number;
  facilityIds?: string[];
}

/** Flattened, shape-agnostic view of the config used by validate/evaluate. */
interface NormalizedConfig {
  distanceMiles?: number;
  facilityIds?: string[];
  healthnetBenefitId?: string;
  medicalBenefitTypeId?: string;
  medicalMonths?: number;
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartHealthnetConfig;
  return {
    distanceMiles: c.geographic?.distanceMiles ?? c.distanceMiles,
    facilityIds: c.geographic?.facilityIds ?? c.facilityIds,
    healthnetBenefitId: c.healthnet?.benefitId,
    medicalBenefitTypeId: c.medical?.benefitTypeId,
    medicalMonths: c.medical?.months,
  };
}

function isGeographicConfigured(n: NormalizedConfig): boolean {
  return (
    typeof n.distanceMiles === "number" &&
    n.distanceMiles > 0 &&
    Array.isArray(n.facilityIds) &&
    n.facilityIds.length > 0
  );
}

function isHealthnetConfigured(n: NormalizedConfig): boolean {
  return typeof n.healthnetBenefitId === "string" && n.healthnetBenefitId.length > 0;
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

function ymdFromYearMonth(asOfYear: number, asOfMonth: number): string {
  // Last day of the asOf month — matches the executor's as-of convention.
  const d = new Date(asOfYear, asOfMonth, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

type CoordsLookup =
  | { status: "ok"; coords: Coordinates }
  | { status: "no-address" }
  | { status: "not-geocoded" };

/**
 * Resolve a contact's primary, active address coordinates. Returns a
 * discriminated result so callers can produce explanatory failure
 * messages rather than throwing when an address is missing or has not
 * been geocoded.
 */
async function getPrimaryCoords(contactId: string): Promise<CoordsLookup> {
  const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
  const primary = addresses.find((a) => a.isPrimary && a.isActive);
  if (!primary) return { status: "no-address" };
  if (primary.latitude == null || primary.longitude == null) {
    return { status: "not-geocoded" };
  }
  return {
    status: "ok",
    coords: { latitude: primary.latitude, longitude: primary.longitude },
  };
}

/**
 * Shape of the subset of `storage.workers.getWorkerBenefits` rows that the
 * HealthNet and continuous-medical criteria depend on. Other columns exist on
 * the row but are not consumed here.
 */
interface BenefitHistoryRow {
  benefitId: string;
  month: number;
  year: number;
  benefit?: { benefitType?: string | null } | null;
}

/**
 * Longest run of consecutive calendar months across the given rows.
 * Each (year, month) is mapped to an ordinal (year * 12 + month - 1),
 * de-duplicated, sorted, and scanned for the longest streak of
 * consecutive ordinals. Returns 0 when there are no rows.
 */
function longestConsecutiveMonths(rows: Array<{ month: number; year: number }>): number {
  const ordinals = Array.from(
    new Set(rows.map((r) => r.year * 12 + (r.month - 1))),
  ).sort((a, b) => a - b);
  if (ordinals.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < ordinals.length; i++) {
    if (ordinals[i] === ordinals[i - 1] + 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}

class BaoStartHealthnetPlugin extends EligibilityPlugin<BaoStartHealthnetConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-healthnet",
    name: "BAO - Start Healthnet",
    description:
      "A subscriber is eligible if they meet ANY ONE of the following criteria (criteria 1–3 are checked only when configured; criterion 4 is always checked):\n" +
      "1. Geographic — primary address is more than the chosen distance from every selected site.\n" +
      "2. Ever had HealthNet — the subscriber has at any point held the benefit designated as HealthNet.\n" +
      "3. Continuous medical — the subscriber has held a benefit of the chosen Medical type for the required number of consecutive months at any point in their history.\n" +
      "4. Employer immediate-eligibility (always checked) — the subscriber's employer is inside an immediate-eligibility window covering the evaluated date.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        geographic: {
          type: "object",
          title: "Criterion 1 — Geographic distance",
          description:
            "Eligible if the worker's primary address is MORE than the chosen distance from every selected site. Leave the sites empty to skip this criterion.",
          properties: {
            distanceMiles: {
              type: "number",
              title: "Distance (miles)",
              description:
                "Worker is eligible only if their primary address is MORE than this many miles from every chosen site.",
              exclusiveMinimum: 0,
              default: 10,
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
        healthnet: {
          type: "object",
          title: "Criterion 2 — Ever had HealthNet",
          description:
            "Eligible if the worker has EVER held the benefit designated as HealthNet. Leave unset to skip this criterion.",
          properties: {
            benefitId: {
              type: "string",
              title: "HealthNet benefit",
              description: "Pick the single benefit that counts as HealthNet.",
              "x-options-resource": "trust-benefit",
            },
          },
        },
        medical: {
          type: "object",
          title: "Criterion 3 — Continuous medical coverage",
          description:
            "Eligible if the worker has held any benefit of the chosen Medical type for the required number of consecutive months at any point in their history. Set both fields to enable; leave unset to skip.",
          properties: {
            benefitTypeId: {
              type: "string",
              title: "Medical benefit type",
              description: "Pick the benefit type that counts as Medical.",
              "x-options-resource": "trust-benefit-type",
            },
            months: {
              type: "integer",
              title: "Required consecutive months",
              description: "How many unbroken months of medical coverage are required.",
              minimum: 1,
              default: 6,
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

    // Criteria are independent (OR). A group is only enforced when it is
    // fully configured; a partially-filled group (including one left at
    // its schema defaults, e.g. distance=10 with no sites, or months=6
    // with no medical type) is treated as "not configured" and skipped —
    // exactly as `evaluate` skips it. This keeps single-criterion setups
    // (e.g. HealthNet only) valid. Field-level shape (distance > 0,
    // months integer >= 1, site entries are strings) is already enforced
    // by AJV in `super.validateConfig`.

    // Geographic: when configured, every chosen site must exist.
    if (isGeographicConfigured(n)) {
      for (const id of n.facilityIds!) {
        const facility = await storage.facilities.get(id);
        if (!facility) {
          return { valid: false, errors: [`Geographic criterion: unknown site (${id})`] };
        }
      }
    }

    // HealthNet: when configured, the chosen benefit must exist.
    if (isHealthnetConfigured(n)) {
      const benefit = await storage.trustBenefits.getTrustBenefit(n.healthnetBenefitId!);
      if (!benefit) {
        return { valid: false, errors: [`HealthNet criterion: unknown benefit (${n.healthnetBenefitId})`] };
      }
    }

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

  /**
   * Evaluate the geographic criterion. Returns whether it is met plus a
   * human-readable reason. Missing/ungeocoded addresses (worker or site)
   * mean the criterion cannot be confirmed, so it is reported as not met
   * rather than throwing — other criteria may still grant eligibility.
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

    // Validate and measure EVERY chosen site before deciding, so a missing
    // address/geocode on any site is surfaced and the reason can name the
    // closest site deterministically.
    const measured: { name: string; distance: number }[] = [];
    for (const facilityId of facilityIds) {
      const facility = await storage.facilities.get(facilityId);
      if (!facility) {
        return { met: false, reason: `configured site (${facilityId}) no longer exists, so the geographic criterion cannot be confirmed` };
      }
      const facilityCoords = await getPrimaryCoords(facility.contactId);
      if (facilityCoords.status === "no-address") {
        return { met: false, reason: `site "${facility.name}" has no address, so distance to it cannot be confirmed` };
      }
      if (facilityCoords.status === "not-geocoded") {
        return { met: false, reason: `site "${facility.name}" has not been geocoded, so distance to it cannot be confirmed` };
      }
      measured.push({
        name: facility.name,
        distance: distanceInMiles(workerCoords.coords, facilityCoords.coords),
      });
    }

    const nearest = measured.reduce((a, b) => (b.distance < a.distance ? b : a));
    if (nearest.distance <= distanceMiles) {
      return {
        met: false,
        reason: `worker is ${nearest.distance.toFixed(1)} miles from ${nearest.name}, which is within the ${distanceMiles} mile limit`,
      };
    }
    return {
      met: true,
      reason: `worker is more than ${distanceMiles} miles from all ${measured.length} chosen ${measured.length === 1 ? "site" : "sites"} (nearest: ${nearest.name} at ${nearest.distance.toFixed(1)} miles)`,
    };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartHealthnetConfig,
  ): Promise<EligibilityResult> {
    const n = normalizeConfig(config);

    const geographic = isGeographicConfigured(n);
    const healthnet = isHealthnetConfigured(n);
    const medical = isMedicalConfigured(n);

    const failures: string[] = [];

    // Subscriber benefit history is needed by both the HealthNet and
    // medical criteria; load it at most once.
    let history: BenefitHistoryRow[] | undefined;
    const getHistory = async (): Promise<BenefitHistoryRow[]> => {
      if (history === undefined) {
        history = (await storage.workers.getWorkerBenefits(
          context.subscriberWorker.id,
        )) as BenefitHistoryRow[];
      }
      return history;
    };

    // Criterion 1 — Geographic
    if (geographic) {
      const result = await this.evaluateGeographic(
        context.subscriberWorker.contactId,
        n.distanceMiles!,
        n.facilityIds!,
      );
      if (result.met) {
        return { eligible: true, reason: `Eligible (geographic): ${result.reason}` };
      }
      failures.push(`Geographic: ${result.reason}`);
    }

    // Criterion 2 — Ever had HealthNet
    if (healthnet) {
      const rows = await getHistory();
      const hasHealthnet = rows.some((r) => r.benefitId === n.healthnetBenefitId);
      if (hasHealthnet) {
        return { eligible: true, reason: "Eligible (HealthNet): worker has previously held the designated HealthNet benefit" };
      }
      failures.push("HealthNet: worker has never held the designated HealthNet benefit");
    }

    // Criterion 3 — Continuous medical coverage
    if (medical) {
      const rows = await getHistory();
      const medicalRows = rows.filter((r) => r.benefit?.benefitType === n.medicalBenefitTypeId);
      const longestRun = longestConsecutiveMonths(medicalRows);
      if (longestRun >= n.medicalMonths!) {
        return {
          eligible: true,
          reason: `Eligible (continuous medical): worker held the chosen medical benefit type for ${longestRun} consecutive months (needs ${n.medicalMonths})`,
        };
      }
      failures.push(
        `Continuous medical: longest unbroken medical coverage is ${longestRun} ${longestRun === 1 ? "month" : "months"}, but ${n.medicalMonths} consecutive months are required`,
      );
    }

    // Criterion 4 — Employer immediate-eligibility window (always checked)
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

const plugin = new BaoStartHealthnetPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartHealthnetPlugin };
