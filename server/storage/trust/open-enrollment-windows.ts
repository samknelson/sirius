import { getClient } from "../transaction-context";
import { eq, and, desc, lte, gte, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../utils";
import {
  openEnrollmentWindows,
  type OpenEnrollmentWindow,
  type InsertOpenEnrollmentWindow,
} from "../../../shared/schema";

export type { OpenEnrollmentWindow, InsertOpenEnrollmentWindow };

const TABLE_NAME = getTableName(openEnrollmentWindows);

/**
 * Storage for the admin-configured Open Enrollment windows table
 * (`open_enrollment_windows`), owned by the `trust.elections` component.
 *
 * Mutations and single-record reads throw `COMPONENT_TABLE_NOT_FOUND` when
 * the component is disabled (its table absent). `getActiveWindow` instead
 * returns `undefined` in that case so the wizard gate degrades to "no open
 * window" rather than erroring.
 */
export interface OpenEnrollmentWindowsStorage {
  tableExists(): Promise<boolean>;
  getAll(): Promise<OpenEnrollmentWindow[]>;
  get(id: string): Promise<OpenEnrollmentWindow | undefined>;
  getByPlanYear(planYear: number): Promise<OpenEnrollmentWindow | undefined>;
  getActiveWindow(asOfYmd: string): Promise<OpenEnrollmentWindow | undefined>;
  create(record: InsertOpenEnrollmentWindow): Promise<OpenEnrollmentWindow>;
  update(
    id: string,
    record: Partial<InsertOpenEnrollmentWindow>,
  ): Promise<OpenEnrollmentWindow | undefined>;
  delete(id: string): Promise<boolean>;
}

function assertTablePresent(exists: boolean): void {
  if (!exists) {
    throw new Error("COMPONENT_TABLE_NOT_FOUND");
  }
}

export function createOpenEnrollmentWindowsStorage(): OpenEnrollmentWindowsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(TABLE_NAME);
    },

    async getAll(): Promise<OpenEnrollmentWindow[]> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      return client
        .select()
        .from(openEnrollmentWindows)
        .orderBy(desc(openEnrollmentWindows.planYear));
    },

    async get(id: string): Promise<OpenEnrollmentWindow | undefined> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      const rows = await client
        .select()
        .from(openEnrollmentWindows)
        .where(eq(openEnrollmentWindows.id, id))
        .limit(1);
      return rows[0];
    },

    async getByPlanYear(
      planYear: number,
    ): Promise<OpenEnrollmentWindow | undefined> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      const rows = await client
        .select()
        .from(openEnrollmentWindows)
        .where(eq(openEnrollmentWindows.planYear, planYear))
        .limit(1);
      return rows[0];
    },

    async getActiveWindow(
      asOfYmd: string,
    ): Promise<OpenEnrollmentWindow | undefined> {
      // Degrade gracefully when the component (and its table) is absent: no
      // window means Open Enrollment simply is not open.
      if (!(await tableExistsUtil(TABLE_NAME))) return undefined;
      const client = getClient();
      const rows = await client
        .select()
        .from(openEnrollmentWindows)
        .where(
          and(
            lte(openEnrollmentWindows.startYmd, asOfYmd),
            gte(openEnrollmentWindows.endYmd, asOfYmd),
          ),
        )
        .orderBy(desc(openEnrollmentWindows.planYear))
        .limit(1);
      return rows[0];
    },

    async create(
      record: InsertOpenEnrollmentWindow,
    ): Promise<OpenEnrollmentWindow> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      const rows = await client
        .insert(openEnrollmentWindows)
        .values(record)
        .returning();
      return rows[0];
    },

    async update(
      id: string,
      record: Partial<InsertOpenEnrollmentWindow>,
    ): Promise<OpenEnrollmentWindow | undefined> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      const rows = await client
        .update(openEnrollmentWindows)
        .set(record)
        .where(eq(openEnrollmentWindows.id, id))
        .returning();
      return rows[0];
    },

    async delete(id: string): Promise<boolean> {
      assertTablePresent(await tableExistsUtil(TABLE_NAME));
      const client = getClient();
      const rows = await client
        .delete(openEnrollmentWindows)
        .where(eq(openEnrollmentWindows.id, id))
        .returning();
      return rows.length > 0;
    },
  };
}
