import { getClient } from '../transaction-context';
import {
  ebsDenorm,
  ebsStatus,
  type EbsDenorm,
  type EbsStatus,
  type EbsDeliveryStatus,
} from "@shared/schema";
import { eq, and, lte, gte, lt, isNull, ilike, desc, sql } from "drizzle-orm";

/**
 * The event to schedule for a single denorm entity. `denormId` ties the row to
 * its `denorm` status row (FK, cascade); `uniqueId` mirrors the denorm
 * `entity_id` and joins to the decoupled `ebs_status` delivery record.
 */
export interface EbsScheduledEventInput {
  denormId: string;
  uniqueId: string;
  pluginId: string;
  /** Owning subject the event is about (e.g. the worker id). Indexed. */
  subjectId: string;
  eventType: string;
  payload: unknown;
  sendOn: Date;
  dontSendAfter: Date;
}

/** Common inspection filters for the read-only EBS admin views. */
export interface EbsListFilters {
  /** Exact `event_type` match (from `ebs_denorm`). */
  eventType?: string;
  /** Case-insensitive substring match on `subject_id` (the "Owner ID"). */
  subjectId?: string;
  /** Inclusive lower bound on the view's date column. */
  from?: Date;
  /** Inclusive upper bound on the view's date column. */
  to?: Date;
}

export interface EbsListParams extends EbsListFilters {
  page: number;
  pageSize: number;
}

/**
 * A scheduled event (`ebs_denorm`) decorated with its terminal delivery record
 * (`ebs_status`) when one exists. `status` is null while the event is still
 * pending.
 */
export interface EbsScheduledRow {
  denorm: EbsDenorm;
  status: EbsStatus | null;
}

/**
 * A terminal delivery record (`ebs_status`) decorated with its originating
 * scheduled event (`ebs_denorm`) when it still exists. `denorm` is null when the
 * status has outlived its scheduled event (they are intentionally decoupled).
 */
export interface EbsSentRow {
  status: EbsStatus;
  denorm: EbsDenorm | null;
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
   *
   * `purgeAfter` is stored on the claimed row so the retention purge is
   * row-safe (see {@link purgeExpired}).
   */
  claimForDelivery(uniqueId: string, purgeAfter: Date): Promise<boolean>;
  /**
   * Record the terminal delivery outcome for a `uniqueId`. Idempotent: a second
   * call for the same `uniqueId` is a no-op (`ON CONFLICT DO NOTHING` on the
   * unique `unique_id`), so the first recorded outcome wins. `purgeAfter` drives
   * the row-safe retention purge (see {@link purgeExpired}).
   */
  markStatus(uniqueId: string, status: EbsDeliveryStatus, purgeAfter: Date): Promise<void>;
  /**
   * Delete `ebs_status` rows whose `purge_after` cutoff has passed (`< now`),
   * returning the number removed. Because `purge_after` is derived from each
   * event's `dont_send_after`, a status row is only removed once its scheduling
   * window is long past — so the purge can never re-open a still-in-window
   * event (which would let `getDue` re-fire it).
   */
  purgeExpired(now: Date): Promise<number>;

  // ── Read-only inspection (admin EBS pages) ──────────────────────────────────

  /**
   * Paginated scheduled events (`ebs_denorm`) LEFT JOINed to their terminal
   * status (`ebs_status`) on `unique_id`, newest `send_on` first. Filters by
   * `event_type`, `subject_id` substring, and a `send_on` date range.
   */
  listScheduled(params: EbsListParams): Promise<EbsScheduledRow[]>;
  /** Count of scheduled events matching the same filters as {@link listScheduled}. */
  countScheduled(filters: EbsListFilters): Promise<number>;

  /**
   * Paginated terminal delivery records (`ebs_status`) LEFT JOINed to their
   * originating scheduled event (`ebs_denorm`) on `unique_id`, newest
   * `created_at` first. Filters by `event_type` and `subject_id` (both from the
   * joined `ebs_denorm`, so they only match rows whose scheduled event still
   * exists) and by a `created_at` date range.
   */
  listSent(params: EbsListParams): Promise<EbsSentRow[]>;
  /** Count of delivery records matching the same filters as {@link listSent}. */
  countSent(filters: EbsListFilters): Promise<number>;

  /** Distinct `event_type` values across `ebs_denorm`, sorted, for the filter dropdown. */
  distinctEventTypes(): Promise<string[]>;

  /** A single scheduled event by id, decorated with its status (if terminal yet). */
  getScheduledById(id: string): Promise<EbsScheduledRow | null>;
  /** A single delivery record by id, decorated with its scheduled event (if still present). */
  getSentById(id: string): Promise<EbsSentRow | null>;
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
        subjectId: input.subjectId,
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

    async claimForDelivery(uniqueId: string, purgeAfter: Date): Promise<boolean> {
      const client = getClient();
      const inserted = await client
        .insert(ebsStatus)
        .values({ uniqueId, status: "sent", purgeAfter })
        .onConflictDoNothing({ target: ebsStatus.uniqueId })
        .returning({ id: ebsStatus.id });
      return inserted.length > 0;
    },

    async markStatus(
      uniqueId: string,
      status: EbsDeliveryStatus,
      purgeAfter: Date,
    ): Promise<void> {
      const client = getClient();
      await client
        .insert(ebsStatus)
        .values({ uniqueId, status, purgeAfter })
        .onConflictDoNothing({ target: ebsStatus.uniqueId });
    },

