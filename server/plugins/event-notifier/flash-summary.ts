import { randomUUID } from "crypto";
import { logger } from "../../logger";
import {
  broadcastNotificationSummary,
  onNotificationSummaryAck,
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
 * How long an unacknowledged summary stays in the outbox waiting for the client
 * to confirm it rendered the toast. Each summary is re-sent on every reconnect
 * within this window, so it survives a momentary disconnect (navigation, dev
 * reload, brief network blip) or delivery to a socket the browser had already
 * abandoned. After the window it is dropped so a stale toast never appears long
 * after the action.
 */
const UNACKED_TTL_MS = 30000;

type MediumCounts = Partial<Record<NotificationMedium, number>>;

interface PendingSummary {
  counts: MediumCounts;
  timer: NodeJS.Timeout;
}

const pendingByUser = new Map<string, PendingSummary>();

interface OutboxEntry {
  id: string;
  counts: MediumCounts;
  /** Fires after UNACKED_TTL_MS to drop the summary if never acknowledged. */
  timer: NodeJS.Timeout;
}

/**
 * Flushed summaries awaiting a client ack, keyed by user then by summary id. A
 * socket being server-OPEN is not proof the client received the message, so a
 * summary is held here until the browser explicitly acks it (or the TTL fires).
 * Every entry is (re-)sent when the user connects, guaranteeing the toast lands
 * even if the original send went to a zombie socket.
 */
const outboxByUser = new Map<string, Map<string, OutboxEntry>>();

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

  enqueueAndSend(userId, counts);
}

/**
 * Give the summary a stable id, park it in the per-user outbox under a fresh
 * TTL, and attempt a first send. The entry stays in the outbox until the client
 * acks it (see the onNotificationSummaryAck hook) or the TTL fires, so a send
 * that lands on a zombie/half-open socket is retried on the next real connect
 * rather than being silently lost.
 */
function enqueueAndSend(userId: string, counts: MediumCounts): void {
  const id = randomUUID();
  let byId = outboxByUser.get(userId);
  if (!byId) {
    byId = new Map();
    outboxByUser.set(userId, byId);
  }
  const entry: OutboxEntry = {
    id,
    counts,
    timer: setTimeout(() => dropOutboxEntry(userId, id), UNACKED_TTL_MS),
  };
  byId.set(id, entry);
  sendEntry(userId, entry);
}

/** Push one outbox entry to the user's open sockets (best-effort). */
function sendEntry(userId: string, entry: OutboxEntry): void {
  try {
    broadcastNotificationSummary(userId, entry.id, entry.counts);
  } catch (error) {
    logger.warn("Failed to push notification summary", {
      service: SERVICE,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Remove one outbox entry and clear its TTL timer, tidying empty user maps. */
function dropOutboxEntry(userId: string, id: string): void {
  const byId = outboxByUser.get(userId);
  if (!byId) return;
  const entry = byId.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    byId.delete(id);
  }
  if (byId.size === 0) outboxByUser.delete(userId);
}

// A summary is confirmed delivered only when the client acks it; drop it so it
// is not re-sent on the next reconnect.
onNotificationSummaryAck((userId: string, id: string) => {
  dropOutboxEntry(userId, id);
});

// Re-send every still-unacked summary the moment the user (re)connects. The
// client de-dupes by id, so replaying one it already showed re-triggers the ack
// (clearing the outbox) without showing a second toast.
onUserConnected((userId: string) => {
  const byId = outboxByUser.get(userId);
  if (!byId) return;
  byId.forEach((entry) => {
    sendEntry(userId, entry);
  });
});
