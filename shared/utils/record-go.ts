/** Build the server-owned full-navigation URL for a record identifier. */
export function recordGoHref(identifier: string): string {
  return `/go/${encodeURIComponent(identifier.trim())}`;
}