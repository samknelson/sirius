import {
  getEnvironmentVariable,
  PUBLIC_URL_LOCAL_FALLBACK,
} from "../../../config/env-registry";

/**
 * Public base URL suitable for handing to EXTERNAL services (provider status
 * callbacks). Returns undefined when only the localhost development fallback
 * is available — a localhost callback URL is useless to Twilio/SendGrid.
 */
export function getPublicBaseUrl(): string | undefined {
  const url = getEnvironmentVariable("PUBLIC_URL");
  if (!url || url === PUBLIC_URL_LOCAL_FALLBACK) return undefined;
  return url;
}

export function buildStatusCallbackUrl(commId: string): string | undefined {
  const baseUrl = getPublicBaseUrl();

  if (!baseUrl) {
    console.warn(
      "No public URL available for status callback - set PUBLIC_URL (or run on a platform that provides a public domain)",
    );
    return undefined;
  }

  return `${baseUrl}/api/comm/statuscallback/${commId}`;
}
