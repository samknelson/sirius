/** No application database URL or data is read. Every fork gets its own
 * temporary PostgreSQL cluster, full schema, and Unix socket. */
import { beforeAll, afterAll, vi } from "vitest";
import { is, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

const isolated = await vi.hoisted(async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../../shared/schema");
  const root = mkdtempSync(`${tmpdir()}/bao-process-pg-`);
  execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/pg.log`, "-o", `-k ${root} -h '' -p 55439 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, "-w", "start"], { stdio: "ignore" });
  const pools: InstanceType<typeof pg.Pool>[] = [];
  const metrics = { queries: 0 };
  const createPool = (max = 10) => {
    const pool = new pg.Pool({ host: root, port: 55439, user: "postgres", database: "postgres", max, connectionTimeoutMillis: 500 });
    pools.push(pool);
    pool.on("connect", client => {
      const query = client.query.bind(client);
      client.query = ((...args: any[]) => { metrics.queries++; return (query as any)(...args); }) as typeof client.query;
    });
    return pool;
  };
  const pool = createPool();
  return {
    db: drizzle(pool, { schema }), pool, schema, createPool, metrics,
    async close() {
      await Promise.all(pools.map(pool => pool.end()));
      execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
      rmSync(root, { recursive: true, force: true });
    },
  };
});

vi.mock("../../server/storage/db", () => ({
  db: isolated.db, pool: isolated.pool, createInfrastructurePool: ({ max }: { max: number }) => isolated.createPool(max),
  databaseSourceInfo: { driver: "pg", source: "isolated-test" },
  wizardTestMetrics: isolated.metrics,
}));

beforeAll(async () => {
  const { generateCreateStatements } = await import("../../server/services/component-schema-push");
  const { workerSiriusIdDefaultFunctionSql } = await import("../../server/services/worker-sirius-id-default-sql");
  await isolated.pool.query(workerSiriusIdDefaultFunctionSql);
  const enums = new Map<string, string[]>();
  for (const value of Object.values(isolated.schema) as any[]) {
    if (value?.enumName && value?.enumValues) enums.set(value.enumName, value.enumValues);
  }
  const statements = new Map<string, ReturnType<typeof generateCreateStatements>>();
  for (const value of Object.values(isolated.schema)) {
    if (is(value, PgTable)) {
      const name = getTableName(value);
      statements.set(name, generateCreateStatements(value, name, enums));
    }
  }
  // Some component tables have circular foreign keys. Create all tables first,
  // then add the exact generated FK clauses (none are disabled during tests).
  const foreignKeys: string[] = [];
  for (const [name, ddl] of statements) {
    for (const statement of ddl) {
      let text = statement.sql;
      if (statement.kind === "create_table") {
        text = text.split("\n").filter(line => {
          if (!line.includes("FOREIGN KEY")) return true;
          foreignKeys.push(`ALTER TABLE "${name}" ADD ${line.trim().replace(/,$/, "")}`);
          return false;
        }).join("\n").replace(/,\s*\)$/, "\n)");
      }
      await isolated.pool.query(text);
    }
  }
  for (const statement of foreignKeys) await isolated.pool.query(statement);
}, 120_000);
afterAll(async () => {
  const { flushDeferredStorageWork } = await import("../../server/storage/middleware/logging");
  await flushDeferredStorageWork();
  await isolated.close();
}, 30_000);
