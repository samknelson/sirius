import { lookupDistricts, type CensusDistrictInfo } from "./census-geocoder";
import type { BtuPoliticalStorage } from "../storage/sitespecific/btu/political";
import {
  GOOGLE_GEOCODE_OPERATION,
  GOOGLE_GEOCODING_PLUGIN_ID,
} from "../plugins/wc-vendors/plugins/google-geocoding";
import {
  CivicApiError,
  type CivicOfficial,
} from "./civic-types";
import {
  OPENSTATES_LOOKUP_OPERATION,
  OPENSTATES_PLUGIN_ID,
} from "../plugins/wc-vendors/plugins/openstates";
import { wcRequest } from "./webclient";

export { CivicApiError };
export type { CivicOfficial };

export interface CivicLookupResult {
  normalizedAddress: string;
  officials: CivicOfficial[];
  cacheHit: boolean;
  districtKey: string | null;
  cachedOfficialIds: string[] | null;
}

interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

/**
 * Address → coordinates, through the shared Google geocode request.
 *
 * Shared with the comm address validator: the same resolved Google connection
 * and request arguments use the same cached answer.
 *
 * There is no maintenance guard here any more: the framework refuses the call
 * it is about to make, and a stored answer is not a call. During maintenance
 * an address we have already geocoded still resolves, and one we have not
 * raises the refusal from the web client framework.
 */
async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const outcome = await wcRequest({
    vendor: { pluginId: GOOGLE_GEOCODING_PLUGIN_ID },
    operation: GOOGLE_GEOCODE_OPERATION,
    args: { address },
  });
  const data = outcome.outcome === "success" && outcome.value ? outcome.value : outcome.fallback;
  const error = outcome.outcome === "success" && outcome.value ? undefined : outcome.error;

  if (!data) {
    throw new CivicApiError(error || "Geocoding request failed", 502);
  }

  if (data.status === "ZERO_RESULTS") {
    throw new CivicApiError("Could not find the specified address. Please check the address and try again.", 400);
  }

  if (data.status !== "OK") {
    throw new CivicApiError(`Geocoding error: ${data.error_message || data.status}`, 400);
  }

  const result = data.results?.[0];
  const location = result?.geometry?.location;

  if (location?.lat == null || location?.lng == null) {
    throw new CivicApiError("Could not determine coordinates for the specified address.", 400);
  }

  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: result?.formatted_address || address,
  };
}
interface LookupOptions {
  districtCacheStorage?: BtuPoliticalStorage;
}

async function callOpenStates(lat: number, lng: number): Promise<CivicOfficial[]> {
  const result = await wcRequest({
    vendor: { pluginId: OPENSTATES_PLUGIN_ID },
    operation: OPENSTATES_LOOKUP_OPERATION,
    args: { lat, lng },
  });
  if (result.outcome === "success" && result.value) return result.value;
  if (result.cause instanceof CivicApiError) throw result.cause;
  throw new CivicApiError(result.error || "Open States was not asked.", 503);
}

export async function lookupRepresentatives(address: string, options?: LookupOptions): Promise<CivicLookupResult> {
  const geo = await geocodeAddress(address);
  const cacheStorage = options?.districtCacheStorage;

  let districtInfo: CensusDistrictInfo | null = null;

  if (cacheStorage) {
    try {
      districtInfo = await lookupDistricts(geo.lat, geo.lng);

      if (districtInfo) {
        const cached = await cacheStorage.getDistrictCache(districtInfo.districtKey);

        if (cached && cached.officialIds.length > 0) {
          const officials: CivicOfficial[] = [];
          for (const officialId of cached.officialIds) {
            const official = await cacheStorage.getOfficial(officialId);
            if (official) {
              officials.push({
                name: official.name,
                officeName: official.officeName,
                level: official.level,
                division: official.division || "",
                party: official.party || null,
                phones: official.phones || [],
                emails: official.emails || [],
                photoUrl: official.photoUrl || null,
                urls: official.urls || [],
                channels: [],
                ocdDivisionId: official.ocdDivisionId || "",
              });
            }
          }

          if (officials.length === cached.officialIds.length) {
            return {
              normalizedAddress: geo.formattedAddress,
              officials,
              cacheHit: true,
              districtKey: districtInfo.districtKey,
              cachedOfficialIds: cached.officialIds,
            };
          }
        }
      }
    } catch (err) {
      console.warn("District cache lookup failed, falling back to Open States:", err instanceof Error ? err.message : err);
    }
  }

  const officials = await callOpenStates(geo.lat, geo.lng);

  return {
    normalizedAddress: geo.formattedAddress,
    officials,
    cacheHit: false,
    districtKey: districtInfo?.districtKey || null,
    cachedOfficialIds: null,
  };
}
