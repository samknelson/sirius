import { getClient } from './transaction-context';
import {
  workerHours,
  employers,
  optionsEmploymentStatus,
  type WorkerHours,
} from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";
import { storageLogger as logger } from "../logger";
import type { LedgerNotification } from "../charge-plugins/types";
import { eventBus, EventType } from "../services/event-bus";

export interface WorkerHoursResult {
  data: WorkerHours;
  notifications: LedgerNotification[];
}

export interface WorkerHoursDeleteResult {
  success: boolean;
  notifications: LedgerNotification[];
}

export interface WorkerHoursStorage {
  getWorkerHoursById(id: string): Promise<any | undefined>;
  getWorkerHours(workerId: string): Promise<any[]>;
  getWorkerHoursCurrent(workerId: string): Promise<any[]>;
  getWorkerHoursHistory(workerId: string): Promise<any[]>;
  getWorkerHoursMonthly(workerId: string): Promise<any[]>;
  getMonthlyHoursTotal(workerId: string, employerId: string, year: number, month: number, employmentStatusIds?: string[]): Promise<number>;
  getWorkerMonthlyHoursAllEmployers(workerId: string, year: number, month: number): Promise<number>;
  createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean; jobTitle?: string | null }): Promise<WorkerHoursResult>;
  updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean; jobTitle?: string | null }): Promise<WorkerHoursResult | undefined>;
  deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult>;
  upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult>;
}

