import { registerSystemStatusPlugin } from "../registry";
import type {
  StatusDetailGroup,
  StatusDetailRow,
  StatusDetails,
  StatusMessage,
} from "../types";
import { addDaysYmd, getTodayYmd, type Ymd } from "@shared/utils/date";

/**
 * Which external web services we actually called, and how much, over the last
 * 30 days.
 *
 * A status entry is a machine-readable report first and a screen second: the
 * collector's messages are what a future token-gated monitoring endpoint would
 * see, and it never invokes `details()`. So every fact a monitor needs lives in
 * a message — the service, its count, and the exact days that count covers —
 * and the per-request-type breakdown is the human drill-down only.
 *
 * Every message is informational by design. Call volume is a fact, not a
 * fault: a busy month and a silent one are both reported at `info`, so this
 * entry never moves the page's health rollup, the dashboard status widget's
 * rollup, or a monitor's verdict.
 *
 * The counts come from the counter table through the storage layer, never from
 * the response cache — the cache holds one row per request key carrying only
 * the last attempt, and an uncached request type never writes to it at all, so
 * no honest call count can be derived from it. It is also the same storage
 * read the dashboard usage widget uses, which is what keeps the two surfaces
 * from disagreeing about the same service.
 */

/** Today plus the twenty-nine days before it — the admin stats page default. */
const WINDOW_DAYS = 30;

/**
 * The reported window, resolved the same way the admin stats endpoint resolves
 * its default range: today back through the (N-1)th day before it, inclusive.
 *
 * Plain Ymd string arithmetic — the counter stores a day, not a timestamp, so
 * nothing here has to decide what a day means and nothing goes through a Date.
 *
 * Recomputed by every caller (scan and details alike) rather than stashed by
 * the scan: a cached result can be hours old, and details must describe the
 * window it actually queried.
 */
function resolveWindow(): { start: Ymd; end: Ymd } {
  const end = getTodayYmd();
  return { start: addDaysYmd(end, -(WINDOW_DAYS - 1)), end };
}

function plural(calls: number): string {
  return calls === 1 ? "call" : "calls";
}

/** "over the 30 days from 2026-08-02 through 2026-08-31, inclusive" */
function windowPhrase(start: Ymd, end: Ymd): string {
  return `over the ${WINDOW_DAYS} days from ${start} through ${end}, inclusive`;
}

registerSystemStatusPlugin({
  id: "webclient.usage",
  name: "Web Service Usage",
  description:
    "Outbound calls to external web services over the last 30 days, per service.",
  // The counts only move when we call somebody, and the answer is a
  // report rather than a liveness probe — hold it until an explicit rescan.
  scanMode: "scan-and-cache",
  async scan(): Promise<StatusMessage[]> {
    const { storage } = await import("../../../../storage");
    const { start, end } = resolveWindow();
    const services = await storage.wcStats.countsByService({ start, end });

    if (services.length === 0) {
      // One message, not none: the collector turns an empty scan into a
      // "Scan returned no messages" warning, which would report a quiet
      // month as a fault.
      return [
        {
          priority: "info",
          title: `No outbound web service calls (${start} to ${end})`,
          details: `No external web service was called ${windowPhrase(start, end)}.`,
        },
      ];
    }

    // Busiest first, so the summary reads as a ranking; ties by name so the
    // order is stable between scans.
    return services
      .slice()
      .sort((a, b) => b.calls - a.calls || a.service.localeCompare(b.service))
      .map((row) => ({
        priority: "info" as const,
        // Self-describing on its own: a monitor reading this one line knows
        // the service, the count and the days it covers.
        title: `${row.service}: ${row.calls} outbound ${plural(row.calls)} (${start} to ${end})`,
        details: `Service '${row.service}' made ${row.calls} outbound ${plural(row.calls)} ${windowPhrase(start, end)}.`,
      }));
  },

  /**
   * The per-request-type drill-down. Never invoked by the collector and never
   * cached, so nothing here is visible to a monitoring consumer — anything
   * that must be machine-visible belongs in a scan message.
   */
  async details(): Promise<StatusDetails> {
    const { storage } = await import("../../../../storage");
    const { start, end } = resolveWindow();
    const counts = await storage.wcStats.countsByServiceType({ start, end });

    if (counts.length === 0) {
      return {
        groups: [
          {
            title: `${start} to ${end}`,
            rows: [
              {
                label: "No calls",
                description: `No external web service was called ${windowPhrase(start, end)}.`,
              },
            ],
          },
        ],
      };
    }

    const byService = new Map<
      string,
      { total: number; types: { requestType: string; calls: number }[] }
    >();
    for (const row of counts) {
      let group = byService.get(row.service);
      if (!group) {
        group = { total: 0, types: [] };
        byService.set(row.service, group);
      }
      group.total += row.calls;
      group.types.push({ requestType: row.requestType, calls: row.calls });
    }

    // Busiest service first, and busiest request type first inside it; ties
    // by name so the drill-down is stable between openings.
    const groups: StatusDetailGroup[] = Array.from(byService, ([service, group]) => ({
      service,
      ...group,
    }))
      .sort((a, b) => b.total - a.total || a.service.localeCompare(b.service))
      .map((entry) => ({
        title: `${entry.service} — ${entry.total} ${plural(entry.total)} (${start} to ${end})`,
        rows: entry.types
          .sort((a, b) => b.calls - a.calls || a.requestType.localeCompare(b.requestType))
          .map<StatusDetailRow>((type) => ({
            label: type.requestType,
            value: `${type.calls} ${plural(type.calls)}`,
          })),
      }));

    return { groups };
  },
});
