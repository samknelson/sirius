import { sql, and, eq, gte, lte, asc, type SQL } from 'drizzle-orm';
import { wsStats } from '@shared/schema';
import { addDaysYmd, type Ymd } from '@shared/utils/date';
import { getClient, isInTransaction, runInTransaction } from './transaction-context';

/**
 * How many incoming web service calls we served, per day — the inbound mirror
 * of `wc-stats`.
 *
 * The counter answers a question the request log cannot: the log is
 * per-request and pruned on a retention schedule, so "how much did this
 * partner use us last quarter" stops being answerable the moment the window
 * closes. These four dimensions — plugin, client, operation, day — are what a
 * usage screen filters and drills on, and nothing else is kept.
 *
 * "Client" is unfortunately two things in this file: the calling partner, and
 * the Drizzle handle. The partner is always `clientId`; the handle is always
 * `conn`.
 */

/** One day's calls, as counted for the filters asked for. */
export interface WsStatsDay {
  ymd: Ymd;
  calls: number;
}

/** A (plugin, client, operation) triple that has at least one counted call. */
export interface WsStatsDimension {
  pluginId: string;
  clientId: string;
  operation: string;
}

/** One plugin's calls, summed over the range asked for. */
export interface WsStatsPlugin {
  pluginId: string;
  calls: number;
}

/** One (plugin, operation) pair's calls, summed over the range asked for. */
export interface WsStatsPluginOperation {
  pluginId: string;
  operation: string;
  calls: number;
}

/** One calling client's calls, summed over the range asked for. */
export interface WsStatsClient {
  clientId: string;
  calls: number;
}

/** One (plugin, client, operation) triple's calls over the range asked for. */
export interface WsStatsDimensionCalls extends WsStatsDimension {
  calls: number;
}

/** Narrowing for the stats read. Every field is optional. */
export interface WsStatsFilters {
  pluginId?: string;
  clientId?: string;
  operation?: string;
}

export interface WsStatsRangeParams extends WsStatsFilters {
  /** Inclusive first day of the range. */
  start: Ymd;
  /** Inclusive last day of the range. */
  end: Ymd;
}

/**
 * Every figure one usage screen shows, counted over one range.
 *
 * They are returned together because they have to agree. A per-service total
 * shown beside its operation rows, and a chart above both, are read as one
 * account of the same traffic; if they were gathered separately they could
 * disagree by whatever arrived in between, and nothing on the screen would say
 * which of them was right.
 */
export interface WsStatsReport {
  /** Calls per day inside the range, oldest first. Days with none are absent. */
  days: WsStatsDay[];
  /** Every counted call in the range. Equal to the sum of each breakdown. */
  total: number;
  /**
   * Calls per plugin: "which of our services carries the traffic".
   *
   * Plugins with no calls in the range are absent — including one that is
   * registered but was never called, and including, conversely, one that has
   * counts but is no longer registered: this counts calls, not registrations,
   * so a retired service's traffic is still accounted for.
   */
  byPlugin: WsStatsPlugin[];
  /** Calls per (plugin, operation): the drill-down from a service into what was called on it. */
  byPluginOperation: WsStatsPluginOperation[];
  /** Calls per calling client: "who is using us". */
  byClient: WsStatsClient[];
  /** Calls per (plugin, client, operation): the finest grouping, which the rest roll up from. */
  byDimension: WsStatsDimensionCalls[];
}

/**
 * One name's calls over a usage window and on that window's last day.
 *
 * Whose name it is depends on the list it came from — a plugin's or a calling
 * client's — because both are counted off the same rows.
 */
export interface WsStatsUsageEntry {
  id: string;
  /** Calls counted on the window's last day. */
  today: number;
  /** Calls counted across the whole window, that last day included. */
  window: number;
}

export interface WsStatsUsageParams {
  /** Inclusive last day of the window, and the day `today` counts. */
  end: Ymd;
  /** How many days the window spans, counting `end` itself. At least one. */
  days: number;
}

/**
 * A window's traffic at a glance: per service and per caller, each with the
 * whole window and its last day.
 *
 * Both figures come out of one statement, so "today" is a subset of "the
 * window" by construction rather than by timing. Two reads could not promise
 * that: a call landing between them would count towards today and not towards
 * the week that contains today, and a card whose columns contradict each other
 * is worse than no card.
 */
export interface WsStatsUsage {
  /** Inclusive first day of the window, derived from `end` and `days`. */
  start: Ymd;
  /** Inclusive last day of the window, as asked for. */
  end: Ymd;
  /** Calls per plugin, busiest window first. Plugins with none are absent. */
  byPlugin: WsStatsUsageEntry[];
  /** Calls per calling client, busiest window first. Callers with none are absent. */
  byClient: WsStatsUsageEntry[];
}

