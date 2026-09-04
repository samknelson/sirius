/**
 * The inbound call counter's storage: how a count is written, and how one
 * range report is read.
 *
 * Two properties are worth pinning down here and are cheap to lose in a later
 * edit. First, the write is a single insert-or-increment against the named
 * uniqueness constraint — the moment it becomes a read-then-write, two calls
 * arriving together silently collapse into one. Second, the report's figures
 * are one account of the same traffic: the coarser breakdowns are rolled up
 * from one grouped read rather than asked for separately, and the two grouped
 * reads that remain are taken in one declared snapshot.
 *
 * The database is stubbed. That is the point for the roll-ups (they are pure
 * arithmetic over rows) and a deliberate limit for the rest: this proves the
 * statements' *shape* and *order*, not Postgres's behavior under real
 * concurrency. What follows from that shape is the actual guarantee — the
 * uniqueness constraint the write targets, asserted here against the schema
 * declaration so the two cannot drift, and the isolation level the report
 * declares before it reads anything.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wsStats } from '@shared/schema';

/** Rows the stubbed dimension query will return. */
let rangeRows: Array<{ pluginId: string; clientId: string; operation: string; calls: number }> = [];
/** Rows the stubbed per-day query will return. */
let dayRows: Array<{ ymd: string; calls: number }> = [];
/** Rows the stubbed usage-window query will return. */
let usageRows: Array<{ pluginId: string; clientId: string; today: number; window: number }> = [];
/** What `recordCall` handed to the database, if anything. */
let write: { values?: any; conflict?: any } = {};
/** Everything the storage did to the database, in order. */
let events: string[] = [];
/** Whether a caller already opened a transaction around the storage call. */
let callerHasTransaction = false;
const selectSpy = vi.fn();

/** The literal text of a drizzle `sql` fragment that carries no parameters. */
function sqlText(fragment: any): string {
  return (fragment?.queryChunks ?? [])
    .map((chunk: any) => (Array.isArray(chunk?.value) ? chunk.value.join('') : ''))
    .join('');
}

function stubConnection() {
  const chain: any = {};
  let reading: 'dimensions' | 'days' | 'usage' = 'dimensions';
  chain.select = (fields: Record<string, unknown>) => {
    selectSpy(fields);
    reading =
      'window' in fields
        ? 'usage'
        : 'ymd' in fields && !('operation' in fields)
          ? 'days'
          : 'dimensions';
    return chain;
  };
  chain.from = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => {
    // The usage read ends here: it asks for no ordering, because busiest-first
    // is arithmetic over the groups rather than something SQL is asked for.
    if (reading === 'usage') {
      events.push('read usage');
      return Promise.resolve(usageRows);
    }
    return chain;
  };
  chain.orderBy = () => {
    events.push(reading === 'days' ? 'read days' : 'read dimensions');
    return Promise.resolve(reading === 'days' ? dayRows : rangeRows);
  };
  chain.execute = (fragment: unknown) => {
    events.push(`execute ${sqlText(fragment)}`);
    return Promise.resolve();
  };
  chain.insert = () => ({
    values: (values: unknown) => {
      write.values = values;
      return {
        onConflictDoUpdate: (conflict: unknown) => {
          write.conflict = conflict;
          return Promise.resolve();
        },
      };
    },
  });
  return chain;
}

vi.mock('../../server/storage/transaction-context', () => ({
  getClient: () => stubConnection(),
  isInTransaction: () => callerHasTransaction,
  runInTransaction: async (fn: () => Promise<unknown>) => {
    events.push('begin');
    try {
      return await fn();
    } finally {
      events.push('commit');
    }
  },
}));

const { createWsStatsStorage } = await import('../../server/storage/ws-stats');

const storage = createWsStatsStorage();
const RANGE = { start: '2026-08-01' as const, end: '2026-08-31' as const };

beforeEach(() => {
  rangeRows = [];
  dayRows = [];
  usageRows = [];
  write = {};
  events = [];
  callerHasTransaction = false;
  selectSpy.mockClear();
});

