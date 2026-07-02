import { logger } from "../../logger";
import { broadcastNotificationSummary } from "../../services/websocket";
import type { NotificationMedium } from "./types";

const SERVICE = "event-notifier-flash-summary";

/**
 * How long we collect per-user notification tallies before flushing a single
 * combined summary to that user. One user action can fire several events and
 * match several configs, each dispatched as its own bus emit; debouncing over
 * this window coalesces the whole fan-out into one toast instead of a flood of
 * fragments. The timer resets on every recorded send, so it flushes shortly
 * after the last notification for the action settles.
 */
const DEBOUNCE_MS = 1000;

type MediumCounts = Partial<Record<NotificationMedium, number>>;

interface PendingSummary {
  counts: MediumCounts;
  timer: NodeJS.Timeout;
}

const pendingByUser = new Map<string, PendingSummary>();

/**
 * Record one successfully-sent notification, attributed to the acting user who
 * triggered the underlying event. Accumulates a per-medium tally and (re)arms a
 * short debounce timer; when the timer fires the combined summary is pushed to
 * that user over the per-user WebSocket channel. Only call this once a send has
 * actually succeeded — skipped/throttled/failed sends must not be counted.
 */
export function recordSentNotification(
  userId: string,
  medium: NotificationMedium,
): void {
  let pending = pendingByUser.get(userId);
  if (!pending) {
    pending = { counts: {}, timer: setTimeout(() => flush(userId), DEBOUNCE_MS) };
    pendingByUser.set(userId, pending);
  } else {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => flush(userId), DEBOUNCE_MS);
  }
  pending.counts[medium] = (pending.counts[medium] ?? 0) + 1;
}

/** Push the accumulated summary for one user and clear their pending tally. */
function flush(userId: string): void {
  const pending = pendingByUser.get(userId);
  if (!pending) return;
  pendingByUser.delete(userId);

  const counts = pending.counts;
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
  if (total === 0) return;

  try {
    broadcastNotificationSummary(userId, counts);
  } catch (error) {
    logger.warn("Failed to push notification summary", {
      service: SERVICE,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
