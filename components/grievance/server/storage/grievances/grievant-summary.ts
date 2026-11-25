/**
 * Shared computation for a grievance's cardinality-based "grievant" summary —
 * the worker/class portion of a grievance's display identity. Used by both the
 * grievance-name denorm plugin (as the third part of the composite title) and
 * the grievance list query (as the standalone "Grievant" column) so the two
 * never drift.
 */

export interface GrievantSummaryWorker {
  given: string | null;
  family: string | null;
  displayName: string | null;
  primary: boolean;
}

/** Combine a worker's given + family name, falling back to the display name. */
export function workerFullName(worker: GrievantSummaryWorker): string {
  const parts = [worker.given, worker.family]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const joined = parts.join(" ");
  return joined || (worker.displayName ?? "").trim();
}

/**
 * Normalize a free-text class description for display: strip control
 * characters, collapse runs of whitespace, and truncate to 100 characters.
 */
export function cleanClassDescription(raw: string | null): string {
  if (!raw) return "";
  // eslint-disable-next-line no-control-regex
  const withoutControl = raw.replace(/[\u0000-\u001F\u007F]/g, " ");
  const collapsed = withoutControl.replace(/\s+/g, " ").trim();
  return collapsed.length > 100 ? collapsed.slice(0, 100) : collapsed;
}

/**
 * The cardinality-dependent worker summary:
 *   - individual          → the single worker's name;
 *   - multiple-with-lead  → the lead worker's name + " (+N)" others;
 *   - multiple            → "N workers";
 *   - class               → the cleaned class description.
 *
 * `workers` is expected in the same order the denorm plugin uses (alphabetical
 * by display name) so "first worker" resolution is consistent.
 */
export function grievantSummary(
  cardinality: string,
  workers: GrievantSummaryWorker[],
  classDescription: string | null,
): string {
  switch (cardinality) {
    case "individual": {
      const worker = workers[0];
      return worker ? workerFullName(worker) : "";
    }
    case "multiple-with-lead": {
      const lead = workers.find((w) => w.primary) ?? workers[0];
      const leadName = lead ? workerFullName(lead) : "";
      const others = workers.length > 0 ? workers.length - 1 : 0;
      return leadName && others > 0 ? `${leadName} (+${others})` : leadName;
    }
    case "multiple":
      return workers.length > 0 ? `${workers.length} workers` : "";
    case "class":
      return cleanClassDescription(classDescription);
    default:
      return "";
  }
}