describe('counting a call', () => {
  it('is one insert-or-increment, never a read-then-write', async () => {
    await storage.recordCall('ping-v1', 'client-1', 'ping', '2026-08-31');

    expect(write.values).toEqual({
      pluginId: 'ping-v1',
      clientId: 'client-1',
      operation: 'ping',
      ymd: '2026-08-31',
      calls: 1,
    });
    // Nothing was read first. A read-then-write loses a count whenever two
    // calls interleave between the read and the write.
    expect(selectSpy).not.toHaveBeenCalled();
    // And the update is relative, not a value computed in JavaScript.
    expect(String(write.conflict.set.calls)).toBeTruthy();
    expect(write.conflict.set.calls).toHaveProperty('queryChunks');
  });

  it('targets exactly the columns the unique constraint covers', () => {
    // The conflict target and the constraint have to be the same tuple: a
    // conflict target Postgres cannot match an index for is an error, and a
    // constraint narrower than the target would merge counts that belong to
    // different callers.
    const { uniqueConstraints } = getTableConfig(wsStats);
    expect(uniqueConstraints).toHaveLength(1);
    expect(uniqueConstraints[0].name).toBe('ws_stats_plugin_client_operation_ymd_uniq');
    expect(uniqueConstraints[0].columns.map((column) => column.name)).toEqual([
      'plugin_id',
      'client_id',
      'operation',
      'ymd',
    ]);
  });

  it('conflicts on those same columns', async () => {
    await storage.recordCall('ping-v1', 'client-1', 'ping', '2026-08-31');

    expect(write.conflict.target).toEqual([
      wsStats.pluginId,
      wsStats.clientId,
      wsStats.operation,
      wsStats.ymd,
    ]);
  });
});

describe('reading one report', () => {
  beforeEach(() => {
    rangeRows = [
      { pluginId: 'edls', clientId: 'partner-a', operation: 'accept', calls: 3 },
      { pluginId: 'edls', clientId: 'partner-a', operation: 'decline', calls: 1 },
      { pluginId: 'edls', clientId: 'partner-b', operation: 'accept', calls: 5 },
      { pluginId: 'roster', clientId: 'partner-b', operation: 'sync', calls: 2 },
    ];
    dayRows = [
      { ymd: '2026-08-01', calls: 4 },
      { ymd: '2026-08-02', calls: 7 },
    ];
  });

  it('takes both grouped reads in one snapshot, declared before either of them', async () => {
    await storage.report(RANGE);

    // The order is the assertion. Postgres only accepts the isolation level
    // before the transaction's first query, and a repeatable-read snapshot is
    // what stops a call counted between the two reads from landing in the
    // chart but not the totals beneath it.
    expect(events).toEqual([
      'begin',
      'execute SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
      'read dimensions',
      'read days',
      'commit',
    ]);
  });

  it('asks the table twice, not once per breakdown', async () => {
    await storage.report(RANGE);

    // Every coarser figure is arithmetic over the dimension rows. Asking the
    // table separately for each is how the totals and the rows beneath them
    // start disagreeing.
    expect(events.filter((event) => event.startsWith('read'))).toHaveLength(2);
  });

  it('leaves the snapshot to whoever already opened a transaction', async () => {
    callerHasTransaction = true;

    const report = await storage.report(RANGE);

    // Setting the isolation level inside somebody else's transaction is an
    // error, not an improvement — their snapshot is the one in force.
    expect(events).toEqual(['read dimensions', 'read days']);
    expect(report.total).toBe(11);
  });

  it('adds up the same however it is sliced', async () => {
    const { total, byPlugin, byClient, byPluginOperation, days } = await storage.report(RANGE);
    const sum = (rows: Array<{ calls: number }>) => rows.reduce((n, row) => n + row.calls, 0);

    expect(total).toBe(11);
    expect(sum(byPlugin)).toBe(11);
    expect(sum(byClient)).toBe(11);
    expect(sum(byPluginOperation)).toBe(11);
    expect(sum(days)).toBe(11);
  });

  it('groups by plugin and operation, summing across clients', async () => {
    const { byPluginOperation } = await storage.report(RANGE);

    expect(byPluginOperation).toEqual([
      { pluginId: 'edls', operation: 'accept', calls: 8 },
      { pluginId: 'edls', operation: 'decline', calls: 1 },
      { pluginId: 'roster', operation: 'sync', calls: 2 },
    ]);
  });

  it('groups by plugin and by client', async () => {
    const { byPlugin, byClient } = await storage.report(RANGE);

    expect(byPlugin).toEqual([
      { pluginId: 'edls', calls: 9 },
      { pluginId: 'roster', calls: 2 },
    ]);
    expect(byClient).toEqual([
      { clientId: 'partner-a', calls: 4 },
      { clientId: 'partner-b', calls: 7 },
    ]);
  });

  it('reports nothing at all for a range with no calls', async () => {
    rangeRows = [];
    dayRows = [];

    const report = await storage.report(RANGE);

    // Absence, not zeroes: a day, plugin or client with no calls is simply
    // not in the answer, so a later screen decides for itself whether to draw
    // a gap or a zero.
    expect(report).toMatchObject({
      total: 0,
      days: [],
      byPlugin: [],
      byClient: [],
      byPluginOperation: [],
      byDimension: [],
    });
  });

  it('keeps counting a plugin the registry no longer knows about (report)', async () => {
    rangeRows = [{ pluginId: 'retired-v0', clientId: 'partner-a', operation: 'gone', calls: 4 }];

    // This reads the counts, never the plugin registry: a retired service's
    // calls are exactly the ones somebody auditing usage wants to account for.
    const { byPlugin } = await storage.report(RANGE);

    expect(byPlugin).toEqual([{ pluginId: 'retired-v0', calls: 4 }]);
  });
});

