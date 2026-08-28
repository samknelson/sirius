/**
 * The single contract for the BAO member-status hours threshold.
 *
 * The canonical persisted location is `options_worker_ms.data.sitespecific.bao.threshold`
 * (a non-negative integer number of hours). Every reader and writer — the
 * eligibility plugins (bao-shared), the universal options form, the dedicated
 * BAO thresholds page, the options API validation, and the S1 options loader —
 * goes through these helpers so the value cannot drift between surfaces.
 */

/** Canonical nested path of the threshold inside the `data` JSONB column. */
export const WORKER_MS_THRESHOLD_PATH = ["sitespecific", "bao", "threshold"] as const;

/** True for a valid persisted threshold value: a non-negative integer. */
export function isValidThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Read the value stored at the canonical path, whatever it is. */
export function rawThresholdOf(data: unknown): unknown {
  return (data as { sitespecific?: { bao?: { threshold?: unknown } } } | null | undefined)
    ?.sitespecific?.bao?.threshold;
}

/** Read a valid threshold from a member status's `data` JSON, else undefined. */
export function readWorkerMsThreshold(data: unknown): number | undefined {
  const value = rawThresholdOf(data);
  return isValidThreshold(value) ? value : undefined;
}

/**
 * Decode the threshold from an S1 member-status taxonomy-term name. The
 * authoritative S1 payload carries no threshold field — the value is encoded
 * only in the term name's "… - NN hours" suffix (06 §4.8: the terms ARE
 * "industry/policy + hours threshold" groups). Accepts -, – and — separators
 * and any capitalization of "hours". Returns null when the name carries no
 * decodable threshold (e.g. "PA Worker"), which callers must report
 * explicitly rather than invent a value.
 */
export function decodeThresholdFromTermName(name: string): number | null {
  const m = /[-–—]\s*(\d+)\s*hours?\s*$/i.exec(name.trim());
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge a partial `data` patch into the existing JSON without erasing
 * sibling keys. Plain objects merge recursively; any other value replaces;
 * an explicit `null` leaf DELETES the key (the wire signal for "clear this
 * setting"). Empty objects left behind by a deletion are pruned so repeated
 * clear/set cycles stay canonical.
 */
export function mergeOptionData(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
    } else if (isPlainObject(value)) {
      const merged = mergeOptionData(base[key], value);
      if (Object.keys(merged).length === 0) {
        delete base[key];
      } else {
        base[key] = merged;
      }
    } else {
      base[key] = value;
    }
  }
  return base;
}

/** Build the minimal nested patch for a threshold write (null = clear). */
export function thresholdPatch(threshold: number | null): Record<string, unknown> {
  return { sitespecific: { bao: { threshold } } };
}

/**
 * Validate the threshold slot inside an incoming worker-ms `data` payload.
 * Absent and explicit-null (clear) are fine; anything else must be a
 * non-negative integer. Returns an error message, or undefined when valid.
 */
export function validateWorkerMsDataThreshold(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (!isPlainObject(data)) return "data must be a JSON object";
  const value = rawThresholdOf(data);
  if (value === undefined || value === null) return undefined;
  if (!isValidThreshold(value)) {
    return "sitespecific.bao.threshold must be a whole number of hours (0 or greater)";
  }
  return undefined;
}
