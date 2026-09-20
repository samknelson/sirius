/**
 * Domain-facing facade for the Google Geocoding vendor plugin.
 *
 * The plugin owns credentials, cache policy, and remote execution. This module
 * keeps the result shape existing address and civic callers already consume.
 */
import {
  GOOGLE_GEOCODE_OPERATION,
  GOOGLE_GEOCODING_PLUGIN_ID,
  googleGeocodeRequestKey,
  type GoogleGeocodeArgs,
  type GoogleGeocodeResponse,
  type GoogleGeocodeResult,
} from "../plugins/wc-vendors/plugins/google-geocoding";
import { wcRequest, type WcRequestMode } from "./webclient";

export {
  GOOGLE_GEOCODE_OPERATION,
  GOOGLE_GEOCODING_PLUGIN_ID,
  googleGeocodeRequestKey,
};
export type {
  GoogleGeocodeArgs,
  GoogleGeocodeResponse,
  GoogleGeocodeResult,
};

export interface GoogleGeocodeOutcome {
  response?: GoogleGeocodeResponse;
  error?: string;
  fromNetwork: boolean;
  fetchedAt?: Date;
}

export async function geocodeWithGoogle(
  args: GoogleGeocodeArgs,
  options: { mode?: WcRequestMode } = {},
): Promise<GoogleGeocodeOutcome> {
  const result = await wcRequest({
    vendor: { pluginId: GOOGLE_GEOCODING_PLUGIN_ID },
    operation: GOOGLE_GEOCODE_OPERATION,
    args,
    mode: options.mode,
  });

  if (result.outcome === "success" && result.value) {
    return {
      response: result.value,
      fromNetwork: result.source === "network",
      fetchedAt: result.fetchedAt,
    };
  }
  return {
    response: result.fallback,
    error: result.error,
    fromNetwork: result.source === "network",
    fetchedAt: result.fetchedAt,
  };
}