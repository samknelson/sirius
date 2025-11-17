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
  deleteWorker(id: string): Promise<boolean>;
  // Worker benefits methods
  getWorkerBenefits(workerId: string): Promise<any[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  // Worker hours methods
  getWorkerHours(workerId: string): Promise<any[]>;
  getWorkerHoursCurrent(workerId: string): Promise<any[]>;
  getWorkerHoursHistory(workerId: string): Promise<any[]>;
  getWorkerHoursMonthly(workerId: string): Promise<any[]>;
  createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHours>;
  updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null; home?: boolean }): Promise<WorkerHours | undefined>;
  deleteWorkerHours(id: string): Promise<boolean>;
  upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null; home?: boolean }): Promise<WorkerHours>;
  // Worker work status history methods
  getWorkerWsh(workerId: string): Promise<any[]>;
  createWorkerWsh(data: { workerId: string; date: string; wsId: string; data?: any }): Promise<WorkerWsh>;
  updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined>;
  deleteWorkerWsh(id: string): Promise<boolean>;
}

export function createWorkerStorage(contactsStorage: ContactsStorage): WorkerStorage {
  return {
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

    async createWorkerHours(data: { workerId: string; month: number; year: number; day: number; employerId: string; employmentStatusId: string; hours: number | null }): Promise<WorkerHours> {
      const [hours] = await db
        .insert(workerHours)
        .values(data)
        .returning();
      return hours;
    },

    async updateWorkerHours(id: string, data: { year?: number; month?: number; day?: number; employerId?: string; employmentStatusId?: string; hours?: number | null }): Promise<WorkerHours | undefined> {
      const [updated] = await db
        .update(workerHours)
        .set(data)
        .where(eq(workerHours.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteWorkerHours(id: string): Promise<boolean> {
      const result = await db
        .delete(workerHours)
        .where(eq(workerHours.id, id))
        .returning();
      return result.length > 0;
    },

    async upsertWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null }): Promise<WorkerHours> {
      const [hours] = await db
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
      return hours;
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
      return wsh;
    },

    async updateWorkerWsh(id: string, data: { date?: string; wsId?: string; data?: any }): Promise<WorkerWsh | undefined> {
      const [updated] = await db
        .update(workerWsh)
        .set(data)
        .where(eq(workerWsh.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteWorkerWsh(id: string): Promise<boolean> {
      const result = await db
        .delete(workerWsh)
        .where(eq(workerWsh.id, id))
        .returning();
      return result.length > 0;
    },
  };
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
    }
  }
};
