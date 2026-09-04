import type { StagedRecord, StagedRecordMetadata } from "./staging";

/**
 * `extracted_at` is a `timestamptz`, so the driver hands back either a Date or
 * an offset-bearing string — both unambiguous instants. A zone-less string
 * would be parsed in the HOST zone by Date.parse (lib/timezone-contract.ts
 * rule: never do that to a bare string), so it is refused loudly rather than
 * quietly deciding to skip or force a refresh.
 */
const HAS_ZONE_DESIGNATOR = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
function extractedEpochSeconds(value: string | Date): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const text = String(value).trim();
  if (!HAS_ZONE_DESIGNATOR.test(text)) {
    throw new Error(`extracted_at "${text}" carries no zone designator — refusing to parse a bare timestamp in the host zone`);
  }
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Decide whether a daily identity scan must rebuild the full field payload.
 * Besides exact scalar/change comparison, re-read a row once when its
 * second-granularity Drupal `changed` value overlaps the previous extraction
 * second. That closes the common same-second lost-update window.
 */
export function shouldRefreshNodePayload(current: StagedRecord, staged: StagedRecordMetadata | undefined): boolean {
  if (!staged) return true;
  if (
    current.vid !== staged.vid ||
    current.title !== staged.title ||
    current.uid !== staged.uid ||
    current.status !== staged.status ||
    current.created !== staged.created ||
    current.changed !== staged.changed
  ) {
    return true;
  }
  const extractedAt = extractedEpochSeconds(staged.extractedAt);
  return current.changed != null && extractedAt != null && current.changed >= extractedAt - 1;
}