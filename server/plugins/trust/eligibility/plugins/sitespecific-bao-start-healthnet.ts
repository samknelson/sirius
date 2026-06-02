import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";
import { storage } from "../../../../storage/database";
import { distanceInMiles, type Coordinates } from "@shared/utils/geocode";

interface BaoStartHealthnetConfig extends BaseEligibilityConfig {
  distanceMiles: number;
  facilityIds: string[];
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

class BaoStartHealthnetPlugin extends EligibilityPlugin<BaoStartHealthnetConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "sitespecific-bao-start-healthnet",
    name: "BAO - Start Healthnet",
    description:
      "A subscriber will eventually be required to meet one of the following four criteria (only the geographic criterion is implemented):\n" +
      "1. Meet the specified geographic requirements (primary address is more than X miles from every chosen site)\n" +
      "2. Have EVER had HealthNet coverage (not yet implemented)\n" +
      "3. Have had ANY medical benefit without break for the specified number of months (not yet implemented)\n" +
      "4. The employer is in an immediate eligibility period (not yet implemented)",
    requiredComponent: "sitespecific.bao",
    configSchema: {
      type: "object",
      required: ["distanceMiles", "facilityIds"],
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
          minItems: 1,
          items: {
            type: "string",
          },
          "x-options-resource": "facility",
        },
      },
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;
    const c = (config ?? {}) as BaoStartHealthnetConfig;
    if (typeof c.distanceMiles !== "number" || !(c.distanceMiles > 0)) {
      return { valid: false, errors: ["distanceMiles must be a number greater than 0"] };
    }
    if (!Array.isArray(c.facilityIds) || c.facilityIds.length === 0) {
      return { valid: false, errors: ["At least one site must be selected"] };
    }
    for (const id of c.facilityIds) {
      if (typeof id !== "string" || id.length === 0) {
        return { valid: false, errors: ["facilityIds entries must be non-empty strings"] };
      }
      const facility = await storage.facilities.get(id);
      if (!facility) {
        return { valid: false, errors: [`Unknown facility: ${id}`] };
      }
    }
    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: BaoStartHealthnetConfig,
  ): Promise<EligibilityResult> {
    const { distanceMiles, facilityIds } = config;

    if (typeof distanceMiles !== "number" || !(distanceMiles > 0)) {
      return {
        eligible: false,
        reason: "BAO - Start Healthnet is misconfigured: distance (miles) must be greater than 0",
      };
    }
    if (!Array.isArray(facilityIds) || facilityIds.length === 0) {
      return {
        eligible: false,
        reason: "BAO - Start Healthnet is misconfigured: no sites selected",
      };
    }

    const workerCoords = await getPrimaryCoords(context.subscriberWorker.contactId);
    if (workerCoords.status === "no-address") {
      return {
        eligible: false,
        reason: "Worker has no primary address, so distance from the chosen sites cannot be determined",
      };
    }
    if (workerCoords.status === "not-geocoded") {
      return {
        eligible: false,
        reason: "Worker's primary address has not been geocoded, so distance from the chosen sites cannot be determined",
      };
    }

    // Validate and measure EVERY chosen site before deciding eligibility,
    // so a missing address/geocode on any site is always surfaced and the
    // ineligible reason can name the closest site deterministically.
    const measured: { name: string; distance: number }[] = [];
    for (const facilityId of facilityIds) {
      const facility = await storage.facilities.get(facilityId);
      if (!facility) {
        return {
          eligible: false,
          reason: `Configured site (${facilityId}) no longer exists, so the geographic criterion cannot be confirmed`,
        };
      }

      const facilityCoords = await getPrimaryCoords(facility.contactId);
      if (facilityCoords.status === "no-address") {
        return {
          eligible: false,
          reason: `Site "${facility.name}" has no address, so distance to it cannot be confirmed`,
        };
      }
      if (facilityCoords.status === "not-geocoded") {
        return {
          eligible: false,
          reason: `Site "${facility.name}" has not been geocoded, so distance to it cannot be confirmed`,
        };
      }

      measured.push({
        name: facility.name,
        distance: distanceInMiles(workerCoords.coords, facilityCoords.coords),
      });
    }

    const nearest = measured.reduce((a, b) => (b.distance < a.distance ? b : a));

    if (nearest.distance <= distanceMiles) {
      return {
        eligible: false,
        reason: `Worker is ${nearest.distance.toFixed(1)} miles from ${nearest.name}, which is within the ${distanceMiles} mile limit`,
      };
    }

    return {
      eligible: true,
      reason: `Worker is more than ${distanceMiles} miles from all ${measured.length} chosen ${measured.length === 1 ? "site" : "sites"} (nearest: ${nearest.name} at ${nearest.distance.toFixed(1)} miles)`,
    };
  }
}

const plugin = new BaoStartHealthnetPlugin();
registerEligibilityPlugin(plugin);

export { BaoStartHealthnetPlugin };
