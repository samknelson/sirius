import { addressValidationService } from "./comm/validators/address";
import type { Coordinates } from "@shared/utils/geocode";
import { assertExternalServiceAllowed, isMaintenanceModeError } from "./maintenance-flag";
import { registerUncachedWcRequest, wcUncachedRequest, type WcAnswer } from "./webclient";

const METERS_PER_MILE = 1609.344;
const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const REQUEST_TIMEOUT_MS = 10000;

/**
 * The Routes call on the web client framework.
 *
 * Uncached here on purpose: the durable answer store for this question is the
 * BAO distance cache (`storage.baoDistanceCache`), which the callers own and
 * consult before ever reaching this module. Registering a second cache on the
 * framework would buy the same route twice into two tables. What the framework
 * supplies is the maintenance refusal, the writable-database gate and the one
 * description of what was attempted. The gate matters because a route is
 * metered: asking Google on a connection that cannot record the answer means
 * paying for it again on the next scan.
 */
const DRIVING_DISTANCE_SERVICE = "Google" as const;
const DRIVING_DISTANCE_REQUEST_TYPE = "driving-distance";

registerUncachedWcRequest({
  service: DRIVING_DISTANCE_SERVICE,
  requestType: DRIVING_DISTANCE_REQUEST_TYPE,
  operation: "compute a driving distance",
  needsWritableDatabase: true,
});

/**
 * Result of a driving-distance lookup. `unavailable` signals that the
 * caller should fall back to another method (e.g. straight-line
 * haversine) rather than treat the failure as an error.
 */
export type DrivingDistanceResult =
  | { status: "ok"; miles: number }
  | { status: "unavailable"; reason: string };

/**
 * Return the driving distance in miles between two coordinates using the
 * Google Routes API. Reuses the Google Maps API key resolved by the
 * address validation service (no new secret). Any error, quota problem,
 * timeout, or malformed response yields an `unavailable` result so callers
 * can fall back to another distance method.
 *
 * The one thing it does NOT swallow is the maintenance refusal: while the
 * site is in maintenance mode the call is refused and `MaintenanceModeError`
 * propagates, so a caller cannot mistake "the site is down" for "no route".
 */
export async function getDrivingDistanceMiles(
  origin: Coordinates,
  destination: Coordinates,
): Promise<DrivingDistanceResult> {
  const apiKey = await addressValidationService.getGoogleMapsApiKey();
  if (!apiKey) {
    return { status: "unavailable", reason: "Google Maps API key not configured" };
  }

  const result = await wcUncachedRequest<number>({
    service: DRIVING_DISTANCE_SERVICE,
    requestType: DRIVING_DISTANCE_REQUEST_TYPE,
    fetch: () => callGoogleRoutes(origin, destination, apiKey),
  });

  if (result.value !== undefined) {
    return { status: "ok", miles: result.value / METERS_PER_MILE };
  }
  return { status: "unavailable", reason: result.error ?? "Google Routes API did not answer" };
}

/**
 * Make the call and say what came back. `answered` is declared, never
 * inferred: a body with no route in it is Google declining to answer, not a
 * distance of nothing.
 */
async function callGoogleRoutes(
  origin: Coordinates,
  destination: Coordinates,
  apiKey: string,
): Promise<WcAnswer<number>> {
  assertExternalServiceAllowed(DRIVING_DISTANCE_SERVICE, "compute driving distance");

  try {
    const response = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: { latitude: origin.latitude, longitude: origin.longitude },
          },
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.latitude,
              longitude: destination.longitude,
            },
          },
        },
        travelMode: "DRIVE",
        units: "IMPERIAL",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { answered: false, error: `Google Routes API returned ${response.status}` };
    }

    const data = (await response.json()) as {
      routes?: { distanceMeters?: number }[];
    };

    const distanceMeters = data.routes?.[0]?.distanceMeters;
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
      return {
        answered: false,
        error: "Google Routes API returned no route between the points",
      };
    }

    return { answered: true, value: distanceMeters };
  } catch (error) {
    if (isMaintenanceModeError(error)) throw error;
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "Google Routes API request timed out"
        : `Google Routes API request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { answered: false, error: reason };
  }
}
