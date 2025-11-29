import { db } from "../db";
import {
  workers,
  contacts,
  trustWmb,
  workerHours,
  trustBenefits,
  employers,
  optionsEmploymentStatus,
  workerWsh,
  optionsWorkerWs,
  type Worker,
  type InsertWorker,
  type TrustWmb,
  type WorkerHours,
  type TrustBenefit,
  type Employer,
  type WorkerWsh,
  type InsertWorkerWsh,
} from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import type { ContactsStorage } from "./contacts";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import { storageLogger as logger } from "../logger";
import type { LedgerNotification } from "../charge-plugins/types";

export interface WorkerHoursResult {
  data: WorkerHours;
  notifications?: LedgerNotification[];
}

export interface WorkerHoursDeleteResult {
  success: boolean;
  notifications?: LedgerNotification[];
}

export interface WorkerStorage {
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerBySSN(ssn: string): Promise<Worker | undefined>;
  createWorker(name: string): Promise<Worker>;
  // Update methods that delegate to contact storage (contact storage already has logging)
  updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined>;
  updateWorkerContactNameComponents(workerId: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<Worker | undefined>;
  updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined>;
  updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined>;
  updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined>;
  updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined>;
  updateWorkerStatus(workerId: string, denormWsId: string | null): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
  // Worker benefits methods
  getWorkerBenefits(workerId: string): Promise<any[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  // Worker hours methods
  getWorkerHoursById(id: string): Promise<any | undefined>;
  getWorkerHours(workerId: string): Promise<any[]>;
  getWorkerHoursCurrent(workerId: string): Promise<any[]>;
  getWorkerHoursHistory(workerId: string): Promise<any[]>;
  getWorkerHoursMonthly(workerId: string): Promise<any[]>;
  getMonthlyHoursTotal(workerId: string, employerId: string, year: number, month: number, employmentStatusIds?: string[]): Promise<number>;
  createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult>;
  updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean }): Promise<WorkerHoursResult | undefined>;
  deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult>;
  upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult>;
  // Worker work status history methods
  getWorkerWsh(workerId: string): Promise<any[]>;
  createWorkerWsh(data: { workerId: string; date: string; wsId: string; data?: any }): Promise<WorkerWsh>;
  updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined>;
  deleteWorkerWsh(id: string): Promise<boolean>;
}

