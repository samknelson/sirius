import type { Coordinates } from "@shared/utils/geocode";
import { wcRequest } from "./webclient";
import { isMaintenanceModeError } from "./maintenance-flag";
import { GOOGLE_GEOCODING_PLUGIN_ID, GOOGLE_DRIVING_DISTANCE_OPERATION } from "../plugins/wc-vendors/plugins/google-geocoding";

const METERS_PER_MILE = 1609.344;

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
 * Google Routes API. Reuses the Google geocoding WC connection (no new secret).
 * Any error, quota problem,
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
  try {
    const result = await wcRequest({
      vendor: { pluginId: GOOGLE_GEOCODING_PLUGIN_ID },
      operation: GOOGLE_DRIVING_DISTANCE_OPERATION,
      args: { origin, destination },
    });
    if (result.value !== undefined) {
      return { status: "ok", miles: result.value / METERS_PER_MILE };
    }
    return { status: "unavailable", reason: result.error ?? "Google Routes API did not answer" };
  } catch (error) {
    if (isMaintenanceModeError(error)) throw error;
    // Missing/ambiguous WC connections retain the caller's explicit fallback
    // contract, without selecting another account or leaking credentials.
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
