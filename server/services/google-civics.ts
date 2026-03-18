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
    throw new Error(`Google Civic API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as any;

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
        channels: (rawOfficial.channels || []).map((ch: any) => ({
          type: ch.type || "",
          id: ch.id || "",
        })),
        ocdDivisionId: divisionId,
      });
    }
  }

  return { normalizedAddress, officials };
}