    async purgeExpired(now: Date): Promise<number> {
      const client = getClient();
      const deleted = await client
        .delete(ebsStatus)
        .where(lt(ebsStatus.purgeAfter, now))
        .returning({ id: ebsStatus.id });
      return deleted.length;
    },

    async listScheduled(params: EbsListParams): Promise<EbsScheduledRow[]> {
      const client = getClient();
      const rows = await client
        .select({ denorm: ebsDenorm, status: ebsStatus })
        .from(ebsDenorm)
        .leftJoin(ebsStatus, eq(ebsStatus.uniqueId, ebsDenorm.uniqueId))
        .where(scheduledFilterCondition(params))
        .orderBy(desc(ebsDenorm.sendOn), desc(ebsDenorm.id))
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize);
      return rows.map((r) => ({ denorm: r.denorm, status: r.status }));
    },

    async countScheduled(filters: EbsListFilters): Promise<number> {
      const client = getClient();
      const [row] = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(ebsDenorm)
        .where(scheduledFilterCondition(filters));
      return row?.count ?? 0;
    },

    async listSent(params: EbsListParams): Promise<EbsSentRow[]> {
      const client = getClient();
      const rows = await client
        .select({ status: ebsStatus, denorm: ebsDenorm })
        .from(ebsStatus)
        .leftJoin(ebsDenorm, eq(ebsDenorm.uniqueId, ebsStatus.uniqueId))
        .where(sentFilterCondition(params))
        .orderBy(desc(ebsStatus.createdAt), desc(ebsStatus.id))
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize);
      return rows.map((r) => ({ status: r.status, denorm: r.denorm }));
    },

    async countSent(filters: EbsListFilters): Promise<number> {
      const client = getClient();
      const [row] = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(ebsStatus)
        .leftJoin(ebsDenorm, eq(ebsDenorm.uniqueId, ebsStatus.uniqueId))
        .where(sentFilterCondition(filters));
      return row?.count ?? 0;
    },

    async distinctEventTypes(): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .selectDistinct({ eventType: ebsDenorm.eventType })
        .from(ebsDenorm)
        .orderBy(ebsDenorm.eventType);
      return rows.map((r) => r.eventType);
    },

    async getScheduledById(id: string): Promise<EbsScheduledRow | null> {
      const client = getClient();
      const [row] = await client
        .select({ denorm: ebsDenorm, status: ebsStatus })
        .from(ebsDenorm)
        .leftJoin(ebsStatus, eq(ebsStatus.uniqueId, ebsDenorm.uniqueId))
        .where(eq(ebsDenorm.id, id))
        .limit(1);
      if (!row) return null;
      return { denorm: row.denorm, status: row.status };
    },

    async getSentById(id: string): Promise<EbsSentRow | null> {
      const client = getClient();
      const [row] = await client
        .select({ status: ebsStatus, denorm: ebsDenorm })
        .from(ebsStatus)
        .leftJoin(ebsDenorm, eq(ebsDenorm.uniqueId, ebsStatus.uniqueId))
        .where(eq(ebsStatus.id, id))
        .limit(1);
      if (!row) return null;
      return { status: row.status, denorm: row.denorm };
    },
  };
}

/**
 * WHERE clause shared by {@link EbsStorage.listScheduled} and its count, applied
 * to the `ebs_denorm` side. Returns `undefined` when no filter is active so the
 * query selects everything.
 */
function scheduledFilterCondition(filters: EbsListFilters) {
  const conditions = [];
  if (filters.eventType) conditions.push(eq(ebsDenorm.eventType, filters.eventType));
  if (filters.subjectId) conditions.push(ilike(ebsDenorm.subjectId, `%${filters.subjectId}%`));
  if (filters.from) conditions.push(gte(ebsDenorm.sendOn, filters.from));
  // `to` is inclusive of the whole selected day: the UI sends a date at
  // midnight, so use a half-open upper bound (`< to + 1 day`) rather than
  // `<= to`, which would drop every row later than midnight on that date.
  if (filters.to) conditions.push(lt(ebsDenorm.sendOn, endExclusive(filters.to)));
  return conditions.length ? and(...conditions) : undefined;
}

/**
 * WHERE clause shared by {@link EbsStorage.listSent} and its count. The
 * event-type and subject filters live on the joined `ebs_denorm`, so they only
 * match delivery records whose scheduled event still exists; the date range is
 * on the `ebs_status.created_at` column that always exists.
 */
function sentFilterCondition(filters: EbsListFilters) {
  const conditions = [];
  if (filters.eventType) conditions.push(eq(ebsDenorm.eventType, filters.eventType));
  if (filters.subjectId) conditions.push(ilike(ebsDenorm.subjectId, `%${filters.subjectId}%`));
  if (filters.from) conditions.push(gte(ebsStatus.createdAt, filters.from));
  // Inclusive of the whole selected day — see `scheduledFilterCondition`.
  if (filters.to) conditions.push(lt(ebsStatus.createdAt, endExclusive(filters.to)));
  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Half-open upper bound for an inclusive-of-the-whole-day `to` date filter:
 * returns the instant 24h after `to`, so a `< endExclusive(to)` comparison
 * matches every row on the selected end date (the UI sends `to` at midnight).
 */
function endExclusive(to: Date): Date {
  return new Date(to.getTime() + 24 * 60 * 60 * 1000);
}
