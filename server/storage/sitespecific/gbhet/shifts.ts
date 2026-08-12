import { getClient } from '../../transaction-context';
import { eq, and, gte, lte } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  gbhetWorkerShifts,
  type GbhetWorkerShift,
  type InsertGbhetWorkerShift,
} from "../../../../shared/schema/sitespecific/gbhet-shifts/schema";
import { getTableName } from "drizzle-orm";

export type { GbhetWorkerShift, InsertGbhetWorkerShift };

export interface GbhetShiftsStorage {
  /** Upsert a single shift-count row keyed on (workerId, statementYmd). */
  upsert(record: InsertGbhetWorkerShift): Promise<GbhetWorkerShift>;
  /** Bulk upsert for imports; each row keyed on (workerId, statementYmd). */
  bulkUpsert(records: InsertGbhetWorkerShift[]): Promise<GbhetWorkerShift[]>;
  getByWorker(workerId: string): Promise<GbhetWorkerShift[]>;
  getByWorkerAndStatement(workerId: string, statementYmd: string): Promise<GbhetWorkerShift | undefined>;
  /** All shift rows for a worker within a calendar month. */
  getByWorkerAndMonth(workerId: string, year: number, month: number): Promise<GbhetWorkerShift[]>;
  delete(id: string): Promise<boolean>;
  tableExists(): Promise<boolean>;
}

const workerShiftsTableName = getTableName(gbhetWorkerShifts);

function monthRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function createGbhetShiftsStorage(): GbhetShiftsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(workerShiftsTableName);
    },

    async upsert(record: InsertGbhetWorkerShift): Promise<GbhetWorkerShift> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .insert(gbhetWorkerShifts)
        .values(record)
        .onConflictDoUpdate({
          target: [gbhetWorkerShifts.workerId, gbhetWorkerShifts.statementYmd],
          set: {
            shiftCount: record.shiftCount,
            data: record.data,
          },
        })
        .returning();
      return results[0];
    },

    async bulkUpsert(records: InsertGbhetWorkerShift[]): Promise<GbhetWorkerShift[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      if (records.length === 0) return [];
      const client = getClient();
      const out: GbhetWorkerShift[] = [];
      // Upsert row-by-row so each row's own values win its conflict update
      // (a single multi-VALUES upsert would fail on intra-batch duplicates).
      for (const record of records) {
        const results = await client
          .insert(gbhetWorkerShifts)
          .values(record)
          .onConflictDoUpdate({
            target: [gbhetWorkerShifts.workerId, gbhetWorkerShifts.statementYmd],
            set: {
              shiftCount: record.shiftCount,
              data: record.data,
            },
          })
          .returning();
        out.push(results[0]);
      }
      return out;
    },

    async getByWorker(workerId: string): Promise<GbhetWorkerShift[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      return client
        .select()
        .from(gbhetWorkerShifts)
        .where(eq(gbhetWorkerShifts.workerId, workerId))
        .orderBy(gbhetWorkerShifts.statementYmd);
    },

    async getByWorkerAndStatement(workerId: string, statementYmd: string): Promise<GbhetWorkerShift | undefined> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .select()
        .from(gbhetWorkerShifts)
        .where(and(
          eq(gbhetWorkerShifts.workerId, workerId),
          eq(gbhetWorkerShifts.statementYmd, statementYmd)
        ));
      return results[0];
    },

    async getByWorkerAndMonth(workerId: string, year: number, month: number): Promise<GbhetWorkerShift[]> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const { start, end } = monthRange(year, month);
      const client = getClient();
      return client
        .select()
        .from(gbhetWorkerShifts)
        .where(and(
          eq(gbhetWorkerShifts.workerId, workerId),
          gte(gbhetWorkerShifts.statementYmd, start),
          lte(gbhetWorkerShifts.statementYmd, end)
        ))
        .orderBy(gbhetWorkerShifts.statementYmd);
    },

    async delete(id: string): Promise<boolean> {
      if (!(await this.tableExists())) {
        throw new Error("COMPONENT_TABLE_NOT_FOUND");
      }
      const client = getClient();
      const results = await client
        .delete(gbhetWorkerShifts)
        .where(eq(gbhetWorkerShifts.id, id))
        .returning({ id: gbhetWorkerShifts.id });
      return results.length > 0;
    },
  };
}