describe('reading one usage window', () => {
  const WINDOW = { end: '2026-08-31' as const, days: 7 };

  beforeEach(() => {
    usageRows = [
      { pluginId: 'edls', clientId: 'partner-a', today: 1, window: 4 },
      { pluginId: 'edls', clientId: 'partner-b', today: 0, window: 5 },
      { pluginId: 'roster', clientId: 'partner-b', today: 2, window: 2 },
    ];
  });

  it('answers the whole window and its last day in one statement', async () => {
    await storage.usage(WINDOW);

    // One statement is one snapshot, which is the entire guarantee: read
    // separately, a call landing between the two reads counts towards today
    // and not towards the week that contains today, and the card then shows a
    // caller more calls today than it made all week.
    expect(events).toEqual(['read usage']);
  });

  it('counts the last day as a filtered aggregate over the window rows', async () => {
    await storage.usage(WINDOW);

    // The same rows, narrowed — not a second count of its own, which is what
    // would let the two columns disagree.
    const fields = selectSpy.mock.calls[0][0];
    expect(sqlText(fields.today)).toContain('filter (where');
    expect(sqlText(fields.window)).toContain('sum(');
  });

  it('derives the first day of the window from its last', async () => {
    const { start, end } = await storage.usage(WINDOW);

    // Seven days counting the last one, so six days before it.
    expect(start).toBe('2026-08-25');
    expect(end).toBe('2026-08-31');
  });

  it('rolls both breakdowns off the same rows, busiest first', async () => {
    const { byPlugin, byClient } = await storage.usage(WINDOW);

    expect(byPlugin).toEqual([
      { id: 'edls', today: 1, window: 9 },
      { id: 'roster', today: 2, window: 2 },
    ]);
    expect(byClient).toEqual([
      { id: 'partner-b', today: 2, window: 7 },
      { id: 'partner-a', today: 1, window: 4 },
    ]);
  });

  it('keeps a name that was busy earlier in the window but not today', async () => {
    const { byClient } = await storage.usage(WINDOW);

    // The window decides who appears. Dropping a silent-today caller would
    // make the card claim a partner stopped calling us, when it called five
    // times this week.
    expect(byClient.map((row) => row.id)).toContain('partner-b');
    expect(byClient.find((row) => row.id === 'partner-b')).toMatchObject({
      today: 2,
      window: 7,
    });
    usageRows = [{ pluginId: 'edls', clientId: 'quiet-partner', today: 0, window: 5 }];
    const quiet = await storage.usage(WINDOW);
    expect(quiet.byClient).toEqual([{ id: 'quiet-partner', today: 0, window: 5 }]);
  });

  it('reports nothing at all for a window with no calls', async () => {
    usageRows = [];

    const usage = await storage.usage(WINDOW);

    expect(usage).toMatchObject({ byPlugin: [], byClient: [] });
  });

  it('refuses a window that spans less than a day', async () => {
    // A window of zero days would read the day *after* its own end, which is
    // not a smaller answer but a wrong one.
    await expect(storage.usage({ end: '2026-08-31', days: 0 })).rejects.toThrow(RangeError);
    expect(events).toEqual([]);
  });
});
