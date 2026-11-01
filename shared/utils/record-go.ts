/** Public record URL; the server or SPA delegates to the authorized Go resolver. */
export interface RecordGoPresentation {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export function recordGoHref(identifier: string): string {
  return `/go/${encodeURIComponent(identifier.trim())}`;
}