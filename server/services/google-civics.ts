import { lookupDistricts, type CensusDistrictInfo } from "./census-geocoder";
import type { BtuPoliticalStorage } from "../storage/sitespecific/btu/political";
import { getEnvironmentVariable, registerEnvironmentVariables } from "../config/env-registry";
import { geocodeWithGoogle } from "./google-geocode";

// changeTakesEffect: "immediate" for both. Each key is read through the
// registry inside the function that makes the outbound call, once per lookup,
// and neither is cached anywhere.
registerEnvironmentVariables([
  { name: "GOOGLE_CIVICS_API_KEY", description: "Google API key for geocoding in civic-official lookups.", secret: true, category: "sitespecific.btu.political", changeTakesEffect: "immediate", },
  { name: "OPEN_STATES_API_KEY", description: "OpenStates API key for state-legislator lookups.", secret: true, category: "sitespecific.btu.political", changeTakesEffect: "immediate", },
]);
import { registerUncachedWcRequest, wcUncachedRequest } from "./webclient";

export interface CivicOfficial {
  name: string;
  officeName: string;
  level: string;
  division: string;
  party: string | null;
  phones: string[];
  emails: string[];
  photoUrl: string | null;
  urls: string[];
  channels: { type: string; id: string }[];
  ocdDivisionId: string;
}

export interface CivicLookupResult {
  normalizedAddress: string;
  officials: CivicOfficial[];
  cacheHit: boolean;
  districtKey: string | null;
  cachedOfficialIds: string[] | null;
}

export class CivicApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public apiErrorCode?: number
  ) {
    super(message);
    this.name = "CivicApiError";
  }
}

interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface OpenStatesLink {
  url?: string;
  note?: string;
}

interface OpenStatesOffice {
  name?: string;
  address?: string;
  voice?: string;
  email?: string;
  fax?: string;
}

interface OpenStatesRole {
  title?: string;
  org_classification?: string;
  district?: string;
  division_id?: string;
}

interface OpenStatesPerson {
  id?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  image?: string;
  party?: { name?: string }[];
  current_role?: OpenStatesRole;
  jurisdiction?: {
    id?: string;
    name?: string;
    classification?: string;
  };
  email?: string;
  links?: OpenStatesLink[];
  offices?: OpenStatesOffice[];
  ids?: { identifier?: string; scheme?: string }[];
}

interface OpenStatesResponse {
  results?: OpenStatesPerson[];
}

/**
 * Address → coordinates, through the shared Google geocode request.
 *
 * Shared with the comm address validator on purpose: it is the same question
 * to the same vendor, so an address geocoded there is free here and the other
 * way round. Only the key differs — this lookup is billed to the civic key —
 * and a key decides who pays, not what the answer is, so it stays out of the
 * request key.
 *
 * There is no maintenance guard here any more: the framework refuses the call
 * it is about to make, and a stored answer is not a call. During maintenance
 * an address we have already geocoded still resolves, and one we have not
 * raises the refusal from inside `geocodeWithGoogle`.
 */
async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const apiKey = getEnvironmentVariable("GOOGLE_CIVICS_API_KEY");
  if (!apiKey) {
    throw new Error("GOOGLE_CIVICS_API_KEY environment variable is not set");
  }

  const outcome = await geocodeWithGoogle({ address }, { apiKey });
  const data = outcome.response;

  if (!data) {
    throw new CivicApiError(outcome.error || "Geocoding request failed", 502);
  }

  if (data.status === "ZERO_RESULTS") {
    throw new CivicApiError("Could not find the specified address. Please check the address and try again.", 400);
  }

  if (data.status !== "OK") {
    throw new CivicApiError(`Geocoding error: ${data.error_message || data.status}`, 400);
  }

  const result = data.results?.[0];
  const location = result?.geometry?.location;

  if (!location?.lat || !location?.lng) {
    throw new CivicApiError("Could not determine coordinates for the specified address.", 400);
  }

  return {
    lat: location.lat,
    lng: location.lng,
    formattedAddress: result?.formatted_address || address,
  };
}

function classifyLevel(orgClassification: string, divisionId: string, title: string): string {
  if (orgClassification === "government") return "federal";

  if (divisionId.includes("/cd:")) return "federal";

  const stateOnlyPattern = /^ocd-division\/country:us\/state:\w+$/;
  if (stateOnlyPattern.test(divisionId)) {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("senator") || lowerTitle.includes("representative")) {
      return "federal";
    }
    return "state";
  }

  if (divisionId.includes("/sldl:") || divisionId.includes("/sldu:")) return "state";

  if (divisionId.includes("/place:") || divisionId.includes("/county:")) return "local";

  if (orgClassification === "legislature" || orgClassification === "upper" || orgClassification === "lower") {
    if (divisionId.includes("/state:") && !divisionId.includes("/place:") && !divisionId.includes("/county:")) {
      return "state";
    }
  }

  return "other";
}

