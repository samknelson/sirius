import { db } from "../db";
import { comm, commSms, type Comm, type InsertComm, type CommSms, type InsertCommSms } from "@shared/schema";
import { eq } from "drizzle-orm";
import { phoneValidationService } from "../services/phone-validation";

export interface CommStorage {
  getComm(id: string): Promise<Comm | undefined>;
  getCommsByContact(contactId: string): Promise<Comm[]>;
  createComm(data: InsertComm): Promise<Comm>;
  updateComm(id: string, data: Partial<InsertComm>): Promise<Comm | undefined>;
  deleteComm(id: string): Promise<boolean>;
}

export interface CommSmsStorage {
  getCommSms(id: string): Promise<CommSms | undefined>;
  getCommSmsByComm(commId: string): Promise<CommSms | undefined>;
  createCommSms(data: InsertCommSms): Promise<CommSms>;
  updateCommSms(id: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined>;
  deleteCommSms(id: string): Promise<boolean>;
}

export function createCommStorage(): CommStorage {
  return {
    async getComm(id: string): Promise<Comm | undefined> {
      const [result] = await db.select().from(comm).where(eq(comm.id, id));
      return result || undefined;
    },

    async getCommsByContact(contactId: string): Promise<Comm[]> {
      return await db.select().from(comm).where(eq(comm.contactId, contactId));
    },

    async createComm(data: InsertComm): Promise<Comm> {
      const [result] = await db.insert(comm).values(data).returning();
      return result;
    },

    async updateComm(id: string, data: Partial<InsertComm>): Promise<Comm | undefined> {
      const [result] = await db.update(comm).set(data).where(eq(comm.id, id)).returning();
      return result || undefined;
    },

    async deleteComm(id: string): Promise<boolean> {
      const result = await db.delete(comm).where(eq(comm.id, id)).returning();
      return result.length > 0;
    },
  };
}

export function createCommSmsStorage(): CommSmsStorage {
  return {
    async getCommSms(id: string): Promise<CommSms | undefined> {
      const [result] = await db.select().from(commSms).where(eq(commSms.id, id));
      return result || undefined;
    },

    async getCommSmsByComm(commId: string): Promise<CommSms | undefined> {
      const [result] = await db.select().from(commSms).where(eq(commSms.commId, commId));
      return result || undefined;
    },

    async createCommSms(data: InsertCommSms): Promise<CommSms> {
      let formattedTo = data.to;
      
      if (data.to) {
        const validationResult = await phoneValidationService.validateAndFormat(data.to);
        if (!validationResult.isValid) {
          throw new Error(`Invalid phone number: ${validationResult.error}`);
        }
        formattedTo = validationResult.e164Format || data.to;
      }

      const [result] = await db.insert(commSms).values({
        ...data,
        to: formattedTo,
      }).returning();
      return result;
    },

    async updateCommSms(id: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined> {
      let updateData = { ...data };
      
      if (data.to !== undefined) {
        if (data.to) {
          const validationResult = await phoneValidationService.validateAndFormat(data.to);
          if (!validationResult.isValid) {
            throw new Error(`Invalid phone number: ${validationResult.error}`);
          }
          updateData.to = validationResult.e164Format || data.to;
        } else {
          updateData.to = null;
        }
      }

      const [result] = await db.update(commSms).set(updateData).where(eq(commSms.id, id)).returning();
      return result || undefined;
    },

    async deleteCommSms(id: string): Promise<boolean> {
      const result = await db.delete(commSms).where(eq(commSms.id, id)).returning();
      return result.length > 0;
    },
  };
}
