/**
 * System-status collector: runs plugin scans inside a timeout sandbox and
 * caches the latest result per plugin in shared process memory.
 *
 * This is a plain service module, deliberately separate from the Express
 * routes in `server/modules/system/status.ts`, so a future token-gated
 * external monitoring web service can reuse `collectStatus` / `rescan*`
 * verbatim without touching the admin routes.
 *
 * Results are in-memory ONLY (wiped on restart, by design). No scan history
 * is persisted to the database.
 */
import { logger } from "../../../logger";
import { systemStatusPluginRegistry } from "./registry";
import {
  DEFAULT_SCAN_TIMEOUT_MS,
  STATUS_PRIORITIES,
  type StatusDetails,
  type StatusMessage,
  type StatusPriority,
  type StatusScanResult,
  type SystemStatusEntry,
  type SystemStatusPlugin,
} from "./types";

const SERVICE = "system-status";

/** Latest scan result per plugin id. Shared, process-wide. */
const results = new Map<string, StatusScanResult>();

/**
 * In-flight scans per plugin id, so concurrent demands for the same plugin
 * (e.g. the admin page and the dashboard widget loading together) share one
 * scan instead of racing duplicates.
 */
const inFlight = new Map<string, Promise<StatusScanResult>>();

function worstPriority(messages: StatusMessage[]): StatusPriority {
  let worst = 0;
  for (const m of messages) {
    const rank = STATUS_PRIORITIES.indexOf(m.priority);
    if (rank > worst) worst = rank;
  }
  return STATUS_PRIORITIES[worst];
}

function isImmediate(plugin: SystemStatusPlugin): boolean {
  return plugin.scanMode === "immediate";
}

/**
 * Run one plugin's scan inside the sandbox: a thrown error or a scan that
 * exceeds its timeout becomes an error-level message — the collector itself
 * never throws for a misbehaving plugin.
 */
async function runScan(plugin: SystemStatusPlugin): Promise<StatusScanResult> {
  const started = Date.now();
  const timeoutMs = plugin.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  let messages: StatusMessage[];
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Scan timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      const scanned = await Promise.race([plugin.scan(), timeout]);
      messages = Array.isArray(scanned) ? scanned : [];
      if (messages.length === 0) {
        messages = [
          {
            priority: "warning",
            title: "Scan returned no messages",
            details: `Plugin '${plugin.id}' completed but reported nothing.`,
          },
        ];
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`System status scan failed for '${plugin.id}': ${msg}`, {
      service: SERVICE,
      pluginId: plugin.id,
    });
    messages = [
      {
        priority: "error",
        title: "Scan failed",
        details: msg,
      },
    ];
  }
  const result: StatusScanResult = {
    pluginId: plugin.id,
    messages,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
  // Immediate plugins are recomputed on every collect; caching their
  // result would only ever serve stale data.
  if (!isImmediate(plugin)) {
    results.set(plugin.id, result);
  }
  return result;
}

/** Scan a plugin, sharing any already-in-flight scan for the same plugin. */
function scanShared(plugin: SystemStatusPlugin): Promise<StatusScanResult> {
  const existing = inFlight.get(plugin.id);
  if (existing) return existing;
  const promise = runScan(plugin).finally(() => {
    inFlight.delete(plugin.id);
  });
  inFlight.set(plugin.id, promise);
  return promise;
}

function toEntry(
  plugin: SystemStatusPlugin,
  result: StatusScanResult,
): SystemStatusEntry {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    canRescan: !isImmediate(plugin),
    hasDetails: typeof plugin.details === "function",
    worstPriority: worstPriority(result.messages),
    result,
  };
}

/**
 * Collect the latest status for the given plugins. `"scan-and-cache"`
 * plugins scan on first demand and then serve their cached result until an
 * explicit rescan; `"immediate"` plugins are recomputed on every collect.
 * Callers decide the plugin set — routes pass the viewer-visible plugins
 * from the registry.
 */
export async function collectStatus(
  plugins: SystemStatusPlugin[],
): Promise<SystemStatusEntry[]> {
  const entries = await Promise.all(
    plugins.map(async (plugin) => {
      const cached = isImmediate(plugin) ? undefined : results.get(plugin.id);
      const result = cached ?? (await scanShared(plugin));
      return toEntry(plugin, result);
    }),
  );
  return entries;
}

/**
 * Force a fresh scan of one plugin. For `"immediate"` plugins this is
 * indistinguishable from a normal collect — the scan runs fresh either way.
 */
export async function rescanPlugin(
  plugin: SystemStatusPlugin,
): Promise<SystemStatusEntry> {
  const result = await scanShared(plugin);
  return toEntry(plugin, result);
}

/** Force a fresh scan of every given plugin. */
export async function rescanAll(
  plugins: SystemStatusPlugin[],
): Promise<SystemStatusEntry[]> {
  const entries = await Promise.all(
    plugins.map(async (plugin) => {
      const result = await scanShared(plugin);
      return toEntry(plugin, result);
    }),
  );
  return entries;
}

/**
 * Run a plugin's optional `details()` drill-down. NEVER cached — every call
 * invokes the plugin fresh — and never shares state with the scan cache.
 * Enforces the same per-plugin timeout as scans. Throws when the plugin has
 * no details method or when the call fails/times out; the payload is never
 * logged (it may contain sensitive-adjacent data).
 */
export async function getPluginDetails(
  plugin: SystemStatusPlugin,
): Promise<StatusDetails> {
  if (typeof plugin.details !== "function") {
    throw new Error(`Plugin '${plugin.id}' does not support details`);
  }
  const timeoutMs = plugin.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Details timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([plugin.details(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Test-only helper: wipe the in-memory result cache. */
export function clearStatusResults(): void {
  results.clear();
}

export { systemStatusPluginRegistry };