function buildOfficeName(person: OpenStatesPerson): string {
  const role = person.current_role;
  if (!role) return "Unknown Office";

  const title = role.title || "";
  const jurisdiction = person.jurisdiction?.name || "";
  const district = role.district || "";

  if (district) {
    return `${title}, District ${district} - ${jurisdiction}`.trim();
  }
  return `${title} - ${jurisdiction}`.trim();
}

interface LookupOptions {
  districtCacheStorage?: BtuPoliticalStorage;
}

function parseOpenStatesResponse(data: OpenStatesResponse): CivicOfficial[] {
  const officials: CivicOfficial[] = [];

  if (!data.results || data.results.length === 0) {
    return officials;
  }

  for (const person of data.results) {
    const role = person.current_role;
    if (!role) continue;

    const divisionId = role.division_id || "";
    const orgClassification = role.org_classification || "";
    const title = role.title || "";
    const level = classifyLevel(orgClassification, divisionId, title);

    const partyName = person.party?.[0]?.name || null;

    const phones: string[] = [];
    const emails: string[] = [];
    if (person.email) emails.push(person.email);
    if (person.offices) {
      for (const office of person.offices) {
        if (office.voice && !phones.includes(office.voice)) phones.push(office.voice);
        if (office.email && !emails.includes(office.email)) emails.push(office.email);
      }
    }

    const urls: string[] = [];
    if (person.links) {
      for (const link of person.links) {
        if (link.url) urls.push(link.url);
      }
    }

    officials.push({
      name: person.name || "Unknown",
      officeName: buildOfficeName(person),
      level,
      division: person.jurisdiction?.name || "",
      party: partyName,
      phones,
      emails,
      photoUrl: person.image || null,
      urls,
      channels: [],
      ocdDivisionId: divisionId,
    });
  }

  return officials;
}

async function callOpenStates(lat: number, lng: number): Promise<CivicOfficial[]> {
  // The status code on a CivicApiError decides what the caller's route answers
  // with, so the thrown error is carried back out as itself rather than
  // rebuilt from its message.
  let thrown: unknown;

  const { value, error } = await wcUncachedRequest<CivicOfficial[]>({
    service: "OpenStates",
    requestType: OPEN_STATES_LOOKUP,
    fetch: async () => {
      try {
        const openStatesKey = getEnvironmentVariable("OPEN_STATES_API_KEY");
        if (!openStatesKey) {
          throw new Error("OPEN_STATES_API_KEY environment variable is not set");
        }

        const url = `https://v3.openstates.org/people.geo?lat=${lat}&lng=${lng}&apikey=${openStatesKey}`;
        const response = await fetch(url);

        if (!response.ok) {
          const errorBody = await response.text();
          if (response.status === 429) {
            throw new CivicApiError("Open States API rate limit exceeded. Please try again later.", 429);
          }
          if (response.status === 401 || response.status === 403) {
            throw new CivicApiError("Open States API key is invalid or unauthorized.", 403);
          }
          throw new CivicApiError(`Open States API error (${response.status}): ${errorBody}`, response.status);
        }

        const data: OpenStatesResponse = await response.json();
        return { answered: true, value: parseOpenStatesResponse(data) };
      } catch (err) {
        thrown = err;
        return {
          answered: false,
          error: err instanceof Error ? err.message : "Open States lookup failed",
        };
      }
    },
  });

  if (value) return value;
  if (thrown !== undefined) throw thrown;
  // Never asked: the writable-database gate stopped it. A lookup nobody can
  // record is a failure, not an empty list of officials.
  throw new CivicApiError(error || "Open States was not asked.", 503);
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

/**
 * The state-legislator lookup.
 *
 * Uncached here because its answer already has a home: the caller writes the
 * officials it returns into the district cache, keyed by census district, and
 * a second cache of the same answer keyed by coordinates would age separately
 * from the first. It needs a writable database for that reason — the lookup is
 * rate-limited and metered, and spending a call whose answer cannot be written
 * into the district cache means spending it again on the next request.
 */
const OPEN_STATES_LOOKUP = "lookup-legislators";
