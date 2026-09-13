import type { WcAnswer } from "../../../services/webclient";
import { registerWcVendorPlugin } from "../registry";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CENSUS_GEOCODER_PLUGIN_ID = "census-geocoder";
export const CENSUS_DISTRICT_OPERATION = "district-lookup";

export interface CensusDistrictInfo {
  state: string;
  cd: string;
  sldu: string;
  sldl: string;
  districtKey: string;
}

export interface CensusDistrictArgs {
  lat: number;
  lng: number;
}

interface CensusGeographyResult {
  GEOID?: string;
  BASENAME?: string;
  NAME?: string;
  STATE?: string;
  CD?: string;
  SLDU?: string;
  SLDL?: string;
  [key: string]: unknown;
}

interface CensusGeocoderResponse {
  result?: {
    geographies?: Record<string, CensusGeographyResult[]>;
  };
}

declare module "../types" {
  interface WcVendorOperations {
    "district-lookup": {
      args: CensusDistrictArgs;
      result: CensusDistrictInfo | null;
    };
  }
}

export function censusDistrictsRequestKey(args: CensusDistrictArgs): string {
  return `${args.lat.toFixed(5)},${args.lng.toFixed(5)}`;
}

function extractDistricts(data: CensusGeocoderResponse): CensusDistrictInfo | null {
  const geos = data.result?.geographies;
  if (!geos) return null;

  let state = "";
  let cd = "";
  let sldu = "";
  let sldl = "";
  for (const [layerName, results] of Object.entries(geos)) {
    if (!results?.length) continue;
    const geo = results[0];
    if (geo.STATE && !state) state = geo.STATE;
    const lowerLayer = layerName.toLowerCase();
    if (lowerLayer.includes("congressional")) {
      cd = geo.CD || geo.BASENAME || cd;
    }
    if (
      (lowerLayer.includes("state legislative") && lowerLayer.includes("upper")) ||
      lowerLayer.includes("sldu")
    ) {
      sldu = geo.SLDU || geo.BASENAME || "";
    }
    if (
      (lowerLayer.includes("state legislative") && lowerLayer.includes("lower")) ||
      lowerLayer.includes("sldl")
    ) {
      sldl = geo.SLDL || geo.BASENAME || "";
    }
  }
  if (!state || (!cd && !sldu && !sldl)) return null;
  return { state, cd, sldu, sldl, districtKey: `${state}|${cd}|${sldu}|${sldl}` };
}

async function lookupDistricts(
  _ctx: unknown,
  args: CensusDistrictArgs,
): Promise<WcAnswer<CensusDistrictInfo | null>> {
  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/coordinates" +
    `?x=${args.lng}&y=${args.lat}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json";
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    return {
      answered: false,
      error: `Census Geocoder returned ${response.status}`,
    };
  }
  const data = (await response.json()) as CensusGeocoderResponse;
  return { answered: true, value: extractDistricts(data) };
}

registerWcVendorPlugin({
  id: CENSUS_GEOCODER_PLUGIN_ID,
  name: "US Census Geocoder",
  description: "Looks up current electoral districts for geographic coordinates.",
  requiredComponent: "sitespecific.btu.political",
  credential: { secretName: "none" },
  service: "Census",
  operations: {
    [CENSUS_DISTRICT_OPERATION]: {
      description: "look up census districts",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lng: { type: "number", minimum: -180, maximum: 180 },
          },
          required: ["lat", "lng"],
          additionalProperties: false,
        },
        effect: "read",
      },
      cache: {
        mode: "cached",
        freshFor: 90 * DAY_MS,
        failureRememberedFor: 5 * 60 * 1000,
        requestKey: censusDistrictsRequestKey,
      },
      run: lookupDistricts,
    },
  },
});