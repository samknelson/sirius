import { db } from "../db";
import {
  workers,
  contacts,
  type Worker,
  type InsertWorker,
} from "@shared/schema";
import { eq } from "drizzle-orm";
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
      const [worker] = await db.select().from(workers).where(eq(workers.ssn, ssn));
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
      
      // Import the validateSSN function
      const { validateSSN } = await import("@shared/schema");
      
      // Validate SSN format and rules
      const validation = validateSSN(cleanSSN);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid SSN");
      }
      
      try {
        // Update the worker's SSN
        const [updatedWorker] = await db
          .update(workers)
          .set({ ssn: cleanSSN })
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
