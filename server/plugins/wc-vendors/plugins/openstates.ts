import { registerEnvironmentVariables } from "../../../config/env-registry";
import {
  CivicApiError,
  type CivicOfficial,
} from "../../../services/civic-types";
import { registerWcVendorPlugin } from "../registry";
import type { WcVendorContext } from "../types";
import {
  redactCredentialText,
  redactCredentialValue,
} from "./credential-redaction";

export const OPENSTATES_PLUGIN_ID = "openstates";
export const OPENSTATES_LOOKUP_OPERATION = "lookup-legislators";

interface OpenStatesLink {
  url?: string;
}

interface OpenStatesOffice {
  voice?: string;
  email?: string;
}

interface OpenStatesRole {
  title?: string;
  org_classification?: string;
  district?: string;
  division_id?: string;
}

interface OpenStatesPerson {
  name?: string;
  image?: string;
  party?: { name?: string }[];
  current_role?: OpenStatesRole;
  jurisdiction?: { name?: string };
  email?: string;
  links?: OpenStatesLink[];
  offices?: OpenStatesOffice[];
}

interface OpenStatesResponse {
  results?: OpenStatesPerson[];
}

export interface OpenStatesLookupArgs {
  lat: number;
  lng: number;
}

declare module "../types" {
  interface WcVendorOperations {
    "lookup-legislators": {
      args: OpenStatesLookupArgs;
      result: CivicOfficial[];
    };
  }
}

registerEnvironmentVariables([{
  name: "OPEN_STATES_API_KEY",
  description: "Legacy OpenStates key available for an OpenStates connection.",
  secret: true,
  category: "sitespecific.btu.political",
  changeTakesEffect: "immediate",
}]);

function classifyLevel(orgClassification: string, divisionId: string, title: string): string {
  if (orgClassification === "government" || divisionId.includes("/cd:")) return "federal";
  if (/^ocd-division\/country:us\/state:\w+$/.test(divisionId)) {
    const lowerTitle = title.toLowerCase();
    return lowerTitle.includes("senator") || lowerTitle.includes("representative")
      ? "federal"
      : "state";
  }
  if (divisionId.includes("/sldl:") || divisionId.includes("/sldu:")) return "state";
  if (divisionId.includes("/place:") || divisionId.includes("/county:")) return "local";
  if (
    ["legislature", "upper", "lower"].includes(orgClassification) &&
    divisionId.includes("/state:")
  ) {
    return "state";
  }
  return "other";
}

function parseResponse(data: OpenStatesResponse): CivicOfficial[] {
  const officials: CivicOfficial[] = [];
  for (const person of data.results ?? []) {
    const role = person.current_role;
    if (!role) continue;
    const divisionId = role.division_id || "";
    const title = role.title || "";
    const district = role.district || "";
    const jurisdiction = person.jurisdiction?.name || "";
    const phones = Array.from(new Set(
      (person.offices ?? []).map((office) => office.voice).filter(Boolean),
    )) as string[];
    const emails = Array.from(new Set([
      person.email,
      ...(person.offices ?? []).map((office) => office.email),
    ].filter(Boolean))) as string[];
    officials.push({
      name: person.name || "Unknown",
      officeName: district
        ? `${title}, District ${district} - ${jurisdiction}`.trim()
        : `${title} - ${jurisdiction}`.trim(),
      level: classifyLevel(role.org_classification || "", divisionId, title),
      division: jurisdiction,
      party: person.party?.[0]?.name || null,
      phones,
      emails,
      photoUrl: person.image || null,
      urls: (person.links ?? []).flatMap((link) => link.url ? [link.url] : []),
      channels: [],
      ocdDivisionId: divisionId,
    });
  }
  return officials;
}

async function lookupLegislators(
  ctx: WcVendorContext,
  args: OpenStatesLookupArgs,
): Promise<CivicOfficial[]> {
  const params = new URLSearchParams({
    lat: String(args.lat),
    lng: String(args.lng),
    apikey: ctx.credential.value,
  });
  let response: Response;
  try {
    response = await fetch(`https://v3.openstates.org/people.geo?${params}`);
  } catch (error) {
    throw new CivicApiError(
      redactCredentialText(
        error instanceof Error ? error.message : String(error),
        ctx.credential.value,
      ),
      502,
    );
  }
  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = redactCredentialText(
        await response.text(),
        ctx.credential.value,
      );
    } catch (error) {
      throw new CivicApiError(
        redactCredentialText(
          error instanceof Error ? error.message : String(error),
          ctx.credential.value,
        ),
        response.status,
      );
    }
    if (response.status === 429) {
      throw new CivicApiError(
        "Open States API rate limit exceeded. Please try again later.",
        429,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new CivicApiError(
        "Open States API key is invalid or unauthorized.",
        403,
      );
    }
    throw new CivicApiError(
      `Open States API error (${response.status}): ${errorBody}`,
      response.status,
    );
  }
  let data: OpenStatesResponse;
  try {
    data = redactCredentialValue(
      (await response.json()) as OpenStatesResponse,
      ctx.credential.value,
    );
  } catch {
    throw new CivicApiError("Open States returned a response that is not valid JSON.", 502);
  }
  return parseResponse(data);
}

registerWcVendorPlugin({
  id: OPENSTATES_PLUGIN_ID,
  name: "OpenStates",
  description: "Looks up state legislators by geographic coordinates.",
  requiredComponent: "sitespecific.btu.political",
  credential: {
    secretName: "required",
    setupGuidance: "Name a secret containing an OpenStates API v3 key.",
    setupExample: "OPEN_STATES_API_KEY",
  },
  service: "OpenStates",
  operations: {
    [OPENSTATES_LOOKUP_OPERATION]: {
      description: "look up state legislators",
      needsWritableDatabase: true,
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
      cache: { mode: "uncached" },
      run: lookupLegislators,
    },
  },
});