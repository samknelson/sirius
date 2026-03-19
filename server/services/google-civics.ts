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

interface GoogleGeocodingResponse {
  status: string;
  results?: {
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }[];
  error_message?: string;
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

async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const apiKey = process.env.GOOGLE_CIVICS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CIVICS_API_KEY environment variable is not set");
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new CivicApiError(`Geocoding request failed (${response.status})`, response.status);
  }

  const data: GoogleGeocodingResponse = await response.json();

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

export async function lookupRepresentatives(address: string): Promise<CivicLookupResult> {
  const openStatesKey = process.env.OPEN_STATES_API_KEY;
  if (!openStatesKey) {
    throw new Error("OPEN_STATES_API_KEY environment variable is not set");
  }

  const geo = await geocodeAddress(address);

  const url = `https://v3.openstates.org/people.geo?lat=${geo.lat}&lng=${geo.lng}&apikey=${openStatesKey}`;
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

  const officials: CivicOfficial[] = [];

  if (!data.results || data.results.length === 0) {
    return { normalizedAddress: geo.formattedAddress, officials };
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

  return { normalizedAddress: geo.formattedAddress, officials };
}