export interface WsStatsStorage {
  /**
   * Count one served call against (plugin, client, operation, day).
   *
   * An atomic insert-or-increment on the uniqueness tuple: two calls landing
   * at once cannot read-modify-write over each other and lose a count.
   */
  recordCall(pluginId: string, clientId: string, operation: string, ymd: Ymd): Promise<void>;
  /**
   * Every figure for one range, read as one account of the traffic.
   *
   * Two grouped queries answer this — by dimension and by day — and they are
   * read inside a single read-only repeatable-read transaction, so a call
   * arriving mid-read lands in both of them or in neither. Everything coarser
   * is rolled up in memory from the dimension rows rather than asked for
   * separately, which is what makes the breakdowns add up to `total`.
   */
  report(params: WsStatsRangeParams): Promise<WsStatsReport>;
  /**
   * One window's traffic, per service and per caller, with its last day
   * counted alongside it.
   *
   * One grouped statement answers all of it — the last day is a filtered
   * aggregate over the same rows, and both breakdowns are rolled up from them
   * — so no transaction is needed to keep the four figures describing the same
   * calls. A statement is its own snapshot.
   */
  usage(params: WsStatsUsageParams): Promise<WsStatsUsage>;
  /**
   * Every (plugin, client, operation) the table has ever counted.
   *
   * Read from the counts rather than from the plugin registry so a filter can
   * offer what actually exists rather than what the registry currently
   * declares — an operation a release has since retired stays selectable, and
   * its calls are exactly the ones somebody looking at this screen wants to
   * account for.
   */
  listDimensions(): Promise<WsStatsDimension[]>;
}

function rangeCondition(params: WsStatsRangeParams): SQL {
  // The day is a Postgres `date`, compared against Ymd strings: no timezone
  // gets a chance to move a call to another day, and the range means the same
  // inclusive span it always did.
  const conditions: SQL[] = [gte(wsStats.ymd, params.start), lte(wsStats.ymd, params.end)];
  if (params.pluginId) conditions.push(eq(wsStats.pluginId, params.pluginId));
  if (params.clientId) conditions.push(eq(wsStats.clientId, params.clientId));
  if (params.operation) conditions.push(eq(wsStats.operation, params.operation));
  return and(...conditions) as SQL;
}

/**
 * The one range-grouped read. Every breakdown except the per-day one is rolled
 * up from this single query, so no two of them can disagree about which calls
 * fall inside the window — which is the whole reason a screen can show a
 * service total beside its operation rows and have them add up.
 */
async function readCountsByDimension(
  params: WsStatsRangeParams,
): Promise<WsStatsDimensionCalls[]> {
  const conn = getClient();
  const rows = await conn
    .select({
      pluginId: wsStats.pluginId,
      clientId: wsStats.clientId,
      operation: wsStats.operation,
      calls: sql<number>`sum(${wsStats.calls})::int`,
    })
    .from(wsStats)
    .where(rangeCondition(params))
    .groupBy(wsStats.pluginId, wsStats.clientId, wsStats.operation)
    .orderBy(asc(wsStats.pluginId), asc(wsStats.clientId), asc(wsStats.operation));
  return rows.map((row) => ({
    pluginId: row.pluginId,
    clientId: row.clientId,
    operation: row.operation,
    calls: Number(row.calls ?? 0),
  }));
}

/** Sum `calls` into buckets named by `key`, then sort by that name. */
function rollUp<T>(
  rows: WsStatsDimensionCalls[],
  key: (row: WsStatsDimensionCalls) => string,
  build: (name: string, calls: number) => T,
): T[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = key(row);
    totals.set(name, (totals.get(name) ?? 0) + row.calls);
  }
  return Array.from(totals)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, calls]) => build(name, calls));
}

/** Separator for composite roll-up keys; not a value any dimension can hold. */
const KEY_SEPARATOR = '\u0000';

/** Calls per day inside the range, oldest first. */
async function readCountsByDay(params: WsStatsRangeParams): Promise<WsStatsDay[]> {
  // The one read that does not come off the dimension query: the day is not
  // one of its grouping columns.
  const conn = getClient();
  const rows = await conn
    .select({
      ymd: wsStats.ymd,
      calls: sql<number>`sum(${wsStats.calls})::int`,
    })
    .from(wsStats)
    .where(rangeCondition(params))
    .groupBy(wsStats.ymd)
    .orderBy(asc(wsStats.ymd));
  return rows.map((row) => ({ ymd: row.ymd, calls: Number(row.calls ?? 0) }));
}

/**
 * Sum a window's counted rows into buckets named by `key`, busiest first.
 *
 * Ties are broken by name so the order is a fact about the counts rather than
 * about the order Postgres happened to return the groups in.
 */
