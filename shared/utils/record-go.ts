/** Build the server-owned full-navigation URL for a record identifier. */
export interface RecordGoPresentation {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export function recordGoHref(identifier: string): string {
  return `/go/${encodeURIComponent(identifier.trim())}`;
}