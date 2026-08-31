/**
 * Google geocoding, as ONE request.
 *
 * Two unrelated parts of the app turn an address into coordinates: the comm
 * address validator (validate, parse, geocode) and the civic representative
 * lookup. They read different API keys out of the environment, but they ask
 * Google the same question and get the same answer back, so they must share
 * the same stored answer — otherwise the same address is bought twice, once
 * per caller.
 *
 * The key is therefore the question and nothing about who is asking: the
 * address as typed (whitespace-collapsed and upper-cased so two spellings of
 * one address do not key differently) plus any `components` or `region`
 * restriction, because those change what Google answers. The API key is NOT in
 * the key: it decides who is billed, not what the answer is, and a credential
 * has no business in a cache key.
 *
 * FRESHNESS — the decision the plan asked to be recorded. A street address's
 * coordinates do not change; "never expires" is the honest window, and it is
 * deliberately NOT what is configured here. The sweep deletes a success once
 * it is past its freshness window, so an unbounded window is also an
 * unbounded table: rows for addresses nobody will ask about again would stay
 * forever. A year keeps essentially every repeat lookup free while letting the
 * sweep reclaim what has gone quiet, and re-buying a geocode once a year for
 * an address still in use is the price of that. Change it only with the same
 * two considerations in view.
 */
import { assertExternalServiceAllowed } from "./maintenance-flag";
import { registerWcRequest, wcRequest, type WcAnswer, type WcRequestMode } from "./webclient";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The vendor. Matches the shared vendor guard's name for it. */
export const GOOGLE_GEOCODE_SERVICE = "Google" as const;

/**
 * The request type: the Geocoding API's forward geocode (address → places).
 * A reverse geocode is a different question and would be its own request type.
 */
export const GOOGLE_GEOCODE_REQUEST_TYPE = "geocode";

/** See the module comment: long, but finite so the sweep can reclaim. */
const GEOCODE_FRESH_FOR_MS = 365 * DAY_MS;

/**
 * How long a failed geocode is left alone. Short: a failure here is an outage,
 * a bad key or a quota ceiling, and none of those is worth a long silence.
 */
const FAILURE_REMEMBERED_FOR_MS = 5 * 60 * 1000;

export interface GoogleGeocodeArgs {
  /** The address to geocode, as the caller composed it. */
  address: string;
  /** Google's `components` restriction, verbatim (e.g. `country:US`). */
  components?: string;
  /** Google's `region` biasing, a ccTLD (e.g. `us`). */
  region?: string;
}

/** One entry of Google's `results` array; only the fields callers read. */
export interface GoogleGeocodeResult {
  formatted_address?: string;
  place_id?: string;
  types?: string[];
  address_components?: any[];
  geometry?: {
    location?: { lat?: number; lng?: number };
    location_type?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Google's geocode body, kept whole so every caller reads its own fields. */
export interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

export interface GoogleGeocodeOutcome {
  /**
   * Google's body, from the stored answer or from the call just made. Also
   * present for a non-OK status Google itself reported, so callers can keep
   * reporting the status in their own words.
   */
  response?: GoogleGeocodeResponse;
  /** Why there is no answer, when there is none. */
  error?: string;
  /** True when Google was asked just now rather than answered from store. */
  fromNetwork: boolean;
  /** When Google was asked for this answer. */
  fetchedAt?: Date;
}

/**
 * The canonical request key.
 *
 * The address is collapsed and upper-cased: the same address typed with a
 * double space or in lower case is the same question, and keying it twice is
 * how one address gets bought twice. Every restriction that changes the answer
 * is appended — leaving one out would hand a restricted caller the
 * unrestricted answer.
 */
export function googleGeocodeRequestKey(args: GoogleGeocodeArgs): string {
  const parts = [args.address.trim().replace(/\s+/g, " ").toUpperCase()];
  if (args.components) parts.push(`components=${args.components.trim().toUpperCase()}`);
  if (args.region) parts.push(`region=${args.region.trim().toUpperCase()}`);
  return parts.join("|");
}

registerWcRequest<GoogleGeocodeArgs>({
  service: GOOGLE_GEOCODE_SERVICE,
  requestType: GOOGLE_GEOCODE_REQUEST_TYPE,
  operation: "geocode an address",
  cached: true,
  // A geocode is metered. Making one on a connection that will forget the
  // answer means paying for it again on the very next call.
  needsWritableDatabase: true,
  freshFor: GEOCODE_FRESH_FOR_MS,
  failureRememberedFor: FAILURE_REMEMBERED_FOR_MS,
  requestKey: googleGeocodeRequestKey,
});

/**
 * Geocode an address, from the stored answer when there is a fresh one.
 *
 * Throws `MaintenanceModeError` when a call would have to be made; a stored
 * answer is not a call and is served as usual.
 */
export async function geocodeWithGoogle(
  args: GoogleGeocodeArgs,
  options: { apiKey: string; mode?: WcRequestMode },
): Promise<GoogleGeocodeOutcome> {
  const result = await wcRequest<GoogleGeocodeResponse>({
    service: GOOGLE_GEOCODE_SERVICE,
    requestType: GOOGLE_GEOCODE_REQUEST_TYPE,
    args,
    mode: options.mode,
    fetch: () => callGoogleGeocode(args, options.apiKey),
  });

  if (result.outcome === "success" && result.value) {
    return {
      response: result.value,
      fromNetwork: result.source === "network",
      fetchedAt: result.fetchedAt,
    };
  }

  return {
    // A status Google reported but we do not keep (ZERO_RESULTS is kept as a
    // success; REQUEST_DENIED and friends come back here as the fallback).
    response: result.fallback,
    error: result.error,
    fromNetwork: result.source === "network",
    fetchedAt: result.fetchedAt,
  };
}

/**
 * Make the call and say what came back.
 *
 * `answered` is declared here, not inferred: a body Google refused to produce
 * an answer for — a denied key, a spent quota, an internal error — is a
 * failure to be retried shortly, not an answer about the address that should
 * be stamped fresh for a year.
 */
async function callGoogleGeocode(
  args: GoogleGeocodeArgs,
  apiKey: string,
): Promise<WcAnswer<GoogleGeocodeResponse>> {
  assertExternalServiceAllowed("Google", "geocode address");

  const params = new URLSearchParams({ address: args.address, key: apiKey });
  if (args.components) params.set("components", args.components);
  if (args.region) params.set("region", args.region);

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
  );

  if (!response.ok) {
    return { answered: false, error: `Geocoding request failed (${response.status})` };
  }

  let data: GoogleGeocodeResponse;
  try {
    data = (await response.json()) as GoogleGeocodeResponse;
  } catch {
    return { answered: false, error: "Google returned a geocode body that is not JSON" };
  }

  if (data.status === "OK") return { answered: true, value: data };

  // "No such place" is a real answer — the caller is told the address is not
  // findable — but it is not kept: an address Google does not know today may
  // be one it knows next month.
  if (data.status === "ZERO_RESULTS") return { answered: true, value: data, store: false };

  return {
    answered: false,
    value: data,
    error: data.error_message || `Geocoding failed: ${data.status || "no status"}`,
  };
}
