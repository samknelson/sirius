/**
 * Reduce a loosely formatted phone number ("(702) 555-1234", "+17025551234",
 * "702.555.1234") to its comparable digits: strip non-digits and drop a
 * leading US country code "1" when 11 digits. Returns null when the result
 * is not a plausible 10-digit US number.
 */
export function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/**
 * Parse a remote "Family, Given" name (e.g. "Aery, Lina") into name parts.
 * Falls back to treating the whole string as the family name when no comma
 * is present. Returns null for blank input.
 */
export function parseRemoteWorkerName(raw: string): { given: string | null; family: string | null; displayName: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) {
    return { given: null, family: trimmed, displayName: trimmed };
  }
  const family = trimmed.slice(0, commaIdx).trim();
  const given = trimmed.slice(commaIdx + 1).trim();
  const displayName = [given, family].filter(Boolean).join(" ") || trimmed;
  return { given: given || null, family: family || null, displayName };
}

