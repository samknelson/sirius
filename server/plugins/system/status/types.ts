import type { BasePluginMetadata } from "../../_core/types";

/**
 * Message priority levels, ordered from least to most severe. The admin
 * status page badges each message; the dashboard widget rolls up warnings
 * and errors.
 */
export const STATUS_PRIORITIES = ["info", "notice", "warning", "error"] as const;
export type StatusPriority = (typeof STATUS_PRIORITIES)[number];

/** Scan modes — see {@link SystemStatusPlugin.scanMode}. */
export const STATUS_SCAN_MODES = ["scan-and-cache", "immediate"] as const;
export type StatusScanMode = (typeof STATUS_SCAN_MODES)[number];

/** One message produced by a status plugin's scan. */
export interface StatusMessage {
  priority: StatusPriority;
  title: string;
  details?: string;
}

/** One row in a plugin's details drill-down. */
export interface StatusDetailRow {
  /** Primary identifier of the row (e.g. an env var name). */
  label: string;
  /** Human-readable purpose/explanation. */
  description?: string;
  /**
   * Displayed value. For sensitive data the plugin MUST obfuscate before
   * returning — the framework never sees raw secrets.
   */
  value?: string;
  /** Optional short badge text (e.g. "unset", "secret", "required"). */
  badges?: string[];
  /** Optional severity for visual emphasis of this row. */
  priority?: StatusPriority;
}

/** One group of detail rows (e.g. an env-var category). */
export interface StatusDetailGroup {
  title: string;
  rows: StatusDetailRow[];
}

/**
 * Structured content returned by a plugin's optional `details()` method.
 * Rendered by the admin UI as grouped tables. NEVER cached and never
 * written to logs or audit tables.
 */
export interface StatusDetails {
  groups: StatusDetailGroup[];
}

/**
 * A system-status plugin. Each plugin scans one aspect of system health and
 * returns one or more messages. Scans are run by the collector (see
 * `collector.ts`) inside a timeout sandbox — a thrown or hung `scan()`
 * becomes an error-level message, never a failed page.
 *
 * Results live in shared memory only (wiped on restart); there is NO
 * database persistence for scan history by design.
 */
export interface SystemStatusPlugin extends BasePluginMetadata {
  /**
   * How the collector treats this plugin's results:
   *
   * - `"scan-and-cache"` (default): the scan result is cached in memory
   *   and served as-is until an explicit rescan. The UI offers a rescan
   *   button.
   * - `"immediate"`: the scan is cheap and its answer changes over time
   *   (e.g. uptime), so the collector recomputes it on every collect and
   *   never serves a cached result. The UI hides the rescan button — the
   *   value is always fresh — and rescan requests simply recompute.
   */
  scanMode?: StatusScanMode;
  /**
   * Per-plugin scan timeout in milliseconds. Defaults to
   * {@link DEFAULT_SCAN_TIMEOUT_MS}. When exceeded, the collector records
   * an error-level "scan timed out" message for the plugin.
   */
  timeoutMs?: number;
  /** Run the scan. Must not mutate any persistent state. */
  scan(): Promise<StatusMessage[]>;
  /**
   * Optional on-demand drill-down. Invoked ONLY by the details endpoint —
   * never by the collector's scan cycle — and its result is NEVER cached
   * (each request runs it fresh). Runs under the same per-plugin timeout
   * as `scan()`. Payloads may contain sensitive-adjacent data (already
   * obfuscated by the plugin) and must never be logged.
   */
  details?(): Promise<StatusDetails>;
}

/** Manifest entry shape for system-status plugins. */
export interface SystemStatusManifestEntry extends BasePluginMetadata {
  scanMode: StatusScanMode;
}

/** In-memory scan result for one plugin. */
export interface StatusScanResult {
  pluginId: string;
  messages: StatusMessage[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  /** Wall-clock duration of the scan in milliseconds. */
  durationMs: number;
}

/**
 * One entry in the collector's response: plugin metadata joined with its
 * latest in-memory scan result. `result` is always present — the collector
 * scans on first demand.
 */
export interface SystemStatusEntry {
  id: string;
  name: string;
  description: string;
  /**
   * Whether the UI should offer a rescan action. False for immediate
   * plugins — their result is recomputed on every load, so a rescan
   * button would be meaningless.
   */
  canRescan: boolean;
  /** Whether the plugin offers a `details()` drill-down. */
  hasDetails: boolean;
  /** Highest-severity priority among the plugin's messages. */
  worstPriority: StatusPriority;
  result: StatusScanResult;
}

export const DEFAULT_SCAN_TIMEOUT_MS = 10_000;
