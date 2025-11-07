import { db } from "../db";
import {
  workers,
  contacts,
  optionsGender,
  type Worker,
  type InsertWorker,
} from "@shared/schema";
import { eq } from "drizzle-orm";

export interface WorkerStorage {
  getAllWorkers(): Promise<Worker[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  createWorker(name: string): Promise<Worker>;
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

export function createWorkerStorage(): WorkerStorage {
  return {
    async getAllWorkers(): Promise<Worker[]> {
      return await db.select().from(workers);
    },

    async getWorker(id: string): Promise<Worker | undefined> {
      const [worker] = await db.select().from(workers).where(eq(workers.id, id));
      return worker || undefined;
    },

    async createWorker(name: string): Promise<Worker> {
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Create contact first with name components
      const [contact] = await db
        .insert(contacts)
        .values({
          given: given || null,
          family: family || null,
          displayName: name,
        })
        .returning();
      
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
      
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Update the contact's name components
      await db
        .update(contacts)
        .set({
          given: given || null,
          family: family || null,
          displayName: name,
        })
        .where(eq(contacts.id, currentWorker.contactId));
      
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
      
      // Import the generateDisplayName function
      const { generateDisplayName } = await import("@shared/schema");
      
      // Generate display name from components
      const displayName = generateDisplayName(components);
      
      // Update the contact's name components
      await db
        .update(contacts)
        .set({
          title: components.title?.trim() || null,
          given: components.given?.trim() || null,
          middle: components.middle?.trim() || null,
          family: components.family?.trim() || null,
          generational: components.generational?.trim() || null,
          credentials: components.credentials?.trim() || null,
          displayName,
        })
        .where(eq(contacts.id, currentWorker.contactId));
      
      return currentWorker;
    },

    async updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      const cleanEmail = email.trim();
      
      // Basic email validation
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        throw new Error("Invalid email format");
      }
      
      // Update the contact's email
      await db
        .update(contacts)
        .set({ email: cleanEmail || null })
        .where(eq(contacts.id, currentWorker.contactId));
      
      return currentWorker;
    },

    async updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Validate birth date format if provided
      if (birthDate) {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(birthDate)) {
          throw new Error("Invalid date format. Expected YYYY-MM-DD");
        }
        
        // Parse and validate calendar date
        const [yearStr, monthStr, dayStr] = birthDate.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const day = parseInt(dayStr, 10);
        
        // Validate month range
        if (month < 1 || month > 12) {
          throw new Error("Invalid month. Must be between 1 and 12");
        }
        
        // Validate day range based on month
        const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (day < 1 || day > daysInMonth[month - 1]) {
          throw new Error(`Invalid day. Must be between 1 and ${daysInMonth[month - 1]} for the given month`);
        }
      }
      
      // Update the contact's birth date
      await db
        .update(contacts)
        .set({ birthDate: birthDate || null })
        .where(eq(contacts.id, currentWorker.contactId));
      
      return currentWorker;
    },

    async updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // If clearing gender, clear all gender fields
      if (!gender) {
        await db
          .update(contacts)
          .set({ 
            gender: null,
            genderNota: null,
            genderCalc: null
          })
          .where(eq(contacts.id, currentWorker.contactId));
        
        return currentWorker;
      }
      
      // Fetch the gender option to check if it's nota
      const [genderOption] = await db.select().from(optionsGender).where(eq(optionsGender.id, gender));
      if (!genderOption) {
        throw new Error("Invalid gender option");
      }
      
      // Calculate gender_calc based on whether it's nota or not
      let genderCalc: string;
      let finalGenderNota: string | null = null;
      
      if (genderOption.nota) {
        // For nota options, use the genderNota value
        const cleanGenderNota = genderNota?.trim() || "";
        if (!cleanGenderNota) {
          throw new Error("Gender specification is required for this option");
        }
        genderCalc = cleanGenderNota;
        finalGenderNota = cleanGenderNota;
      } else {
        // For regular options, use the option name
        genderCalc = genderOption.name;
      }
      
      // Update the contact's gender fields
      await db
        .update(contacts)
        .set({ 
          gender,
          genderNota: finalGenderNota,
          genderCalc
        })
        .where(eq(contacts.id, currentWorker.contactId));
      
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
      
      // If worker was deleted, also delete the corresponding contact
      if (result.length > 0) {
        await db.delete(contacts).where(eq(contacts.id, worker.contactId));
      }
      
      return result.length > 0;
    },
  };
}
