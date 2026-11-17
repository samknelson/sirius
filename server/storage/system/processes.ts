import { and, asc, count, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { processes } from "@shared/schema/system/processes-schema";
import { processPagingSchema, processReportingStatus, type ProcessPage } from "@shared/processes";
import { getClient, runInTransaction, runOutsideTransaction } from "../transaction-context";
import { allowInMaintenanceMode } from "../maintenance";

export interface ProcessIdentity {
  id: string;
  name: string | null;
  roles: string[];
  startedTs: Date;
}
const expiry = sql<Date>`COALESCE(${processes.endedTs}, ${processes.updatedTs})`;
const publicColumns = {
  id: processes.id, name: processes.name, roles: processes.roles,
  startedTs: processes.startedTs, updatedTs: processes.updatedTs, endedTs: processes.endedTs,
};

/** Observations only: deliberately no logging wrapper or record metadata. */
export function createProcessesStorage() {
  function lifecycle<T>(fn: () => Promise<T>) {
    return runOutsideTransaction(() => allowInMaintenanceMode(async () => {
      await getClient().execute(sql`SET LOCAL statement_timeout = '2s'`);
      await getClient().execute(sql`SET LOCAL lock_timeout = '1s'`);
      return fn();
    }));
  }
  return {
    async heartbeat(identity: ProcessIdentity, mayWrite: () => boolean = () => true) {
      return lifecycle(async () => {
        // Recheck after acquiring a connection: shutdown may have started while queued.
        if (!mayWrite()) return undefined;
        const [row] = await getClient().insert(processes).values({
          ...identity, updatedTs: new Date(),
        }).onConflictDoUpdate({
          target: processes.id,
          set: { updatedTs: sql`clock_timestamp()` },
          setWhere: isNull(processes.endedTs),
        }).returning(publicColumns);
        return row;
      });
    },
    async end(identity: ProcessIdentity, endedTs: Date) {
      await lifecycle(async () => {
        // Inserting a terminal row also covers shutdown before registration succeeded.
        await getClient().insert(processes).values({
          ...identity, updatedTs: endedTs, endedTs,
        }).onConflictDoUpdate({
          target: processes.id,
          set: { endedTs },
          setWhere: isNull(processes.endedTs),
        });
      });
    },
    async get(id: string) {
      return runOutsideTransaction(async () => {
        const [row] = await getClient().select(publicColumns).from(processes).where(eq(processes.id, id));
        return row;
      });
    },
    async getPage(paging: { page: number; pageSize: number }): Promise<ProcessPage> {
      const { page, pageSize } = processPagingSchema.parse(paging);
      return runOutsideTransaction(() => runInTransaction(async () => {
        await getClient().execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
        const scope = isNull(processes.endedTs);
        const [{ total }] = await getClient().select({ total: count() }).from(processes).where(scope);
        const rows = await getClient().select(publicColumns).from(processes).where(scope)
          .orderBy(desc(processes.startedTs), desc(processes.id))
          .limit(pageSize).offset((page - 1) * pageSize);
        const now = Date.now();
        return {
          entries: rows.map(({ endedTs: _ended, ...row }) => ({
            ...row, startedTs: row.startedTs.toISOString(), updatedTs: row.updatedTs.toISOString(),
            status: processReportingStatus(row.updatedTs, now),
          })),
          total, page, pageSize, totalPages: Math.ceil(total / pageSize),
        };
      }));
    },
    async countExpired(cutoff: Date) {
      const [row] = await getClient().select({ total: count() }).from(processes).where(lt(expiry, cutoff));
      return row.total;
    },
    async getExpiredIds(cutoff: Date, limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid process cleanup limit");
      const rows = await getClient().select({ id: processes.id }).from(processes)
        .where(lt(expiry, cutoff)).orderBy(asc(expiry), asc(processes.id)).limit(limit);
      return rows.map(row => row.id);
    },
    async deleteExpired(id: string, cutoff: Date) {
      // PostgreSQL rechecks this predicate after waiting for a concurrent heartbeat.
      const rows = await getClient().delete(processes)
        .where(and(eq(processes.id, id), lt(expiry, cutoff))).returning({ id: processes.id });
      return rows.length > 0;
    },
  };
}
export type ProcessesStorage = ReturnType<typeof createProcessesStorage>;