export function createWorkerHoursStorage(
  onWorkerDataChanged?: (workerId: string) => Promise<void>
): WorkerHoursStorage {
  async function notifyWorkerDataChanged(workerId: string): Promise<void> {
    if (onWorkerDataChanged) {
      await onWorkerDataChanged(workerId).catch(err => {
        console.error("Failed to trigger scan invalidation for worker", workerId, err);
      });
    }
  }

  const storage: WorkerHoursStorage = {
    async getWorkerHoursById(id: string): Promise<any | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          id: workerHours.id,
          month: workerHours.month,
          year: workerHours.year,
          day: workerHours.day,
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employmentStatusId: workerHours.employmentStatusId,
          hours: workerHours.hours,
          home: workerHours.home,
          jobTitle: workerHours.jobTitle,
          employer: employers,
          employmentStatus: optionsEmploymentStatus,
        })
        .from(workerHours)
        .leftJoin(employers, eq(workerHours.employerId, employers.id))
        .leftJoin(optionsEmploymentStatus, eq(workerHours.employmentStatusId, optionsEmploymentStatus.id))
        .where(eq(workerHours.id, id));

      return result || undefined;
    },

    async getWorkerHours(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: workerHours.id,
          month: workerHours.month,
          year: workerHours.year,
          day: workerHours.day,
          workerId: workerHours.workerId,
          employerId: workerHours.employerId,
          employmentStatusId: workerHours.employmentStatusId,
          hours: workerHours.hours,
          home: workerHours.home,
          jobTitle: workerHours.jobTitle,
          employer: employers,
          employmentStatus: optionsEmploymentStatus,
        })
        .from(workerHours)
        .leftJoin(employers, eq(workerHours.employerId, employers.id))
        .leftJoin(optionsEmploymentStatus, eq(workerHours.employmentStatusId, optionsEmploymentStatus.id))
        .where(eq(workerHours.workerId, workerId))
        .orderBy(desc(workerHours.year), desc(workerHours.month));

      return results;
    },

    async getWorkerHoursCurrent(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        SELECT DISTINCT ON (wh.employer_id)
          wh.id,
          wh.month,
          wh.year,
          wh.day,
          wh.worker_id,
          wh.employer_id,
          wh.employment_status_id,
          wh.home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          e.stripe_customer_id AS "employer.stripeCustomerId",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM worker_hours wh
        LEFT JOIN employers e ON wh.employer_id = e.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.worker_id = ${workerId}
        ORDER BY wh.employer_id, wh.year DESC, wh.month DESC, wh.day DESC
      `);

      return results.rows.map((row: any) => ({
        id: row.id,
        month: row.month,
        year: row.year,
        day: row.day,
        workerId: row.worker_id,
        employerId: row.employer_id,
        employmentStatusId: row.employment_status_id,
        home: row.home,
        employer: {
          id: row['employer.id'],
          siriusId: row['employer.siriusId'],
          name: row['employer.name'],
          isActive: row['employer.isActive'],
          stripeCustomerId: row['employer.stripeCustomerId'],
        },
        employmentStatus: {
          id: row['employmentStatus.id'],
          name: row['employmentStatus.name'],
          code: row['employmentStatus.code'],
          employed: row['employmentStatus.employed'],
          description: row['employmentStatus.description'],
        },
      }));
    },

    async getWorkerHoursHistory(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        WITH status_changes AS (
          SELECT
            wh.id,
            wh.month,
            wh.year,
            wh.day,
            wh.worker_id,
            wh.employer_id,
            wh.employment_status_id,
            wh.home,
            LAG(wh.employment_status_id) OVER (
              PARTITION BY wh.employer_id 
              ORDER BY wh.year, wh.month, wh.day
            ) AS prev_status_id
          FROM worker_hours wh
          WHERE wh.worker_id = ${workerId}
        )
        SELECT
          sc.id,
          sc.month,
          sc.year,
          sc.day,
          sc.worker_id,
          sc.employer_id,
          sc.employment_status_id,
          sc.home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          e.stripe_customer_id AS "employer.stripeCustomerId",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM status_changes sc
        LEFT JOIN employers e ON sc.employer_id = e.id
        LEFT JOIN options_employment_status es ON sc.employment_status_id = es.id
        WHERE sc.prev_status_id IS NULL OR sc.prev_status_id != sc.employment_status_id
        ORDER BY sc.year DESC, sc.month DESC, sc.day DESC, sc.employer_id
      `);

      return results.rows.map((row: any) => ({
        id: row.id,
        month: row.month,
        year: row.year,
        day: row.day,
        workerId: row.worker_id,
        employerId: row.employer_id,
        employmentStatusId: row.employment_status_id,
        home: row.home,
        employer: {
          id: row['employer.id'],
          siriusId: row['employer.siriusId'],
          name: row['employer.name'],
          isActive: row['employer.isActive'],
          stripeCustomerId: row['employer.stripeCustomerId'],
        },
        employmentStatus: {
          id: row['employmentStatus.id'],
          name: row['employmentStatus.name'],
          code: row['employmentStatus.code'],
          employed: row['employmentStatus.employed'],
          description: row['employmentStatus.description'],
        },
      }));
    },

    async getWorkerHoursMonthly(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client.execute(sql`
        SELECT
          wh.employer_id,
          wh.year,
          wh.month,
          SUM(wh.hours) AS total_hours,
          wh.employment_status_id,
          BOOL_AND(wh.home) AS all_home,
          BOOL_OR(wh.home) AS some_home,
          e.id AS "employer.id",
          e.sirius_id AS "employer.siriusId",
          e.name AS "employer.name",
          e.is_active AS "employer.isActive",
          e.stripe_customer_id AS "employer.stripeCustomerId",
          es.id AS "employmentStatus.id",
          es.name AS "employmentStatus.name",
          es.code AS "employmentStatus.code",
          es.employed AS "employmentStatus.employed",
          es.description AS "employmentStatus.description"
        FROM worker_hours wh
        LEFT JOIN employers e ON wh.employer_id = e.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.worker_id = ${workerId}
        GROUP BY wh.employer_id, wh.year, wh.month, wh.employment_status_id,
                 e.id, e.sirius_id, e.name, e.is_active, e.stripe_customer_id,
                 es.id, es.name, es.code, es.employed, es.description
        ORDER BY wh.year DESC, wh.month DESC, wh.employer_id
      `);

      return results.rows.map((row: any) => {
        let homeStatus: 'all' | 'some' | 'none';
        if (row.all_home) {
          homeStatus = 'all';
        } else if (row.some_home) {
          homeStatus = 'some';
        } else {
          homeStatus = 'none';
        }

        return {
          employerId: row.employer_id,
          year: row.year,
          month: row.month,
          totalHours: row.total_hours,
          employmentStatusId: row.employment_status_id,
          homeStatus,
          employer: {
            id: row['employer.id'],
            siriusId: row['employer.siriusId'],
            name: row['employer.name'],
            isActive: row['employer.isActive'],
            stripeCustomerId: row['employer.stripeCustomerId'],
          },
          employmentStatus: {
            id: row['employmentStatus.id'],
            name: row['employmentStatus.name'],
            code: row['employmentStatus.code'],
            employed: row['employmentStatus.employed'],
            description: row['employmentStatus.description'],
          },
        };
      });
    },

    async getMonthlyHoursTotal(workerId: string, employerId: string, year: number, month: number, employmentStatusIds?: string[]): Promise<number> {
      const client = getClient();
      let query = client
        .select({ totalHours: sql<number>`COALESCE(SUM(${workerHours.hours}), 0)` })
        .from(workerHours)
        .where(and(
          eq(workerHours.workerId, workerId),
          eq(workerHours.employerId, employerId),
          eq(workerHours.year, year),
          eq(workerHours.month, month)
        ));

      if (employmentStatusIds && employmentStatusIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        query = client
          .select({ totalHours: sql<number>`COALESCE(SUM(${workerHours.hours}), 0)` })
          .from(workerHours)
          .where(and(
            eq(workerHours.workerId, workerId),
            eq(workerHours.employerId, employerId),
            eq(workerHours.year, year),
            eq(workerHours.month, month),
            inArray(workerHours.employmentStatusId, employmentStatusIds)
          ));
      }

      const [result] = await query;
      return Number(result?.totalHours || 0);
    },

    async getWorkerMonthlyHoursAllEmployers(workerId: string, year: number, month: number): Promise<number> {
      const client = getClient();
      const [result] = await client
        .select({ totalHours: sql<number>`COALESCE(SUM(${workerHours.hours}), 0)` })
        .from(workerHours)
        .where(and(
          eq(workerHours.workerId, workerId),
          eq(workerHours.year, year),
          eq(workerHours.month, month)
        ));

      return Number(result?.totalHours || 0);
    },

    async createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult> {
      const client = getClient();
      const [savedHours] = await client
        .insert(workerHours)
        .values(data)
        .returning();

      let notifications: LedgerNotification[] = [];

      if (savedHours) {
        const payload = {
          hoursId: savedHours.id,
          workerId: savedHours.workerId,
          employerId: savedHours.employerId,
          year: savedHours.year,
          month: savedHours.month,
          day: savedHours.day,
          hours: savedHours.hours || 0,
          employmentStatusId: savedHours.employmentStatusId,
          home: savedHours.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          const result = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours create", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await notifyWorkerDataChanged(savedHours.workerId);
      return { data: savedHours, notifications };
    },

    async updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean }): Promise<WorkerHoursResult | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(workerHours)
        .set(data)
        .where(eq(workerHours.id, id))
        .returning();
      
      if (!updated) {
        return undefined;
      }

      let notifications: LedgerNotification[] = [];

      const payload = {
        hoursId: updated.id,
        workerId: updated.workerId,
        employerId: updated.employerId,
        year: updated.year,
        month: updated.month,
        day: updated.day,
        hours: updated.hours || 0,
        employmentStatusId: updated.employmentStatusId,
        home: updated.home,
      };

      // Emit event for any listeners (future notification plugins, etc.)
      eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
        logger.error("Failed to emit HOURS_SAVED event", {
          service: "worker-hours-storage",
          hoursId: updated.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Execute charge plugins directly (for backwards compatibility with notifications)
      try {
        const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
        const result = await executeChargePlugins({
          trigger: TriggerType.HOURS_SAVED,
          ...payload,
        });
        notifications = result.notifications;
      } catch (error) {
        logger.error("Failed to execute charge plugins for hours update", {
          service: "worker-hours-storage",
          hoursId: updated.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await notifyWorkerDataChanged(updated.workerId);
      return { data: updated, notifications };
    },

    async deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult> {
      const client = getClient();
      const result = await client
        .delete(workerHours)
        .where(eq(workerHours.id, id))
        .returning();
      
      const deleted = result[0];
      let notifications: LedgerNotification[] = [];

      if (deleted) {
        const payload = {
          hoursId: deleted.id,
          workerId: deleted.workerId,
          employerId: deleted.employerId,
          year: deleted.year,
          month: deleted.month,
          day: deleted.day,
          hours: 0,
          employmentStatusId: deleted.employmentStatusId,
          home: deleted.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: deleted.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          const pluginResult = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = pluginResult.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours delete", {
            service: "worker-hours-storage",
            hoursId: deleted.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        await notifyWorkerDataChanged(deleted.workerId);
      }
      
      return { success: result.length > 0, notifications };
    },

    async upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult> {
      const client = getClient();
      const [savedHours] = await client
        .insert(workerHours)
        .values({
          ...data,
          day: 1,
        })
        .onConflictDoUpdate({
          target: [workerHours.workerId, workerHours.employerId, workerHours.year, workerHours.month, workerHours.day],
          set: {
            employmentStatusId: data.employmentStatusId,
            hours: data.hours,
          },
        })
        .returning();

      let notifications: LedgerNotification[] = [];

      if (savedHours) {
        const payload = {
          hoursId: savedHours.id,
          workerId: savedHours.workerId,
          employerId: savedHours.employerId,
          year: savedHours.year,
          month: savedHours.month,
          day: savedHours.day,
          hours: savedHours.hours || 0,
          employmentStatusId: savedHours.employmentStatusId,
          home: savedHours.home,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.HOURS_SAVED, payload).catch(err => {
          logger.error("Failed to emit HOURS_SAVED event", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility with notifications)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          const result = await executeChargePlugins({
            trigger: TriggerType.HOURS_SAVED,
            ...payload,
          });
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours save", {
            service: "worker-hours-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await notifyWorkerDataChanged(savedHours.workerId);
      return { data: savedHours, notifications };
    },
  };

  return storage;
}

export const workerHoursLoggingConfig: StorageLoggingConfig<WorkerHoursStorage> = {
  module: 'worker-hours',
  methods: {
    createWorkerHours: {
      enabled: true,
      getEntityId: (args, result) => result?.data?.id || 'new hours entry',
      getHostEntityId: (args) => args[0]?.workerId,
      after: async (args, result, storage) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours,
            note: `Hours entry created for ${hoursData.year}/${hoursData.month}`
          }
        };
      }
    },
    updateWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
        return {
          hours: hoursEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursEntry.workerId,
            year: hoursEntry.year,
            month: hoursEntry.month
          }
        };
      },
      after: async (args, result, storage) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours
          }
        };
      }
    },
    deleteWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [hoursEntry] = await client.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
        return {
          hours: hoursEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursEntry.workerId,
            year: hoursEntry.year,
            month: hoursEntry.month,
            hours: hoursEntry.hours,
            note: `Hours entry deleted for ${hoursEntry.year}/${hoursEntry.month}`
          }
        };
      }
    },
    upsertWorkerHours: {
      enabled: true,
      getEntityId: (args, result) => result?.data?.id || 'hours entry',
      getHostEntityId: (args) => args[0]?.workerId,
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        const workerId = args[0]?.workerId || result?.data?.workerId;
        const year = args[0]?.year || result?.data?.year;
        const month = args[0]?.month || result?.data?.month;
        return `Worker hours ${operation}d for worker ${workerId} (${year}/${month})`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [existingEntry] = await client
          .select()
          .from(workerHours)
          .where(
            and(
              eq(workerHours.workerId, args[0].workerId),
              eq(workerHours.employerId, args[0].employerId),
              eq(workerHours.year, args[0].year),
              eq(workerHours.month, args[0].month),
              eq(workerHours.day, 1)
            )
          );
        
        if (!existingEntry) {
          return null;
        }
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, existingEntry.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, existingEntry.employmentStatusId));
        return {
          hours: existingEntry,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: existingEntry.workerId,
            year: existingEntry.year,
            month: existingEntry.month,
            hours: existingEntry.hours,
            operation: 'update'
          }
        };
      },
      after: async (args, result, storage, beforeState) => {
        const client = getClient();
        const hoursData = result?.data;
        if (!hoursData) return null;
        
        const [employer] = await client.select().from(employers).where(eq(employers.id, hoursData.employerId));
        const [employmentStatus] = await client.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursData.employmentStatusId));
        
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        
        return {
          hours: hoursData,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: hoursData.workerId,
            year: hoursData.year,
            month: hoursData.month,
            hours: hoursData.hours,
            operation
          }
        };
      }
    }
  }
};
