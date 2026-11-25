/**
 * Self-test fixtures for the `storage-encapsulation` lint rule. The rule runs
 * these in-memory sources through its own detector before scanning the repo,
 * so a detector regression (a pattern that silently stops matching) fails the
 * lint instead of quietly passing every file. No files are written.
 *
 * Each fixture names a pretend repo-relative path (imports resolve from it)
 * and the exact set of patterns the detector must report for it.
 */
import type { FileResult, Pattern } from './check-storage-encapsulation';

interface Fixture {
  name: string;
  path: string;
  source: string;
  expect: Pattern[];
}

const SERVICE = 'server/services/__lint_fixture__.ts';
const PLUGIN = 'server/plugins/dashboard/plugins/__lint_fixture__.ts';

const FIXTURES: Fixture[] = [
  {
    name: 'service building a query with getClient, operators and a table',
    path: SERVICE,
    source: `
      import { eq, type SQL } from "drizzle-orm";
      import { workers } from "@shared/schema";
      import { getClient } from "../storage/transaction-context";
      export const f = () => getClient().select().from(workers).where(eq(workers.id, "x"));
    `,
    expect: ['drizzle-orm', 'schema-table', 'get-client'],
  },
  {
    name: 'type-only imports, Zod schemas and introspection helpers are allowed',
    path: SERVICE,
    source: `
      import type { Worker } from "@shared/schema";
      import { insertWorkerSchema, type InsertWorker } from "@shared/schema";
      import { getTableColumns, type SQL } from "drizzle-orm";
      export const s = insertWorkerSchema;
    `,
    expect: [],
  },
  {
    name: 'a table passed only as a declaration is allowed',
    path: SERVICE,
    source: `
      import { workers } from "@shared/schema";
      export const contexts = { worker: { table: workers, label: "Worker" } };
    `,
    expect: [],
  },
  {
    name: 'db module, static and dynamic',
    path: SERVICE,
    source: `
      import { db } from "../storage/db";
      export async function g() { const { pool } = await import("../storage/db"); return [db, pool]; }
    `,
    expect: ['db-import', 'db-import'],
  },
  {
    name: 'getClient through a static namespace import',
    path: SERVICE,
    source: `
      import * as tc from "../storage/transaction-context";
      export const h = () => tc.getClient().query.workers.findMany();
    `,
    expect: ['get-client'],
  },
  {
    name: 'getClient through a dynamic namespace / destructured from it',
    path: SERVICE,
    source: `
      export async function h() {
        const tc = await import("../storage/transaction-context");
        const { getClient } = tc;
        return [tc["getClient"], getClient];
      }
    `,
    expect: ['get-client', 'get-client'],
  },
  {
    name: 'namespace import of a storage module without getClient is fine',
    path: SERVICE,
    source: `
      import * as tc from "../storage/transaction-context";
      export const r = (fn: () => Promise<void>) => tc.runInTransaction(fn);
    `,
    expect: [],
  },
  {
    name: 'opted-in plugin may build reads',
    path: PLUGIN,
    source: `
      import { eq, sql } from "drizzle-orm";
      import { workers } from "@shared/schema";
      export const meta = { needsReadOnlyDb: true };
      export const run = (storage: any) => storage.readOnly.query((c: any) =>
        c.select({ n: sql\`count(*)\` }).from(workers).where(eq(workers.id, "1")));
    `,
    expect: [],
  },
  {
    name: 'opted-in plugin may not mutate (builders, sql templates, raw text)',
    path: PLUGIN,
    source: `
      import * as d from "drizzle-orm";
      import { sql as q } from "drizzle-orm";
      import * as schema from "@shared/schema";
      import { workers } from "@shared/schema";
      export const meta = { needsReadOnlyDb: true };
      export async function run(storage: any) {
        await storage.readOnly.query(async (c: any) => {
          await c.delete(workers);
          await c.update(schema.workers).set({});
          await c.execute(q\`UPDATE \${workers} SET x = 1\`);
          await c.execute(d.sql\`insert into workers values (1)\`);
          await c.execute(d.sql.raw("DELETE FROM workers"));
          await c.execute("truncate workers");
        });
      }
    `,
    expect: [
      'plugin-mutation', 'plugin-mutation', 'plugin-mutation',
      'plugin-mutation', 'plugin-mutation', 'plugin-mutation',
    ],
  },
  {
    name: 'plugin calling readOnly.query without the opt-in',
    path: PLUGIN,
    source: `
      export const run = (storage: any) => storage.readOnly.query(async () => 1);
    `,
    expect: ['readonly-flag'],
  },
];

/** Run every fixture; returns one message per mismatch (empty = all pass). */
export async function runSelfTest(
  check: (relPath: string, content: string) => Promise<FileResult>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const fx of FIXTURES) {
    const { violations } = await check(fx.path, fx.source);
    const got = violations.map((v) => v.pattern).sort();
    const want = [...fx.expect].sort();
    if (got.join(',') !== want.join(',')) {
      failures.push(
        `${fx.name}: expected [${want.join(', ')}], got [${got.join(', ')}]` +
          (violations.length ? `\n      ${violations.map((v) => `${v.line} ${v.pattern}: ${v.detail}`).join('\n      ')}` : ''),
      );
    }
  }
  return failures;
}
