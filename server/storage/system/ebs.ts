import { getClient } from '../transaction-context';
import {
  ebsDenorm,
  ebsStatus,
  type EbsDenorm,
  type EbsDeliveryStatus,
} from "@shared/schema";
import { eq, and, lte, gte, lt, isNull } from "drizzle-orm";

/**
 * The event to schedule for a single denorm entity. `denormId` ties the row to
 * its `denorm` status row (FK, cascade); `uniqueId` mirrors the denorm
 * `entity_id` and joins to the decoupled `ebs_status` delivery record.
 */
export interface EbsScheduledEventInput {
  denormId: string;
  uniqueId: string;
  pluginId: string;
  eventType: string;
  payload: unknown;
  sendOn: Date;
  dontSendAfter: Date;
}

/**
 * Storage for the deferred event bus (EBS) — the `ebs_denorm` payload table and
 * the decoupled `ebs_status` delivery-record table.
 *
 * `ebs_denorm` is written exclusively by EBS-scheduling denorm plugins (one row
 * per scheduled event) via {@link replaceForEntity}. `ebs_status` is written
 * exclusively by the generic `ebs_pump` cron as it drains due / expired events.
 */
export interface EbsStorage {
  /**
   * Replace the scheduled event for a denorm entity: delete any existing
   * `ebs_denorm` row for `denormId` and insert the new one. Caller wraps this in
   * the same transaction as the `denorm` status upsert (via `applyComputed`) so
   * status + payload stay consistent.
   */
  replaceForEntity(input: EbsScheduledEventInput): Promise<void>;
  /**
   * Up to `limit` scheduled events that are due to fire now: `send_on <= now`,
   * still within the window (`dont_send_after >= now`), and not yet terminal
   * (no `ebs_status` row for the `unique_id`). Oldest `send_on` first.
   */
  getDue(limit: number, now: Date): Promise<EbsDenorm[]>;
  /**
   * Up to `limit` scheduled events whose window has fully lapsed unfired:
   * `dont_send_after < now` and no `ebs_status` row. The pump records these as
   * `expired` (so they alert once, not every run) rather than delivering them.
   */
  getExpiredUnfired(limit: number, now: Date): Promise<EbsDenorm[]>;
  /**
   * Atomically claim a `uniqueId` for delivery by inserting its terminal
   * `sent` status record, returning `true` only for the caller that won the
   * claim. Because `ebs_status.unique_id` is unique, exactly one concurrent
   * pump run (in this process or any other instance) can win; the losers get
   * `false` and MUST NOT emit. This is what makes firing at-most-once even
   * under overlapping cron runs. The claim is taken *before* emitting on
   * purpose: it is strictly better to occasionally drop a reminder if the
   * process dies mid-emit than to deliver the same reminder twice. Retrying a
   * partial failure is deliberately NOT supported, because re-emitting the
   * whole event would re-run the handlers that already succeeded.
   */
  claimForDelivery(uniqueId: string): Promise<boolean>;
  /**
   * Record the terminal delivery outcome for a `uniqueId`. Idempotent: a second
   * call for the same `uniqueId` is a no-op (`ON CONFLICT DO NOTHING` on the
   * unique `unique_id`), so the first recorded outcome wins.
   */
  markStatus(uniqueId: string, status: EbsDeliveryStatus): Promise<void>;
  /**
   * Delete `ebs_status` rows created before `cutoff`, returning the number
   * removed. Retention purge: once an event's window is long past its
   * `ebs_denorm`/`denorm` rows have been widow-cleaned, so the orphaned status
   * record is safe to drop.
   */
  purgeStatusBefore(cutoff: Date): Promise<number>;
}

export function createEbsStorage(): EbsStorage {
  return {
    async replaceForEntity(input: EbsScheduledEventInput): Promise<void> {
      const client = getClient();
      await client.delete(ebsDenorm).where(eq(ebsDenorm.denormId, input.denormId));
      await client.insert(ebsDenorm).values({
        denormId: input.denormId,
        uniqueId: input.uniqueId,
        pluginId: input.pluginId,
        eventType: input.eventType,
        payload: input.payload,
        sendOn: input.sendOn,
        dontSendAfter: input.dontSendAfter,
      });
    },

    async getDue(limit: number, now: Date): Promise<EbsDenorm[]> {
      const client = getClient();
      const rows = await client
        .select({ ebs: ebsDenorm })
        .from(ebsDenorm)
        .leftJoin(ebsStatus, eq(ebsStatus.uniqueId, ebsDenorm.uniqueId))
        .where(
          and(
            isNull(ebsStatus.id),
            lte(ebsDenorm.sendOn, now),
            gte(ebsDenorm.dontSendAfter, now),
          ),
        )
        .orderBy(ebsDenorm.sendOn)
        .limit(limit);
      return rows.map((r) => r.ebs);
    },

    async getExpiredUnfired(limit: number, now: Date): Promise<EbsDenorm[]> {
      const client = getClient();
      const rows = await client
        .select({ ebs: ebsDenorm })
        .from(ebsDenorm)
        .leftJoin(ebsStatus, eq(ebsStatus.uniqueId, ebsDenorm.uniqueId))
        .where(and(isNull(ebsStatus.id), lt(ebsDenorm.dontSendAfter, now)))
        .orderBy(ebsDenorm.dontSendAfter)
        .limit(limit);
      return rows.map((r) => r.ebs);
    },

    async claimForDelivery(uniqueId: string): Promise<boolean> {
      const client = getClient();
      const inserted = await client
        .insert(ebsStatus)
        .values({ uniqueId, status: "sent" })
        .onConflictDoNothing({ target: ebsStatus.uniqueId })
        .returning({ id: ebsStatus.id });
      return inserted.length > 0;
    },

    async markStatus(uniqueId: string, status: EbsDeliveryStatus): Promise<void> {
      const client = getClient();
      await client
        .insert(ebsStatus)
        .values({ uniqueId, status })
        .onConflictDoNothing({ target: ebsStatus.uniqueId });
    },

    async purgeStatusBefore(cutoff: Date): Promise<number> {
      const client = getClient();
      const deleted = await client
        .delete(ebsStatus)
        .where(lt(ebsStatus.createdAt, cutoff))
        .returning({ id: ebsStatus.id });
      return deleted.length;
    },
  };
}
