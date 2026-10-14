import { sql } from "drizzle-orm";
import { db, pool, driverKind } from "./db";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PoolClient } from "pg";
import { getClient, runOutsideTransaction, runWithTransaction } from "./transaction-context";
import { CONFIGURATION_REVISION_DDL } from "./configuration-revision-ddl";

/** All framework reads get a fresh READ COMMITTED connection, even in a request tx. */
export function readConfigurationSnapshot<T>(read: () => Promise<T>): Promise<T> {
  return runOutsideTransaction(async () => {
    // Deadline covers pool saturation, transport loss and every query, not
    // just PostgreSQL's statement execution. Destroy a timed-out connection;
    // an abandoned borrow must never publish or remain in the pool.
    let client: PoolClient | undefined;
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = (async () => {
      const acquired = await pool.connect();
      if (expired) { acquired.release(true); throw new Error("Configuration checkout expired"); }
      client = acquired;
      const connection = (driverKind === "pg"
        ? drizzlePg(acquired)
        : drizzleNeon(acquired as any)) as unknown as typeof db;
      return connection.transaction(async tx => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '2000ms'`);
        return runWithTransaction(tx, read);
      }, { isolationLevel: "read committed", accessMode: "read only" });
    })();
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true;
            client?.release(true);
            client = undefined;
            reject(new Error("Configuration read timed out after 4 seconds"));
          }, 4_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      client?.release();
    }
  });
}

export async function readConfigurationRevisions(): Promise<Record<string, string>> {
  return readConfigurationSnapshot(async () => {
    const result = await getClient().execute<{ scope: string; revision: string }>(
      sql`SELECT scope, revision::text FROM configuration_revisions`,
    );
    return Object.fromEntries(result.rows.map(row => [row.scope, row.revision]));
  });
}

/** The caller owns the sanctioned admin maintenance escape, not this primitive. */
export async function requestGlobalConfigurationInvalidation(): Promise<void> {
  await getClient().execute(sql`
    INSERT INTO configuration_revisions(scope, revision) VALUES ('global', 1)
    ON CONFLICT(scope) DO UPDATE SET revision = configuration_revisions.revision + 1
  `);
}

/** Under the schema bring-up lock, BEFORE application maintenance enforcement. */
export async function installConfigurationRevisionInfrastructure(): Promise<void> {
  await db.transaction(tx => tx.execute(sql.raw(CONFIGURATION_REVISION_DDL)).then(() => undefined));
}
