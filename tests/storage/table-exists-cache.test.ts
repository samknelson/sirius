/**
 * The shared table-existence cache (`tableExists` in server/storage/utils.ts)
 * and what a component storage built on it tells callers while the
 * component's tables are missing.
 *
 * The cache remembers only positive answers. Component tables are created by
 * a migration and then stay put for the life of the process, so a table once
 * seen is never asked about again — but a table NOT seen must be asked about
 * on every check, because the component can be enabled (its migration run)
 * while the process stays up. If a negative answer were ever retained, every
 * component storage method would keep throwing COMPONENT_TABLE_NOT_FOUND (which
 * the routes turn into a 503 "component tables not installed") until someone
 * restarted the app, and nothing would look wrong from the outside: the error
 * is the same one the callers legitimately saw a moment earlier.
 *
 * The database is stubbed: information_schema is a Set of table names the
 * test flips, and every existence query is recorded by the table it asked
 * about. That is enough, because the whole guarantee is about which checks
 * reach the database and which reuse an earlier answer. The component
 * storage used as the representative is the BTU regions storage — the
 * smallest one built on the `if (!(await this.tableExists())) throw` pattern
 * every component storage follows.
 */
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sitespecificBtuRegions } from '@shared/schema/sitespecific/btu/schema';

const dialect = new PgDialect();

/** Tables the stubbed information_schema currently reports as present. */
const presentTables = new Set<string>();
/** One entry per existence query the stub answered: the table asked about. */
let existenceQueries: string[] = [];
/** How many real (post-check) reads the stubbed client served. */
let realReads = 0;
/** When set, the next existence query fails with it instead of answering. */
let failNextQuery: Error | undefined;
/** Rows the stubbed real read returns. */
const regionRows = [{ id: 'r1', name: 'Region 1' }];

const queriesFor = (tableName: string) =>
  existenceQueries.filter((asked) => asked === tableName).length;

const stubClient = {
  // Every `execute` reaching the stub is `tableExists` asking about a table;
  // the name travels as the fragment's one string parameter.
  execute: async (fragment: unknown) => {
    const { params } = dialect.sqlToQuery(fragment as any);
    const tableName = params.find((p): p is string => typeof p === 'string');
    if (!tableName) throw new Error('existence query carried no table name parameter');
    existenceQueries.push(tableName);
    if (failNextQuery) {
      const error = failNextQuery;
      failNextQuery = undefined;
      throw error;
    }
    return { rows: [{ exists: presentTables.has(tableName) }] };
  },
  // The regions storage's real read: select().from(table).orderBy(column).
  select: () => ({
    from: () => ({
      orderBy: () => {
        realReads += 1;
        return Promise.resolve(regionRows);
      },
    }),
  }),
};

vi.mock('../../server/storage/transaction-context', () => ({
  getClient: () => stubClient,
}));

const { tableExists, invalidateTableExists } = await import('../../server/storage/utils');
const { createBtuRegionsStorage } = await import('../../server/storage/sitespecific/btu/regions');

const REGIONS_TABLE = getTableName(sitespecificBtuRegions);

beforeEach(() => {
  presentTables.clear();
  existenceQueries = [];
  realReads = 0;
  failNextQuery = undefined;
  // The cache is module state shared by every test in this file. Checks on
  // `tableExists` itself use a table name unique to their test; the storage
  // cases all ask about the same real table, so start each from a clean slate.
  invalidateTableExists(REGIONS_TABLE);
});

describe('a table that is missing', () => {
  it('is asked about again on every check — a negative answer is never remembered', async () => {
    await expect(tableExists('component_missing_repeat')).resolves.toBe(false);
    await expect(tableExists('component_missing_repeat')).resolves.toBe(false);
    await expect(tableExists('component_missing_repeat')).resolves.toBe(false);

    expect(queriesFor('component_missing_repeat')).toBe(3);
  });

  it('is found by the very next check once its migration lands, with no restart', async () => {
    await expect(tableExists('component_migrated_later')).resolves.toBe(false);
    expect(queriesFor('component_migrated_later')).toBe(1);

    presentTables.add('component_migrated_later');

    await expect(tableExists('component_migrated_later')).resolves.toBe(true);
    expect(queriesFor('component_migrated_later')).toBe(2);

    // And from here on the positive answer is the one that is reused.
    await expect(tableExists('component_migrated_later')).resolves.toBe(true);
    expect(queriesFor('component_migrated_later')).toBe(2);
  });

  it('keeps the component storage refusing with COMPONENT_TABLE_NOT_FOUND, never reaching the real query', async () => {
    const regions = createBtuRegionsStorage();

    await expect(regions.getAll()).rejects.toThrow('COMPONENT_TABLE_NOT_FOUND');
    await expect(regions.getAll()).rejects.toThrow('COMPONENT_TABLE_NOT_FOUND');

    expect(queriesFor(REGIONS_TABLE)).toBe(2);
    expect(realReads).toBe(0);
  });

  it('lets the same storage instance serve the real query once the table exists', async () => {
    const regions = createBtuRegionsStorage();
    await expect(regions.getAll()).rejects.toThrow('COMPONENT_TABLE_NOT_FOUND');

    presentTables.add(REGIONS_TABLE);

    await expect(regions.getAll()).resolves.toEqual(regionRows);
    expect(realReads).toBe(1);
    expect(queriesFor(REGIONS_TABLE)).toBe(2);

    // The next call pays for the read alone; the existence check is cached.
    await expect(regions.getAll()).resolves.toEqual(regionRows);
    expect(realReads).toBe(2);
    expect(queriesFor(REGIONS_TABLE)).toBe(2);
  });
});

describe('a table that is present', () => {
  it('is queried once; later checks reuse the answer', async () => {
    presentTables.add('component_present');

    await expect(tableExists('component_present')).resolves.toBe(true);
    await expect(tableExists('component_present')).resolves.toBe(true);
    await expect(tableExists('component_present')).resolves.toBe(true);

    expect(queriesFor('component_present')).toBe(1);
  });

  it('is queried once even when the first callers arrive together', async () => {
    presentTables.add('component_concurrent');

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => tableExists('component_concurrent')),
    );

    expect(answers).toEqual([true, true, true, true, true]);
    expect(queriesFor('component_concurrent')).toBe(1);

    // A caller arriving after the burst settled reuses the same answer.
    await expect(tableExists('component_concurrent')).resolves.toBe(true);
    expect(queriesFor('component_concurrent')).toBe(1);
  });
});

describe('what the cache will not keep', () => {
  it('a check that failed — the next caller asks the database again', async () => {
    presentTables.add('component_flaky');
    failNextQuery = new Error('connection reset');

    await expect(tableExists('component_flaky')).rejects.toThrow('connection reset');

    await expect(tableExists('component_flaky')).resolves.toBe(true);
    expect(queriesFor('component_flaky')).toBe(2);
  });

  it('a positive answer that lifecycle code invalidated (a dropped-and-recreated table)', async () => {
    presentTables.add('component_recreated');
    await expect(tableExists('component_recreated')).resolves.toBe(true);
    expect(queriesFor('component_recreated')).toBe(1);

    invalidateTableExists('component_recreated');

    await expect(tableExists('component_recreated')).resolves.toBe(true);
    expect(queriesFor('component_recreated')).toBe(2);
  });
});
