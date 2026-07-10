import { addressValidationService } from "./comm/validators/address";
import type { Coordinates } from "@shared/utils/geocode";

const METERS_PER_MILE = 1609.344;
const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const REQUEST_TIMEOUT_MS = 10000;

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
 * address validation service (no new secret). Never throws: any error,
 * quota problem, timeout, or malformed response yields an `unavailable`
 * result so callers can fall back to another distance method.
 */
export async function getDrivingDistanceMiles(
  origin: Coordinates,
  destination: Coordinates,
): Promise<DrivingDistanceResult> {
  const apiKey = await addressValidationService.getGoogleMapsApiKey();
  if (!apiKey) {
    return { status: "unavailable", reason: "Google Maps API key not configured" };
  }

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
      return {
        status: "unavailable",
        reason: `Google Routes API returned ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      routes?: { distanceMeters?: number }[];
    };

    const distanceMeters = data.routes?.[0]?.distanceMeters;
    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
      return {
        status: "unavailable",
        reason: "Google Routes API returned no route between the points",
      };
    }

    return { status: "ok", miles: distanceMeters / METERS_PER_MILE };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "Google Routes API request timed out"
        : `Google Routes API request failed: ${error instanceof Error ? error.message : String(error)}`;
    return { status: "unavailable", reason };
  }
}