function rollUpUsage(
  rows: Array<{ pluginId: string; clientId: string; today: number; window: number }>,
  key: (row: { pluginId: string; clientId: string }) => string,
): WsStatsUsageEntry[] {
  const totals = new Map<string, { today: number; window: number }>();
  for (const row of rows) {
    const id = key(row);
    const running = totals.get(id) ?? { today: 0, window: 0 };
    running.today += row.today;
    running.window += row.window;
    totals.set(id, running);
  }
  return Array.from(totals)
    .map(([id, counts]) => ({ id, ...counts }))
    .sort((a, b) => b.window - a.window || a.id.localeCompare(b.id));
}

/** Roll the two grouped reads up into the figures a usage screen shows. */
function buildReport(byDimension: WsStatsDimensionCalls[], days: WsStatsDay[]): WsStatsReport {
  return {
    days,
    // From the dimension rows, not from a count of its own: the total and the
    // breakdowns beneath it are then the same arithmetic over the same rows,
    // and cannot be made to disagree by anything at all.
    total: byDimension.reduce((sum, row) => sum + row.calls, 0),
    byPlugin: rollUp(byDimension, (row) => row.pluginId, (pluginId, calls) => ({
      pluginId,
      calls,
    })),
    byPluginOperation: rollUp(
      byDimension,
      (row) => `${row.pluginId}${KEY_SEPARATOR}${row.operation}`,
      (name, calls) => {
        const [pluginId, operation] = name.split(KEY_SEPARATOR);
        return { pluginId, operation, calls };
      },
    ),
    byClient: rollUp(byDimension, (row) => row.clientId, (clientId, calls) => ({
      clientId,
      calls,
    })),
    byDimension,
  };
}

export function createWsStatsStorage(): WsStatsStorage {
  return {
    async recordCall(
      pluginId: string,
      clientId: string,
      operation: string,
      ymd: Ymd,
    ): Promise<void> {
      const conn = getClient();
      await conn
        .insert(wsStats)
        .values({ pluginId, clientId, operation, ymd, calls: 1 })
        .onConflictDoUpdate({
          target: [wsStats.pluginId, wsStats.clientId, wsStats.operation, wsStats.ymd],
          set: { calls: sql`${wsStats.calls} + 1` },
        });
    },

    async report(params: WsStatsRangeParams): Promise<WsStatsReport> {
      const readBoth = async () =>
        buildReport(await readCountsByDimension(params), await readCountsByDay(params));

      if (isInTransaction()) {
        // Somebody else opened the transaction and therefore owns its
        // isolation level; changing it here would fail anyway, since Postgres
        // only accepts that before the transaction's first query.
        return readBoth();
      }

      return runInTransaction(async () => {
        // Repeatable read, so both grouped queries see one snapshot: a call
        // counted between them lands in both or in neither, and the chart
        // cannot end up describing a different set of calls than the
        // breakdowns beside it. Read only, because a reporting read that can
        // write is a reporting read that eventually does.
        await getClient().execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
        return readBoth();
      });
    },

    async usage(params: WsStatsUsageParams): Promise<WsStatsUsage> {
      if (!Number.isInteger(params.days) || params.days < 1) {
        throw new RangeError(`A usage window spans at least one day, not ${params.days}`);
      }
      const { end } = params;
      const start = addDaysYmd(end, -(params.days - 1));

      // One statement, deliberately. The last day is a filtered aggregate over
      // the very rows the window is summed from, and the two breakdowns are
      // rolled up from those same rows afterwards, so nothing here can report
      // a caller more calls today than it made all week.
      //
      // Which names appear is decided by the window, not by its last day: a
      // caller that was busy on Tuesday and silent today is still part of the
      // week's traffic and belongs in the answer, reporting zero for today.
      const conn = getClient();
      const rows = await conn
        .select({
          pluginId: wsStats.pluginId,
          clientId: wsStats.clientId,
          window: sql<number>`sum(${wsStats.calls})::int`,
          today: sql<number>`coalesce(sum(${wsStats.calls}) filter (where ${wsStats.ymd} = ${end}::date), 0)::int`,
        })
        .from(wsStats)
        .where(and(gte(wsStats.ymd, start), lte(wsStats.ymd, end)))
        .groupBy(wsStats.pluginId, wsStats.clientId);

      const counted = rows.map((row) => ({
        pluginId: row.pluginId,
        clientId: row.clientId,
        today: Number(row.today ?? 0),
        window: Number(row.window ?? 0),
      }));

      return {
        start,
        end,
        byPlugin: rollUpUsage(counted, (row) => row.pluginId),
        byClient: rollUpUsage(counted, (row) => row.clientId),
      };
    },

    async listDimensions(): Promise<WsStatsDimension[]> {
      const conn = getClient();
      return await conn
        .select({
          pluginId: wsStats.pluginId,
          clientId: wsStats.clientId,
          operation: wsStats.operation,
        })
        .from(wsStats)
        .groupBy(wsStats.pluginId, wsStats.clientId, wsStats.operation)
        .orderBy(asc(wsStats.pluginId), asc(wsStats.clientId), asc(wsStats.operation));
    },
  };
}
