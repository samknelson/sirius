import { sql, and, eq, gte, lte, asc, type SQL } from 'drizzle-orm';
import { wcStats } from '@shared/schema';
import type { Ymd } from '@shared/utils/date';
import { getClient } from './transaction-context';

/**
 * How many outbound third-party calls we actually made, per day.
 *
 * Deliberately a leaf, for the same reason as `wc-cache`: it imports the
 * transaction context and the schema and nothing else, because the wrapper in
 * `server/services/webclient` reaches it directly rather than through the
 * storage barrel, and the barrel pulls in modules that themselves normalize
 * arguments through code that makes outbound requests.
 *
 * The counter answers a question the cache cannot: the cache holds one row per
 * request key carrying only the last attempt, and an uncached request type
 * writes to it not at all.
 */

/** One day's calls, as counted for the filters asked for. */
export interface WcStatsDay {
  ymd: Ymd;
  calls: number;
}

/** One service's calls, summed over the range asked for. */
export interface WcStatsService {
  service: string;
  calls: number;
}

/** A (service, request type) pair that has at least one counted call. */
export interface WcStatsDimension {
  service: string;
  requestType: string;
}

/** One (service, request type) pair's calls, summed over the range asked for. */
export interface WcStatsServiceType extends WcStatsDimension {
  calls: number;
}

/** Narrowing for the stats read. Every field is optional. */
export interface WcStatsFilters {
  service?: string;
  requestType?: string;
}

export interface WcStatsRangeParams extends WcStatsFilters {
  /** Inclusive first day of the range. */
  start: Ymd;
  /** Inclusive last day of the range. */
  end: Ymd;
}

export interface WcStatsStorage {
  /**
   * Count one call against (service, request type, day).
   *
   * An atomic insert-or-increment on the uniqueness tuple: two calls landing
   * at once cannot read-modify-write over each other and lose a count.
   */
  recordCall(service: string, requestType: string, ymd: Ymd): Promise<void>;
  /** Calls per day inside the range, oldest first. Days with none are absent. */
  countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]>;
  /**
   * Calls per (service, request type) inside the range, by service then
   * request type. The finest grouping the counter can answer for a range,
   * and the one {@link WcStatsStorage.countsByService} is rolled up from.
   *
   * Same absence rule as the per-service total: a pair with no calls in the
   * range is simply not there, and a pair the behavior registry no longer
   * knows about still is — this reads the counts, not the registry.
   */
  countsByServiceType(params: WcStatsRangeParams): Promise<WcStatsServiceType[]>;
  /**
   * Calls per service inside the range, by service name. Services with no
   * calls in the range are absent — including a service that is registered
   * but was never called, and including, conversely, a service that has
   * counts but is no longer registered: this reads the counts, not the
   * behavior registry, so a retired service's calls are still accounted for.
   *
   * Rolled up from the per-(service, request type) read above rather than
   * asking the table a second, coarser question of its own: the dashboard
   * usage widget and the system-status entry both want "the last N days for
   * this service", and only one query is allowed to decide which calls that
   * means, or the two surfaces can quietly disagree.
   */
  countsByService(params: WcStatsRangeParams): Promise<WcStatsService[]>;
  /**
   * Every (service, request type) the table has ever counted.
   *
   * Read from the counts rather than from the behavior registry so a request
   * type a release has since retired stays selectable — its calls are exactly
   * the ones somebody looking at this screen wants to account for.
   */
  listDimensions(): Promise<WcStatsDimension[]>;
}

function rangeCondition(params: WcStatsRangeParams): SQL {
  // The day is a Postgres `date`, compared against Ymd strings: no timezone
  // gets a chance to move a call to another day, and the range means the same
  // inclusive span it always did.
  const conditions: SQL[] = [gte(wcStats.ymd, params.start), lte(wcStats.ymd, params.end)];
  if (params.service) conditions.push(eq(wcStats.service, params.service));
  if (params.requestType) conditions.push(eq(wcStats.requestType, params.requestType));
  return and(...conditions) as SQL;
}

/**
 * The one range-grouped read. Both the per-(service, request type) breakdown
 * and the per-service total are answered from this single query, so the two
 * can never disagree about which calls fall inside the window.
 */
async function readCountsByServiceType(
  params: WcStatsRangeParams,
): Promise<WcStatsServiceType[]> {
  const client = getClient();
  const rows = await client
    .select({
      service: wcStats.service,
      requestType: wcStats.requestType,
      calls: sql<number>`sum(${wcStats.calls})::int`,
    })
    .from(wcStats)
    // The same range/filter builder every other read uses.
    .where(rangeCondition(params))
    .groupBy(wcStats.service, wcStats.requestType)
    .orderBy(asc(wcStats.service), asc(wcStats.requestType));
  return rows.map((row) => ({
    service: row.service,
    requestType: row.requestType,
    calls: Number(row.calls ?? 0),
  }));
}

export function createWcStatsStorage(): WcStatsStorage {
  return {
    async recordCall(service: string, requestType: string, ymd: Ymd): Promise<void> {
      const client = getClient();
      await client
        .insert(wcStats)
        .values({ service, requestType, ymd, calls: 1 })
        .onConflictDoUpdate({
          target: [wcStats.service, wcStats.requestType, wcStats.ymd],
          set: { calls: sql`${wcStats.calls} + 1` },
        });
    },

    async countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]> {
      const client = getClient();
      const rows = await client
        .select({
          ymd: wcStats.ymd,
          calls: sql<number>`sum(${wcStats.calls})::int`,
        })
        .from(wcStats)
        .where(rangeCondition(params))
        .groupBy(wcStats.ymd)
        .orderBy(asc(wcStats.ymd));
      return rows.map((row) => ({ ymd: row.ymd, calls: Number(row.calls ?? 0) }));
    },

    async countsByServiceType(params: WcStatsRangeParams): Promise<WcStatsServiceType[]> {
      return readCountsByServiceType(params);
    },

    async countsByService(params: WcStatsRangeParams): Promise<WcStatsService[]> {
      // A roll-up of the finer grouping, not a second query: summing the
      // request types of a service is exactly the coarser aggregate, and
      // doing it this way leaves one place that decides what the range means.
      const totals = new Map<string, number>();
      for (const row of await readCountsByServiceType(params)) {
        totals.set(row.service, (totals.get(row.service) ?? 0) + row.calls);
      }
      return Array.from(totals, ([service, calls]) => ({ service, calls })).sort((a, b) =>
        a.service.localeCompare(b.service),
      );
    },

    async listDimensions(): Promise<WcStatsDimension[]> {
      const client = getClient();
      const rows = await client
        .select({ service: wcStats.service, requestType: wcStats.requestType })
        .from(wcStats)
        .groupBy(wcStats.service, wcStats.requestType)
        .orderBy(asc(wcStats.service), asc(wcStats.requestType));
      return rows;
    },
  };
}

export const wcStatsStorage = createWcStatsStorage();
