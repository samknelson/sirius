import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { measureDistance, getPrimaryCoords } from "./bao-shared";

/**
 * Raw config as persisted on the rule.
 */
interface BaoStartDentalConfig extends BaseEligibilityConfig {
  geographic?: {
    distanceMiles?: number;
    facilityIds?: string[];
  };
}

/** Flattened view of the config used by validate/evaluate. */
interface NormalizedConfig {
  distanceMiles?: number;
  facilityIds?: string[];
}

function normalizeConfig(config: unknown): NormalizedConfig {
  const c = (config ?? {}) as BaoStartDentalConfig;
  return {
    distanceMiles: c.geographic?.distanceMiles,
    facilityIds: c.geographic?.facilityIds,
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

class BaoStartDentalPlugin extends EligibilityPlugin<BaoStartDentalConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-dental",
    name: "BAO - Start Dental (service area)",
    description:
      "Service-area rule for the standard dental plans (Liberty, UHDC): new enrollees inside the service area choose between them.\n" +
      "A subscriber is eligible when their primary address is WITHIN the chosen distance (at or under the mile limit) of AT LEAST ONE selected site. " +
      "This is the geographic INVERSE of the Healthnet rule, which requires being MORE than the distance from every site. " +
      "Distances prefer real driving distance (Google Routes API) and fall back to straight-line measurement.",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      properties: {
        geographic: {
          type: "object",
          title: "Service area — Geographic distance",
          description:
            "Eligible if the worker's primary address is WITHIN this distance of at least one selected site.",
          properties: {
            distanceMiles: {
              type: "number",
              title: "Distance (miles)",
              description:
                "Worker is eligible if their primary address is this many miles or less from at least one chosen site.",
              exclusiveMinimum: 0,
              default: 10,
            },
            facilityIds: {
              type: "array",
              title: "Sites",
              description:
                "Choose one or more facilities. The worker must live within the configured distance of at least one of them.",
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

    if (!isGeographicConfigured(n)) {
      return {
        valid: false,
        errors: [
          "Service-area criterion: set both the distance and at least one site — this rule has no other criterion to fall back on.",
        ],
      };
    }

    for (const id of n.facilityIds!) {
      const facility = await storage.facilities.get(id);
      if (!facility) {
        return { valid: false, errors: [`Service-area criterion: unknown site (${id})`] };
      }
    }

    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartDentalConfig,
  ): Promise<EligibilityResult> {
    const n = normalizeConfig(config);

    if (!isGeographicConfigured(n)) {
      return {
        eligible: false,
        reason:
          "Not eligible — the service-area rule is not fully configured (needs a distance and at least one site).",
      };
    }

    const workerCoords = await getPrimaryCoords(context.subscriberWorker.contactId);
    if (workerCoords.status === "no-address") {
      return {
        eligible: false,
        reason:
          "Not eligible — worker has no primary address, so distance from the chosen sites cannot be determined.",
      };
    }
    if (workerCoords.status === "not-geocoded") {
      return {
        eligible: false,
        reason:
          "Not eligible — worker's primary address has not been geocoded, so distance from the chosen sites cannot be determined.",
      };
    }

    // Measure EVERY reachable site so the reason can name the nearest one
    // deterministically. A missing address/geocode on an individual site
    // only removes that site from consideration (another site may still
    // put the worker in the service area); if NO site could be measured,
    // the criterion cannot be confirmed and the worker is not eligible.
    const distanceCache = new Map<string, { distance: number; method: string }>();
    const measured: { name: string; distance: number; method: string }[] = [];
    const unmeasurable: string[] = [];
    for (const facilityId of n.facilityIds!) {
      const facility = await storage.facilities.get(facilityId);
      if (!facility) {
        unmeasurable.push(`configured site (${facilityId}) no longer exists`);
        continue;
      }
      const facilityCoords = await getPrimaryCoords(facility.contactId);
      if (facilityCoords.status === "no-address") {
        unmeasurable.push(`site "${facility.name}" has no address`);
        continue;
      }
      if (facilityCoords.status === "not-geocoded") {
        unmeasurable.push(`site "${facility.name}" has not been geocoded`);
        continue;
      }
      const { distance, method } = await measureDistance(
        workerCoords.coords,
        facilityCoords.coords,
        distanceCache,
      );
      measured.push({ name: facility.name, distance, method });
    }

    if (measured.length === 0) {
      return {
        eligible: false,
        reason: `Not eligible — none of the chosen sites could be measured (${unmeasurable.join("; ")}).`,
      };
    }

    const nearest = measured.reduce((a, b) => (b.distance < a.distance ? b : a));
    if (nearest.distance <= n.distanceMiles!) {
      return {
        eligible: true,
        reason: `Eligible (service area): worker is ${nearest.distance.toFixed(1)} miles from ${nearest.name} by ${nearest.method}, within the ${n.distanceMiles} mile service-area limit`,
      };
    }

    return {
      eligible: false,
      reason: `Not eligible — worker is ${nearest.distance.toFixed(1)} miles from the nearest chosen site (${nearest.name}) by ${nearest.method}, which is beyond the ${n.distanceMiles} mile service-area limit${unmeasurable.length > 0 ? ` (unmeasured: ${unmeasurable.join("; ")})` : ""}.`,
    };
  }
}

const plugin = new BaoStartDentalPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartDentalPlugin };
