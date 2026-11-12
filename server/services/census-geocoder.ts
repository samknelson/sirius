/**
 * Domain-facing facade for the credential-free Census Geocoder plugin.
 */
import {
  CENSUS_DISTRICT_OPERATION,
  CENSUS_GEOCODER_PLUGIN_ID,
  censusDistrictsRequestKey,
  type CensusDistrictArgs,
  type CensusDistrictInfo,
} from "../plugins/wc-vendors/plugins/census-geocoder";
import { wcRequest } from "./webclient";

export {
  CENSUS_DISTRICT_OPERATION,
  CENSUS_GEOCODER_PLUGIN_ID,
  censusDistrictsRequestKey,
};
export type { CensusDistrictArgs, CensusDistrictInfo };

export async function lookupDistricts(
  lat: number,
  lng: number,
): Promise<CensusDistrictInfo | null> {
  const result = await wcRequest({
    vendor: { pluginId: CENSUS_GEOCODER_PLUGIN_ID },
    operation: CENSUS_DISTRICT_OPERATION,
    args: { lat, lng },
  });
  if (result.outcome === "success") return result.value ?? null;
  return result.fallback ?? null;
}