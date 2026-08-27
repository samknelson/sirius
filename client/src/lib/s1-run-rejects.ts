/**
 * Normalized reject-count extraction for S1 migration run reports.
 *
 * Run reports come in several shapes:
 *   - Standard loader envelopes (§10): reasons under `rejectGate.counts`.
 *   - Aggregate sync runs: per-step envelopes nested under `fleet[]`, each
 *     carrying its own `rejectGate.counts`.
 *   - Legacy loader reports: a top-level `rejects` reason→count map.
 *   - Stage/parity reports: no reject data at all.
 *
 * This is the ONE place run history reads rejects from, so every TypeScript
 * process row shows what was actually recorded instead of "none".
 */

function isCountMap(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Pull numeric reason counts out of a candidate map, dropping junk values. */
function numericCounts(map: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [reason, count] of Object.entries(map)) {
    if (typeof count === "number" && Number.isFinite(count)) out[reason] = count;
  }
  return out;
}

function rejectGateCounts(candidate: unknown): Record<string, number> | null {
  if (!isCountMap(candidate)) return null;
  const gate = (candidate as { rejectGate?: unknown }).rejectGate;
  if (!isCountMap(gate)) return null;
  const counts = (gate as { counts?: unknown }).counts;
  return isCountMap(counts) ? numericCounts(counts) : null;
}

/**
 * Extract reject reason counts from any recorded run report.
 *
 * Precedence: standard envelope `rejectGate.counts`, then aggregate `fleet`
 * entries (summed per reason across all steps), then the legacy top-level
 * `rejects` map. Reports without reject data return an empty map ("none").
 */
export function rejectCountsOf(report: unknown): Record<string, number> {
  if (!isCountMap(report)) return {};

  // Standard loader envelope: rejectGate.counts at the top level.
  const own = rejectGateCounts(report);
  if (own) return own;

  // Aggregate sync report: sum rejectGate.counts across all fleet entries.
  const fleet = (report as { fleet?: unknown }).fleet;
  if (Array.isArray(fleet)) {
    const combined: Record<string, number> = {};
    for (const entry of fleet) {
      const counts = rejectGateCounts(entry);
      if (!counts) continue;
      for (const [reason, count] of Object.entries(counts)) {
        combined[reason] = (combined[reason] ?? 0) + count;
      }
    }
    return combined;
  }

  // Legacy report: top-level rejects reason→count map.
  const legacy = (report as { rejects?: unknown }).rejects;
  if (isCountMap(legacy)) return numericCounts(legacy);

  return {};
}
