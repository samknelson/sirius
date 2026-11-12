import type { WsClient } from "@shared/schema";
import { requiresFreemanBearerAuthorization } from "../../middleware/webservice-auth";

/**
 * Build only the credentials sent by the admin test route. Keeping this small
 * and separate makes the bearer applicability and omission rules testable
 * without ever logging, returning, or storing the credential.
 */
export function buildTestRequestHeaders(
  client: WsClient,
  clientKey: string,
  clientSecret: string,
  method: string,
  bearerToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-WS-Client-ID": clientKey,
  };
  if (["POST", "PUT", "PATCH"].includes(method)) headers["Content-Type"] = "application/json";
  if (requiresFreemanBearerAuthorization(client)) {
    if (bearerToken?.trim()) headers.Authorization = `Bearer ${bearerToken.trim()}`;
  } else {
    headers["X-WS-Client-Secret"] = clientSecret;
  }
  return headers;
}