export function createWorkerStorage(contactsStorage: ContactsStorage): WorkerStorage {
  const storage = {
    async getAllWorkers(): Promise<Worker[]> {
      return await db.select().from(workers);
    },

    async getWorker(id: string): Promise<Worker | undefined> {
      const [worker] = await db.select().from(workers).where(eq(workers.id, id));
      return worker || undefined;
    },

    async getWorkerBySSN(ssn: string): Promise<Worker | undefined> {
      // Parse SSN to normalize format before lookup
      const { parseSSN } = await import('@shared/utils/ssn');
      let normalizedSSN: string;
      try {
        normalizedSSN = parseSSN(ssn);
      } catch (error) {
        // If SSN can't be parsed, it won't match anything in the database
        return undefined;
      }
      
      // Use SQL to strip non-digits from database column for comparison
      // This allows matching both normalized SSNs (123456789) and legacy dashed SSNs (123-45-6789)
      const [worker] = await db
        .select()
        .from(workers)
        .where(sql`regexp_replace(${workers.ssn}, '[^0-9]', '', 'g') = ${normalizedSSN}`);
      
      return worker || undefined;
    },

    async createWorker(name: string): Promise<Worker> {
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Create contact first with name components using contact storage
      const contact = await contactsStorage.createContact({
        given: given || null,
        family: family || null,
        displayName: name,
      });
      
      // Create worker with the contact reference
      const [worker] = await db
        .insert(workers)
        .values({ contactId: contact.id })
        .returning();
      
      return worker;
    },

    async updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's name using contact storage
      await contactsStorage.updateName(currentWorker.contactId, name);
      
      return currentWorker;
    },

    async updateWorkerContactNameComponents(
      workerId: string,
      components: {
        title?: string;
        given?: string;
        middle?: string;
        family?: string;
        generational?: string;
        credentials?: string;
      }
    ): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's name components using contact storage
      await contactsStorage.updateNameComponents(currentWorker.contactId, components);
      
      return currentWorker;
    },

    async updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's email using contact storage
      await contactsStorage.updateEmail(currentWorker.contactId, email);
      
      return currentWorker;
    },

    async updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's birth date using contact storage
      await contactsStorage.updateBirthDate(currentWorker.contactId, birthDate);
      
      return currentWorker;
    },

    async updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's gender using contact storage
      await contactsStorage.updateGender(currentWorker.contactId, gender, genderNota);
      
      return currentWorker;
    },

    async updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined> {
      const cleanSSN = ssn.trim();
      
      // Allow clearing the SSN
      if (!cleanSSN) {
        const [updatedWorker] = await db
          .update(workers)
          .set({ ssn: null })
          .where(eq(workers.id, workerId))
          .returning();
        
        return updatedWorker || undefined;
      }
      
      // Import SSN utilities
      const { parseSSN, validateSSN } = await import("@shared/utils/ssn");
      
      // Parse SSN to normalize format (strips non-digits, pads with zeros)
      let parsedSSN: string;
      try {
        parsedSSN = parseSSN(cleanSSN);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Invalid SSN format");
      }
      
      // Validate SSN format and rules
      const validation = validateSSN(parsedSSN);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid SSN");
      }
      
      try {
        // Update the worker's SSN with parsed (normalized) value
        const [updatedWorker] = await db
          .update(workers)
          .set({ ssn: parsedSSN })
          .where(eq(workers.id, workerId))
          .returning();
        
        return updatedWorker || undefined;
      } catch (error: any) {
        // Check for unique constraint violation
        if (error.code === '23505' && error.constraint === 'workers_ssn_unique') {
          throw new Error("This SSN is already assigned to another worker");
        }
        throw error;
      }
    },

    async updateWorkerStatus(workerId: string, denormWsId: string | null): Promise<Worker | undefined> {
      const [updatedWorker] = await db
        .update(workers)
        .set({ denormWsId })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    },

    async deleteWorker(id: string): Promise<boolean> {
      // Get the worker to find its contact
      const [worker] = await db.select().from(workers).where(eq(workers.id, id));
      if (!worker) {
        return false;
      }
      
      // Delete the worker first
      const result = await db.delete(workers).where(eq(workers.id, id)).returning();
      
      // If worker was deleted, also delete the corresponding contact using contact storage
      if (result.length > 0) {
        await contactsStorage.deleteContact(worker.contactId);
      }
      
      return result.length > 0;
    },

    // Worker benefits methods
    async getWorkerBenefits(workerId: string): Promise<any[]> {
      const results = await db
        .select({
          id: trustWmb.id,
          month: trustWmb.month,
          year: trustWmb.year,
          workerId: trustWmb.workerId,
          employerId: trustWmb.employerId,
          benefitId: trustWmb.benefitId,
          benefit: trustBenefits,
          employer: employers,
        })
        .from(trustWmb)
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(eq(trustWmb.workerId, workerId))
        .orderBy(desc(trustWmb.year), desc(trustWmb.month));

      return results;
    },

    async createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb> {
      const [wmb] = await db
        .insert(trustWmb)
        .values(data)
        .returning();
      return wmb;
    },

    async deleteWorkerBenefit(id: string): Promise<boolean> {
      const result = await db
        .delete(trustWmb)
        .where(eq(trustWmb.id, id))
        .returning();
      return result.length > 0;
    },

    // Worker hours methods
    async getWorkerHoursById(id: string): Promise<any | undefined> {
      const [result] = await db
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
      const results = await db
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
      const results = await db.execute(sql`
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
      const results = await db.execute(sql`
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
      const results = await db.execute(sql`
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
      let query = db
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
        query = db
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

    async createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult> {
      const [savedHours] = await db
        .insert(workerHours)
        .values(data)
        .returning();

      let notifications: LedgerNotification[] = [];

      // Execute charge plugins after hours are created (always trigger for monthly reconciliation)
      if (savedHours) {
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          
          const context = {
            trigger: TriggerType.HOURS_SAVED as typeof TriggerType.HOURS_SAVED,
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

          const result = await executeChargePlugins(context);
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours create", {
            service: "workers-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { data: savedHours, notifications };
    },

    async updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean }): Promise<WorkerHoursResult | undefined> {
      const [updated] = await db
        .update(workerHours)
        .set(data)
        .where(eq(workerHours.id, id))
        .returning();
      
      if (!updated) {
        return undefined;
      }

      let notifications: LedgerNotification[] = [];

      // Execute charge plugins after hours are updated (always trigger for monthly reconciliation)
      try {
        const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
        
        const context = {
          trigger: TriggerType.HOURS_SAVED as typeof TriggerType.HOURS_SAVED,
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

        const result = await executeChargePlugins(context);
        notifications = result.notifications;
      } catch (error) {
        logger.error("Failed to execute charge plugins for hours update", {
          service: "workers-storage",
          hoursId: updated.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return { data: updated, notifications };
    },

    async deleteWorkerHours(id: string): Promise<WorkerHoursDeleteResult> {
      const result = await db
        .delete(workerHours)
        .where(eq(workerHours.id, id))
        .returning();
      
      const deleted = result[0];
      let notifications: LedgerNotification[] = [];

      if (deleted) {
        // Execute charge plugins after hours are deleted (for monthly reconciliation)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          
          const context = {
            trigger: TriggerType.HOURS_SAVED as typeof TriggerType.HOURS_SAVED,
            hoursId: deleted.id,
            workerId: deleted.workerId,
            employerId: deleted.employerId,
            year: deleted.year,
            month: deleted.month,
            day: deleted.day,
            hours: 0, // Treat deleted as 0 hours for recalculation
            employmentStatusId: deleted.employmentStatusId,
            home: deleted.home,
          };

          const pluginResult = await executeChargePlugins(context);
          notifications = pluginResult.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours delete", {
            service: "workers-storage",
            hoursId: deleted.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      return { success: result.length > 0, notifications };
    },

    async upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHoursResult> {
      const [savedHours] = await db
        .insert(workerHours)
        .values({
          ...data,
          day: 1, // Always use day 1 as specified
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

      // Execute charge plugins after hours are saved (always trigger for monthly reconciliation)
      if (savedHours) {
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          
          const context = {
            trigger: TriggerType.HOURS_SAVED as typeof TriggerType.HOURS_SAVED,
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

          const result = await executeChargePlugins(context);
          notifications = result.notifications;
        } catch (error) {
          logger.error("Failed to execute charge plugins for hours save", {
            service: "workers-storage",
            hoursId: savedHours.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { data: savedHours, notifications };
    },

    // Worker work status history methods
    async getWorkerWsh(workerId: string): Promise<any[]> {
      const results = await db
        .select({
          id: workerWsh.id,
          date: workerWsh.date,
          workerId: workerWsh.workerId,
          wsId: workerWsh.wsId,
          data: workerWsh.data,
          ws: optionsWorkerWs,
        })
        .from(workerWsh)
        .leftJoin(optionsWorkerWs, eq(workerWsh.wsId, optionsWorkerWs.id))
        .where(eq(workerWsh.workerId, workerId))
        .orderBy(desc(workerWsh.date));

      return results;
    },

    async createWorkerWsh(data: { workerId: string; date: string; wsId: string; data?: any }): Promise<WorkerWsh> {
      const [wsh] = await db
        .insert(workerWsh)
        .values(data)
        .returning();
      
      // Sync worker's current work status to the most recent history entry
      await syncWorkerCurrentWorkStatus(data.workerId);
      
      return wsh;
    },

    async updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined> {
      const [updated] = await db
        .update(workerWsh)
        .set(data)
        .where(eq(workerWsh.id, id))
        .returning();
      
      // Sync worker's current work status to the most recent history entry
      if (updated) {
        await syncWorkerCurrentWorkStatus(updated.workerId);
      }
      
      return updated || undefined;
    },

    async deleteWorkerWsh(id: string): Promise<boolean> {
      const result = await db
        .delete(workerWsh)
        .where(eq(workerWsh.id, id))
        .returning();
      
      // Sync worker's current work status to the most recent history entry
      if (result.length > 0 && result[0].workerId) {
        await syncWorkerCurrentWorkStatus(result[0].workerId);
      }
      
      return result.length > 0;
    },
  };

  // Helper method to sync worker's current denorm_ws_id with most recent work status history entry
  // This is defined after storage object so it can call storage.updateWorkerStatus()
  async function syncWorkerCurrentWorkStatus(workerId: string): Promise<void> {
    // Get the most recent work status history entry for this worker
    // Order by date DESC, then by createdAt DESC NULLS LAST, then by id DESC as a final fallback
    // This ensures deterministic ordering even with legacy data or edge cases
    const [mostRecent] = await db
      .select()
      .from(workerWsh)
      .where(eq(workerWsh.workerId, workerId))
      .orderBy(desc(workerWsh.date), sql`${workerWsh.createdAt} DESC NULLS LAST`, desc(workerWsh.id))
      .limit(1);

    // Update worker's denorm_ws_id through storage layer to ensure logging
    await storage.updateWorkerStatus(workerId, mostRecent?.wsId || null);
  }

  return storage;
}

/**
 * Logging configuration for worker storage operations
 * 
 * Note: createWorker and deleteWorker are logged at the worker level because they involve 
 * both worker and contact records, providing a clear entry point for tracking worker lifecycle.
 * 
 * Contact-related update methods (updateWorkerContactName, updateWorkerContactEmail, etc.) 
 * are not logged at the worker level to avoid redundant entries - they are logged via the 
 * contact storage module.
 * 
 * Worker hours CRUD operations are logged here with the worker as the host entity to maintain
 * a complete audit trail of worker-related data changes.
 */
export const workerLoggingConfig: StorageLoggingConfig<WorkerStorage> = {
  module: 'workers',
  methods: {
    createWorker: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker',
      getHostEntityId: (args, result) => result?.id, // Worker ID is the host
      after: async (args, result, storage) => {
        // Fetch the associated contact for enriched logging
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, result.contactId));
        return {
          worker: result,
          contact: contact,
          metadata: {
            inputName: args[0],
            workerId: result.id,
            contactId: result.contactId,
            siriusId: result.siriusId,
            note: 'Worker creation also created an associated contact record (logged separately in contacts module)'
          }
        };
      }
    },
    deleteWorker: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID
      getHostEntityId: (args, result, beforeState) => beforeState?.worker?.id || args[0], // Worker ID is the host
      before: async (args, storage) => {
        const worker = await storage.getWorker(args[0]);
        if (!worker) {
          return null;
        }
        
        // Fetch the associated contact for enriched logging
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, worker.contactId));
        return {
          worker: worker,
          contact: contact,
          metadata: {
            workerId: worker.id,
            contactId: worker.contactId,
            siriusId: worker.siriusId,
            note: 'Worker deletion will also delete the associated contact record (logged separately in contacts module)'
          }
        };
      },
      after: async (args, result, storage) => {
        return {
          deleted: result,
          workerId: args[0],
          metadata: {
            note: 'Worker and associated contact successfully deleted'
          }
        };
      }
    },
    updateWorkerStatus: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID
      getHostEntityId: (args) => args[0], // Worker ID is the host
      getDescription: async (args, result, beforeState, afterState) => {
        const oldStatus = beforeState?.workStatus?.name || 'None';
        const newStatus = afterState?.workStatus?.name || 'None';
        return `Updated Current Work Status [${oldStatus} → ${newStatus}]`;
      },
      before: async (args, storage) => {
        const worker = await storage.getWorker(args[0]);
        if (!worker || !worker.denormWsId) {
          return null;
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, worker.denormWsId));
        return {
          worker: worker,
          workStatus: workStatus,
          metadata: {
            workerId: worker.id,
            currentWsId: worker.denormWsId,
            currentWorkStatusName: workStatus?.name || 'None'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        if (!result.denormWsId) {
          return {
            worker: result,
            workStatus: null,
            metadata: {
              workerId: result.id,
              newWsId: null,
              newWorkStatusName: 'None',
              note: 'Worker work status cleared (synchronized from work status history)'
            }
          };
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.denormWsId));
        return {
          worker: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.id,
            newWsId: result.denormWsId,
            newWorkStatusName: workStatus?.name || 'Unknown',
            note: 'Worker work status updated (synchronized from work status history)'
          }
        };
      }
    },
    createWorkerHours: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new hours entry',
      getHostEntityId: (args) => args[0]?.workerId, // Worker ID is the host
      after: async (args, result, storage) => {
        // Fetch related employer and employment status for enriched logging
        const [employer] = await db.select().from(employers).where(eq(employers.id, result.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, result.employmentStatusId));
        return {
          hours: result,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: result.workerId,
            year: result.year,
            month: result.month,
            hours: result.hours,
            note: `Hours entry created for ${result.year}/${result.month}`
          }
        };
      }
    },
    updateWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0], // Hours entry ID
      getHostEntityId: async (args, result, beforeState) => {
        // Get worker ID from the hours entry
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const [hoursEntry] = await db.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const [hoursEntry] = await db.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await db.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
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
        if (!result) return null;
        
        const [employer] = await db.select().from(employers).where(eq(employers.id, result.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, result.employmentStatusId));
        return {
          hours: result,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: result.workerId,
            year: result.year,
            month: result.month,
            hours: result.hours
          }
        };
      }
    },
    deleteWorkerHours: {
      enabled: true,
      getEntityId: (args) => args[0], // Hours entry ID
      getHostEntityId: async (args, result, beforeState) => {
        // Get worker ID from the hours entry
        if (beforeState?.hours?.workerId) {
          return beforeState.hours.workerId;
        }
        const [hoursEntry] = await db.select().from(workerHours).where(eq(workerHours.id, args[0]));
        return hoursEntry?.workerId;
      },
      before: async (args, storage) => {
        const [hoursEntry] = await db.select().from(workerHours).where(eq(workerHours.id, args[0]));
        if (!hoursEntry) {
          return null;
        }
        
        const [employer] = await db.select().from(employers).where(eq(employers.id, hoursEntry.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, hoursEntry.employmentStatusId));
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
      getEntityId: (args, result) => result?.id || 'hours entry',
      getHostEntityId: (args) => args[0]?.workerId, // Worker ID is the host
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        const workerId = args[0]?.workerId || result?.workerId;
        const year = args[0]?.year || result?.year;
        const month = args[0]?.month || result?.month;
        return `Worker hours ${operation}d for worker ${workerId} (${year}/${month})`;
      },
      before: async (args, storage) => {
        // Check if an existing entry exists
        const [existingEntry] = await db
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
        
        const [employer] = await db.select().from(employers).where(eq(employers.id, existingEntry.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, existingEntry.employmentStatusId));
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
        if (!result) return null;
        
        const [employer] = await db.select().from(employers).where(eq(employers.id, result.employerId));
        const [employmentStatus] = await db.select().from(optionsEmploymentStatus).where(eq(optionsEmploymentStatus.id, result.employmentStatusId));
        
        // Determine if this was a create or update based on beforeState
        const operation = beforeState && beforeState.hours ? 'update' : 'create';
        
        return {
          hours: result,
          employer: employer,
          employmentStatus: employmentStatus,
          metadata: {
            workerId: result.workerId,
            year: result.year,
            month: result.month,
            hours: result.hours,
            operation
          }
        };
      }
    },
    createWorkerWsh: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new work status history',
      getHostEntityId: (args) => args[0]?.workerId, // Worker ID is the host
      getDescription: async (args, result, beforeState, afterState) => {
        const workStatusName = afterState?.workStatus?.name || 'Unknown';
        const date = result?.date || args[0]?.date || 'Unknown';
        // Format date from YYYY-MM-DD to M/D/YYYY (avoid timezone issues)
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Created Work Status Entry [${workStatusName} ${formattedDate}]`;
      },
      after: async (args, result, storage) => {
        // Fetch the work status option for a friendly name
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.wsId));
        return {
          wsh: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry created: ${workStatus?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    updateWorkerWsh: {
      enabled: true,
      getEntityId: (args) => args[0], // WSH entry ID
      getHostEntityId: async (args, result, beforeState) => {
        // Get worker ID from the WSH entry
        if (beforeState?.wsh?.workerId) {
          return beforeState.wsh.workerId;
        }
        const [wshEntry] = await db.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        return wshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const oldStatusName = beforeState?.workStatus?.name || 'Unknown';
        const newStatusName = afterState?.workStatus?.name || 'Unknown';
        const date = result?.date || beforeState?.wsh?.date || 'Unknown';
        // Format date from YYYY-MM-DD to M/D/YYYY (avoid timezone issues)
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Updated Work Status Entry [${oldStatusName} → ${newStatusName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const [wshEntry] = await db.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        if (!wshEntry) {
          return null;
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, wshEntry.wsId));
        return {
          wsh: wshEntry,
          workStatus: workStatus,
          metadata: {
            workerId: wshEntry.workerId,
            date: wshEntry.date,
            workStatusName: workStatus?.name || 'Unknown'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.wsId));
        return {
          wsh: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.workerId,
            date: result.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry updated to: ${workStatus?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    deleteWorkerWsh: {
      enabled: true,
      getEntityId: (args) => args[0], // WSH entry ID
      getHostEntityId: async (args, result, beforeState) => {
        // Get worker ID from the WSH entry
        if (beforeState?.wsh?.workerId) {
          return beforeState.wsh.workerId;
        }
        const [wshEntry] = await db.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        return wshEntry?.workerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const workStatusName = beforeState?.workStatus?.name || 'Unknown';
        const date = beforeState?.wsh?.date || 'Unknown';
        // Format date from YYYY-MM-DD to M/D/YYYY (avoid timezone issues)
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Deleted Work Status Entry [${workStatusName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const [wshEntry] = await db.select().from(workerWsh).where(eq(workerWsh.id, args[0]));
        if (!wshEntry) {
          return null;
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, wshEntry.wsId));
        return {
          wsh: wshEntry,
          workStatus: workStatus,
          metadata: {
            workerId: wshEntry.workerId,
            date: wshEntry.date,
            workStatusName: workStatus?.name || 'Unknown',
            note: `Work status history entry deleted: ${workStatus?.name || 'Unknown'} on ${wshEntry.date}`
          }
        };
      }
    }
  }
};
