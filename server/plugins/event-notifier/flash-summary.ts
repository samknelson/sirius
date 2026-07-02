import { logger } from "../../logger";
import {
  broadcastNotificationSummary,
  onUserConnected,
} from "../../services/websocket";
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

/**
 * How long a summary that could not be delivered (the user had no open socket
 * when it flushed) is retained for replay on their next reconnect. The toast is
 * a "your action just sent these" confirmation, so a short window is enough to
 * survive a momentary disconnect (navigation, dev reload, brief network blip)
 * without ever showing a stale toast long after the action.
 */
const UNDELIVERED_TTL_MS = 30000;

type MediumCounts = Partial<Record<NotificationMedium, number>>;

interface PendingSummary {
  counts: MediumCounts;
  timer: NodeJS.Timeout;
}

const pendingByUser = new Map<string, PendingSummary>();

interface UndeliveredSummary {
  counts: MediumCounts;
  /** Fires after UNDELIVERED_TTL_MS to drop the summary if never replayed. */
  timer: NodeJS.Timeout;
}

/**
 * Summaries that flushed while the user had no open socket. Held per user and
 * replayed the next time that user connects (see the onUserConnected hook at
 * the bottom of this module), then dropped. Bounded by the TTL timer so a user
 * who never reconnects does not leak an entry.
 */
const undeliveredByUser = new Map<string, UndeliveredSummary>();

function mergeCounts(target: MediumCounts, source: MediumCounts): void {
  for (const medium of Object.keys(source) as NotificationMedium[]) {
    target[medium] = (target[medium] ?? 0) + (source[medium] ?? 0);
  }
}

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

  deliverOrRetain(userId, counts);
}

/**
 * Try to push the summary over the user's open socket. If they have no open
 * connection right now, retain it so it can be replayed when they reconnect —
 * otherwise a momentary disconnect around the action would silently swallow the
 * toast even though the notifications went out.
 */
function deliverOrRetain(userId: string, counts: MediumCounts): void {
  let delivered = false;
  try {
    delivered = broadcastNotificationSummary(userId, counts);
  } catch (error) {
    logger.warn("Failed to push notification summary", {
      service: SERVICE,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!delivered) retainUndelivered(userId, counts);
}

/**
 * Buffer a summary that could not be delivered, merging into any existing
 * buffered summary for the user, and (re)arm the TTL so it is dropped if the
 * user never reconnects within the window.
 */
function retainUndelivered(userId: string, counts: MediumCounts): void {
  let entry = undeliveredByUser.get(userId);
  if (entry) {
    clearTimeout(entry.timer);
    mergeCounts(entry.counts, counts);
  } else {
    entry = { counts: { ...counts }, timer: undefined as unknown as NodeJS.Timeout };
    undeliveredByUser.set(userId, entry);
  }
  entry.timer = setTimeout(() => {
    undeliveredByUser.delete(userId);
  }, UNDELIVERED_TTL_MS);
}

// Replay a buffered summary the moment the user reconnects. If delivery fails
// again (e.g. the socket is not usable), deliverOrRetain re-buffers it under a
// fresh TTL rather than looping.
onUserConnected((userId: string) => {
  const entry = undeliveredByUser.get(userId);
  if (!entry) return;
  undeliveredByUser.delete(userId);
  clearTimeout(entry.timer);
  deliverOrRetain(userId, entry.counts);
});
