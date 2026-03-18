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

interface GoogleCivicsNormalizedInput {
  line1?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface GoogleCivicsChannel {
  type?: string;
  id?: string;
}

interface GoogleCivicsOfficial {
  name?: string;
  party?: string;
  phones?: string[];
  emails?: string[];
  photoUrl?: string;
  urls?: string[];
  channels?: GoogleCivicsChannel[];
}

interface GoogleCivicsOffice {
  name?: string;
  divisionId?: string;
  officialIndices?: number[];
}

interface GoogleCivicsDivision {
  name?: string;
}

interface GoogleCivicsResponse {
  normalizedInput?: GoogleCivicsNormalizedInput;
  offices?: GoogleCivicsOffice[];
  officials?: GoogleCivicsOfficial[];
  divisions?: Record<string, GoogleCivicsDivision>;
}

interface GoogleCivicsError {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string }[];
  };
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

function classifyLevel(divisionId: string, officeName: string): string {
  const lower = officeName.toLowerCase();
  if (lower.includes("president") || lower.includes("senator") || lower.includes("representative") || lower.includes("congress")) {
    if (divisionId.includes("state:")) {
      return "state";
    }
    return "federal";
  }
  if (divisionId === "ocd-division/country:us") return "federal";
  if (divisionId.match(/\/state:\w+$/) || divisionId.includes("/state:") && !divisionId.includes("/place:") && !divisionId.includes("/county:")) return "state";
  if (divisionId.includes("/place:") || divisionId.includes("/county:")) return "local";
  return "other";
}

export async function lookupRepresentatives(address: string): Promise<CivicLookupResult> {
  const apiKey = process.env.GOOGLE_CIVICS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CIVICS_API_KEY environment variable is not set");
  }

  const url = `https://www.googleapis.com/civicinfo/v2/representatives?address=${encodeURIComponent(address)}&key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    const errorBody = await response.text();
    let parsed: GoogleCivicsError | null = null;
    try {
      parsed = JSON.parse(errorBody) as GoogleCivicsError;
    } catch {
      // not JSON
    }

    const apiCode = parsed?.error?.code;
    const apiMessage = parsed?.error?.message || errorBody;
    const reason = parsed?.error?.errors?.[0]?.reason;

    if (response.status === 400 || reason === "parseError" || reason === "invalidParameter") {
      throw new CivicApiError(`Invalid address: ${apiMessage}`, 400, apiCode);
    }
    if (response.status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
      throw new CivicApiError("Google Civics API rate limit exceeded. Please try again later.", 429, apiCode);
    }
    if (response.status === 404 || reason === "notFound") {
      throw new CivicApiError(`No representatives found for this address: ${apiMessage}`, 404, apiCode);
    }
    throw new CivicApiError(`Google Civic API error (${response.status}): ${apiMessage}`, response.status, apiCode);
  }

  const data: GoogleCivicsResponse = await response.json();

  const normalizedAddress = data.normalizedInput
    ? `${data.normalizedInput.line1 || ""}, ${data.normalizedInput.city || ""}, ${data.normalizedInput.state || ""} ${data.normalizedInput.zip || ""}`.trim()
    : address;

  const officials: CivicOfficial[] = [];

  if (!data.offices || !data.officials) {
    return { normalizedAddress, officials };
  }

  for (const office of data.offices) {
    const divisionId = office.divisionId || "";
    const divisionName = data.divisions?.[divisionId]?.name || "";
    const level = classifyLevel(divisionId, office.name || "");

    if (!office.officialIndices) continue;

    for (const idx of office.officialIndices) {
      const rawOfficial = data.officials[idx];
      if (!rawOfficial) continue;

      officials.push({
        name: rawOfficial.name || "Unknown",
        officeName: office.name || "Unknown Office",
        level,
        division: divisionName,
        party: rawOfficial.party || null,
        phones: rawOfficial.phones || [],
        emails: rawOfficial.emails || [],
        photoUrl: rawOfficial.photoUrl || null,
        urls: rawOfficial.urls || [],
        channels: (rawOfficial.channels || []).map((ch) => ({
          type: ch.type || "",
          id: ch.id || "",
        })),
        ocdDivisionId: divisionId,
      });
    }
  }

  return { normalizedAddress, officials };
}
