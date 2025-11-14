import { db } from "../db";
import {
  workers,
  contacts,
  trustWmb,
  workerHours,
  trustBenefits,
  employers,
  optionsEmploymentStatus,
  type Worker,
  type InsertWorker,
  type TrustWmb,
  type WorkerHours,
  type TrustBenefit,
  type Employer,
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
  createWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null }): Promise<WorkerHours>;
  updateWorkerHours(id: string, data: { employerId?: string; employmentStatusId?: string; hours?: number | null }): Promise<WorkerHours | undefined>;
  deleteWorkerHours(id: string): Promise<boolean>;
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

    async createWorkerHours(data: { workerId: string; month: number; year: number; employerId: string; employmentStatusId: string; hours: number | null }): Promise<WorkerHours> {
      const [hours] = await db
        .insert(workerHours)
        .values({
          ...data,
          day: 1, // Always use day 1 as specified
        })
        .returning();
      return hours;
    },

    async updateWorkerHours(id: string, data: { employerId?: string; employmentStatusId?: string; hours?: number | null }): Promise<WorkerHours | undefined> {
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
  };
}

/**
 * Logging configuration for worker storage operations
 * 
 * Note: Only createWorker and deleteWorker are logged at the worker level.
 * Update methods (updateWorkerContactName, updateWorkerContactEmail, updateWorkerSSN, etc.) 
 * are not logged at the worker level to avoid redundant entries. Contact-related updates 
 * are logged via the contact storage module, and SSN updates are simple field changes that 
 * don't require separate logging.
 * 
 * The create and delete operations are logged here because they involve both worker
 * and contact records, providing a clear entry point for tracking worker lifecycle.
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
    }
  }
};
