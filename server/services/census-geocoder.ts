/**
 * The US Census geocoder's coordinates → districts lookup.
 *
 * Free, and slow enough to be worth not repeating: it is the district lookup
 * that feeds the civic representative cache, and the coordinates it is asked
 * about are the ones a Google geocode just produced — so the same address
 * asked twice arrives here as the same point twice.
 *
 * It goes through the web client framework for that reason rather than for
 * cost. The window is long because a point's districts change only when the
 * lines are redrawn, and the coordinates are rounded into the key: five
 * decimal places is about a metre, far inside any district, and two callers
 * asking about "the same place" should not miss each other over a float.
 */
import { assertExternalServiceAllowed } from "./maintenance-flag";
import { registerWcRequest, wcRequest, type WcAnswer } from "./webclient";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The service. Matches the shared vendor guard's name for it. */
export const CENSUS_DISTRICTS_SERVICE = "Census" as const;

/** The request type: geographies for a point, at the current vintage. */
export const CENSUS_DISTRICTS_REQUEST_TYPE = "district-lookup";

/**
 * How long a district answer stays fresh. Redistricting is a
 * once-a-decade event and the Census's "current" vintage changes at most
 * annually, so anything shorter re-asks a question with the same answer.
 */
const DISTRICTS_FRESH_FOR_MS = 90 * DAY_MS;

/** How long a failed lookup is left alone. */
const FAILURE_REMEMBERED_FOR_MS = 5 * 60 * 1000;

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
    geographies?: {
      [layerName: string]: CensusGeographyResult[];
    };
  };
}

/**
 * The canonical request key: the point, rounded to five decimal places.
 *
 * Rounding is the point of the key. The coordinates come from a geocode, and
 * the same address geocoded on two occasions can differ in the last digits;
 * keying on the raw float would make those two different questions with
 * identical answers.
 */
export function censusDistrictsRequestKey(args: CensusDistrictArgs): string {
  return `${args.lat.toFixed(5)},${args.lng.toFixed(5)}`;
}

registerWcRequest<CensusDistrictArgs>({
  service: CENSUS_DISTRICTS_SERVICE,
  requestType: CENSUS_DISTRICTS_REQUEST_TYPE,
  operation: "look up census districts",
  cached: true,
  // Nothing is bought here, so an answer that cannot be stored costs only the
  // time it took — worth having anyway, unlike a metered lookup.
  needsWritableDatabase: false,
  freshFor: DISTRICTS_FRESH_FOR_MS,
  failureRememberedFor: FAILURE_REMEMBERED_FOR_MS,
  requestKey: censusDistrictsRequestKey,
});

/**
 * Districts for a point, from the stored answer when there is a fresh one.
 *
 * `null` means the Census has no districts for the point — a real answer, and
 * kept as one. A lookup that could not be made returns `null` too, after the
 * framework has recorded the failure; the caller treats both as "no district
 * to cache by".
 */
export async function lookupDistricts(lat: number, lng: number): Promise<CensusDistrictInfo | null> {
  const result = await wcRequest<CensusDistrictInfo | null>({
    service: CENSUS_DISTRICTS_SERVICE,
    requestType: CENSUS_DISTRICTS_REQUEST_TYPE,
    args: { lat, lng } satisfies CensusDistrictArgs,
    fetch: () => callCensusGeocoder(lat, lng),
  });

  if (result.outcome === "success") return result.value ?? null;
  return result.fallback ?? null;
}

/**
 * Make the call and say what came back.
 *
 * A body the Census answered with — districts or none — is an answer. An HTTP
 * status is not: it is the outage that the failure hold exists for.
 */
async function callCensusGeocoder(
  lat: number,
  lng: number,
): Promise<WcAnswer<CensusDistrictInfo | null>> {
  assertExternalServiceAllowed("Census", "look up census districts");

  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    console.warn(`Census Geocoder returned ${response.status} — skipping district cache`);
    return { answered: false, error: `Census Geocoder returned ${response.status}` };
  }

  const data: CensusGeocoderResponse = await response.json();

  return { answered: true, value: extractDistricts(data) };
}

function extractDistricts(data: CensusGeocoderResponse): CensusDistrictInfo | null {
  const geos = data.result?.geographies;
  if (!geos) return null;

  let state = "";
  let cd = "";
  let sldu = "";
  let sldl = "";

  for (const [layerName, results] of Object.entries(geos)) {
    if (!results || results.length === 0) continue;
    const geo = results[0];

    if (geo.STATE && !state) {
      state = geo.STATE;
    }

    const lowerLayer = layerName.toLowerCase();

    if (lowerLayer.includes("congressional") && geo.CD) {
      cd = geo.CD;
    } else if (lowerLayer.includes("congressional") && geo.BASENAME) {
      cd = geo.BASENAME;
    }

    if ((lowerLayer.includes("state legislative") && lowerLayer.includes("upper")) || lowerLayer.includes("sldu")) {
      sldu = geo.SLDU || geo.BASENAME || "";
    }

    if ((lowerLayer.includes("state legislative") && lowerLayer.includes("lower")) || lowerLayer.includes("sldl")) {
      sldl = geo.SLDL || geo.BASENAME || "";
    }
  }

  if (!state || (!cd && !sldu && !sldl)) {
    return null;
  }

  const districtKey = `${state}|${cd}|${sldu}|${sldl}`;

  return { state, cd, sldu, sldl, districtKey };
}
