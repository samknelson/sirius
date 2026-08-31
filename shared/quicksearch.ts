/**
 * Quicksearch — shared contract between the server search runner and the
 * search dialog.
 *
 * A quicksearch result is DATA, never markup. Every searcher returns the same
 * shape and one client component draws it, so escaping, keyboard navigation
 * and grouping behave identically no matter which plugin produced the row.
 */

/**
 * Shortest query the framework will run at all. An individual clause inside a
 * searcher is free to demand MORE than this before it participates (a worker
 * ID or a grievance sirius id, for instance) — this is the floor, not the rule.
 */
export const QUICKSEARCH_MIN_QUERY_LENGTH = 2;

/** One record found by one searcher. */
export interface QuicksearchResult {
  /** The record id. Unique within the group; used as the React key. */
  id: string;
  /** Primary line — the name of the thing. */
  title: string;
  /** Secondary line: just enough to tell two similar records apart. */
  subtitle?: string | null;
  /** Short chips (a status, an identifier type). Keep to one or two. */
  badges?: string[];
  /** In-app route for the record. Following it re-gates at the target page. */
  href: string;
  /**
   * Which clause matched, in words ("Name", "SSN", "Sirius ID"). This is how a
   * user typing digits can tell why a row came back — and how a sensitive
   * match (SSN) is reported without echoing the value.
   */
  matchedOn?: string;
}

/** The results one enabled configuration produced. */
export interface QuicksearchGroup {
  /** The owning `plugin_configs` row id. */
  configId: string;
  pluginId: string;
  /** The config's own name when set, else the plugin's name. */
  label: string;
  /** Lucide icon name the dialog draws beside the group heading. */
  icon?: string;
  results: QuicksearchResult[];
  /** True when the searcher had more matches than the per-searcher cap. */
  truncated: boolean;
}

/** A configuration that was asked to search and did not deliver. */
export interface QuicksearchFailure {
  configId: string;
  pluginId: string;
  label: string;
  reason: "timeout" | "error";
}

export interface QuicksearchResponse {
  /** The query as the server understood it (trimmed). */
  query: string;
  /** Groups in configured order. A searcher with no matches is omitted. */
  groups: QuicksearchGroup[];
  /**
   * Searchers that timed out or threw. Surfaced so the dialog can say a
   * searcher failed rather than silently showing nothing for it.
   */
  failures: QuicksearchFailure[];
}
