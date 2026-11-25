/** Legacy providers stored a connection selection under a namespaced suffix.
 * Unknown unrelated application data is not an authentication choice. */
export function hasLegacyAuthenticationSelection(data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([key, value]) =>
    key.endsWith("AuthorizationConfigId") && typeof value === "string" && value.trim().length > 0);
}

export function hasProviderAuthentication(data: Record<string, unknown> | null | undefined): boolean {
  if (data && Object.hasOwn(data, "authenticationProvider")) return data.authenticationProvider !== null;
  return hasLegacyAuthenticationSelection(data ?? {});
}
