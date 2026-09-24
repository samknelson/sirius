import {
  eventBus,
  EventType,
  type EventPayloadMap,
  type EmitFailure,
} from "./event-bus";
import type { EbsDenorm } from "@shared/schema";

/**
 * Shared firing primitives for the deferred event bus (EBS), used by BOTH the
 * generic `ebs_pump` cron and the admin "Send now" / "Resend" manual path so
 * the two fire through identical code.
 */

/** Days past an event's window close that its `ebs_status` row is retained. */
export const RETENTION_DAYS = 90;

const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Row-safe purge cutoff for a scheduled event's status row: {@link RETENTION_DAYS}
 * after its window closes (`dont_send_after`). The purge only removes rows whose
 * cutoff is in the past, so a status can never be dropped while its event could
 * still fire (`getDue` requires `dont_send_after >= now`).
 */
export function purgeAfterFor(dontSendAfter: Date): Date {
  return new Date(dontSendAfter.getTime() + RETENTION_MS);
}

/**
 * Purge cutoff for a status row written *now* (the manual fire path), rather
 * than off the event's original `dont_send_after` — which, for an old event, is
 * already in the past and would make a freshly re-fired row immediately
 * purgeable. {@link RETENTION_DAYS} past the moment of firing.
 */
export function purgeAfterFromNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + RETENTION_MS);
}

/**
 * Emit a single scheduled (denorm) event on the real event bus, returning the
 * per-handler failures (empty array = every handler ran cleanly). This is the
 * one place the `event_type` / `payload` cast lives, so the cron and the manual
 * fire path stay byte-for-byte identical in how they emit.
 */
export function emitDenormEvent(
  row: Pick<EbsDenorm, "eventType" | "payload">,
): Promise<EmitFailure[]> {
  return eventBus.emitWithFailures(
    row.eventType as EventType,
    row.payload as EventPayloadMap[EventType],
  );
}
