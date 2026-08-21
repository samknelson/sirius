import type { StagedRecord, StagedRecordMetadata } from "./staging";

function extractedEpochSeconds(value: string | Date): number | null {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
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