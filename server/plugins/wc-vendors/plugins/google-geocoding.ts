import { registerEnvironmentVariables } from "../../../config/env-registry";
import type { Coordinates } from "@shared/utils/geocode";
import type { WcAnswer } from "../../../services/webclient";
import { registerWcVendorPlugin } from "../registry";
import type { WcVendorContext } from "../types";
import {
  redactCredentialText,
  redactCredentialValue,
} from "./credential-redaction";

const DAY_MS = 24 * 60 * 60 * 1000;

export const GOOGLE_GEOCODING_PLUGIN_ID = "google-geocoding";
export const GOOGLE_GEOCODE_OPERATION = "geography.address.geocode";
export const GOOGLE_DRIVING_DISTANCE_OPERATION = "geography.routes.driving-distance";

export interface GoogleDrivingDistanceArgs {
  origin: Coordinates;
  destination: Coordinates;
}

export interface GoogleGeocodeArgs {
  address: string;
  components?: string;
  region?: string;
}

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

export interface GoogleGeocodeResponse {
  status?: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

declare module "../types" {
  interface WcVendorOperations {
    "geography.routes.driving-distance": {
      args: GoogleDrivingDistanceArgs;
      result: number;
    };
    "geography.address.geocode": {
      args: GoogleGeocodeArgs;
      result: GoogleGeocodeResponse;
    };
  }
}

registerEnvironmentVariables([
  {
    name: "GOOGLE_MAPS_API_KEY",
    description: "Legacy Google Maps key available for a Google Geocoding connection.",
    secret: true,
    category: "core",
    changeTakesEffect: "immediate",
  },
  {
    name: "GOOGLE_CIVICS_API_KEY",
    description: "Legacy civic lookup key available for a Google Geocoding connection.",
    secret: true,
    category: "sitespecific.btu.political",
    changeTakesEffect: "immediate",
  },
]);

export function googleGeocodeRequestKey(args: GoogleGeocodeArgs): string {
  const parts = [args.address.trim().replace(/\s+/g, " ").toUpperCase()];
  if (args.components) parts.push(`components=${args.components.trim().toUpperCase()}`);
  if (args.region) parts.push(`region=${args.region.trim().toUpperCase()}`);
  return parts.join("|");
}

async function geocode(
  ctx: WcVendorContext,
  args: GoogleGeocodeArgs,
): Promise<WcAnswer<GoogleGeocodeResponse>> {
  const params = new URLSearchParams({
    address: args.address,
    key: ctx.credential.value,
  });
  if (args.components) params.set("components", args.components);
  if (args.region) params.set("region", args.region);

  let response: Response;
  try {
    response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
    );
  } catch (error) {
    return {
      answered: false,
      error: redactCredentialText(
        error instanceof Error ? error.message : String(error),
        ctx.credential.value,
      ),
    };
  }
  if (!response.ok) {
    return {
      answered: false,
      error: `Geocoding request failed (${response.status})`,
    };
  }

  let data: GoogleGeocodeResponse;
  try {
    data = redactCredentialValue(
      (await response.json()) as GoogleGeocodeResponse,
      ctx.credential.value,
    );
  } catch {
    return {
      answered: false,
      error: "Google returned a geocode body that is not JSON",
    };
  }

  if (data.status === "OK" && Array.isArray(data.results)) {
    return { answered: true, value: data };
  }
  if (data.status === "ZERO_RESULTS" && Array.isArray(data.results)) {
    return { answered: true, value: data };
  }
  return {
    answered: false,
    value: data,
    error: data.error_message || `Geocoding failed: ${data.status || "no status"}`,
  };
}

async function drivingDistance(ctx: WcVendorContext, args: GoogleDrivingDistanceArgs): Promise<number> {
  const location = (point: Coordinates) => ({
    location: { latLng: { latitude: point.latitude, longitude: point.longitude } },
  });
  try {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": ctx.credential.value,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: location(args.origin), destination: location(args.destination),
        travelMode: "DRIVE", units: "IMPERIAL",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Google Routes API returned ${response.status}`);
    const data = await response.json() as { routes?: { distanceMeters?: number }[] };
    const meters = data.routes?.[0]?.distanceMeters;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
      throw new Error("Google Routes API returned no route between the points");
    }
    return meters;
  } catch (error) {
    throw new Error(redactCredentialText(
      error instanceof Error && error.name === "TimeoutError"
        ? "Google Routes API request timed out"
        : `Google Routes API request failed: ${error instanceof Error ? error.message : String(error)}`,
      ctx.credential.value,
    ));
  }
}

registerWcVendorPlugin({
  id: GOOGLE_GEOCODING_PLUGIN_ID,
  name: "Google Geocoding",
  description: "Turns street addresses into normalized addresses and coordinates.",
  credential: {
    secretName: "required",
    setupGuidance: "Name a secret containing a Google Maps API key with Geocoding API access.",
    setupExample: "GOOGLE_MAPS_API_KEY",
  },
  service: "Google",
  operations: {
    // Fork paid lookup: callers own the durable distance cache. Never add a
    // second framework cache, and never spend while its answer cannot be saved.
    [GOOGLE_DRIVING_DISTANCE_OPERATION]: {
      description: "compute a driving distance",
      needsWritableDatabase: true,
      cache: { mode: "uncached" },
      run: drivingDistance,
    },
    "service.test-connection": {
      description: "test the Google Geocoding connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      run: async (ctx) =>
        ctx.credential.value.trim()
          ? { status: "unsupported" as const, error: { message: "Google Geocoding has no non-destructive credential-only probe." } }
          : { status: "misconfigured" as const, error: { message: "Google Maps API key is not configured." } },
    },
    [GOOGLE_GEOCODE_OPERATION]: {
      description: "geocode an address",
      needsWritableDatabase: true,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            address: { type: "string", minLength: 1 },
            components: { type: "string" },
            region: { type: "string" },
          },
          required: ["address"],
          additionalProperties: false,
        },
        effect: "read",
      },
      cache: {
        mode: "cached",
        freshFor: 365 * DAY_MS,
        failureRememberedFor: 5 * 60 * 1000,
        requestKey: googleGeocodeRequestKey,
      },
      run: geocode,
    },
  },
});