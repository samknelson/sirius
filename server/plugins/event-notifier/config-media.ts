/** The explicit envelope is authoritative; data.media is a legacy/programmatic
 * fallback only. RJSF can retain that old mirror while editing other settings. */
export function configuredNotifierMedia(input: {
  media?: string | string[] | null;
  data?: unknown;
}): string[] {
  if (typeof input.media === "string") {
    return input.media.split(",").map(value => value.trim()).filter(Boolean);
  }
  if (Array.isArray(input.media)) return input.media;
  if (input.media === null) return [];
  const legacy = (input.data as { media?: unknown } | null)?.media;
  return Array.isArray(legacy) ? legacy.filter((value): value is string => typeof value === "string") : [];
}
