import { db } from "../db";
import { comm, commSms, commSmsOptin, type Comm, type InsertComm, type CommSms, type InsertCommSms, type CommSmsOptin, type InsertCommSmsOptin } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { phoneValidationService } from "../services/phone-validation";

export interface CommWithSms extends Comm {
  smsDetails?: CommSms | null;
}

export interface CommStorage {
  getComm(id: string): Promise<Comm | undefined>;
  getCommsByContact(contactId: string): Promise<Comm[]>;
  getCommsByContactWithSms(contactId: string): Promise<CommWithSms[]>;
  getCommWithSms(id: string): Promise<CommWithSms | undefined>;
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
      return await db.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
    },

    async getCommsByContactWithSms(contactId: string): Promise<CommWithSms[]> {
      const comms = await db.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
      
      const result: CommWithSms[] = await Promise.all(
        comms.map(async (c) => {
          if (c.medium === 'sms') {
            const [smsDetails] = await db.select().from(commSms).where(eq(commSms.commId, c.id));
            return { ...c, smsDetails: smsDetails || null };
          }
          return { ...c, smsDetails: null };
        })
      );
      
      return result;
    },

    async getCommWithSms(id: string): Promise<CommWithSms | undefined> {
      const [c] = await db.select().from(comm).where(eq(comm.id, id));
      if (!c) return undefined;
      
      if (c.medium === 'sms') {
        const [smsDetails] = await db.select().from(commSms).where(eq(commSms.commId, c.id));
        return { ...c, smsDetails: smsDetails || null };
      }
      
      return { ...c, smsDetails: null };
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

export interface CommSmsOptinStorage {
  getSmsOptinByPhoneNumber(phoneNumber: string): Promise<CommSmsOptin | undefined>;
  getSmsOptinByPublicToken(token: string): Promise<CommSmsOptin | undefined>;
  getSmsOptin(id: string): Promise<CommSmsOptin | undefined>;
  createSmsOptin(data: InsertCommSmsOptin): Promise<CommSmsOptin>;
  updateSmsOptin(id: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined>;
  updateSmsOptinByPhoneNumber(phoneNumber: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined>;
  updateSmsOptinByPublicToken(token: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined>;
  getOrCreatePublicToken(phoneNumber: string): Promise<string>;
  deleteSmsOptin(id: string): Promise<boolean>;
}

export function createCommSmsOptinStorage(): CommSmsOptinStorage {
  return {
    async getSmsOptinByPhoneNumber(phoneNumber: string): Promise<CommSmsOptin | undefined> {
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;
      
      const [result] = await db.select().from(commSmsOptin).where(eq(commSmsOptin.phoneNumber, normalizedPhone));
      return result || undefined;
    },

    async getSmsOptinByPublicToken(token: string): Promise<CommSmsOptin | undefined> {
      const [result] = await db.select().from(commSmsOptin).where(eq(commSmsOptin.publicToken, token));
      return result || undefined;
    },

    async getSmsOptin(id: string): Promise<CommSmsOptin | undefined> {
      const [result] = await db.select().from(commSmsOptin).where(eq(commSmsOptin.id, id));
      return result || undefined;
    },

    async createSmsOptin(data: InsertCommSmsOptin): Promise<CommSmsOptin> {
      const validationResult = await phoneValidationService.validateAndFormat(data.phoneNumber);
      if (!validationResult.isValid) {
        throw new Error(`Invalid phone number: ${validationResult.error}`);
      }
      const normalizedPhone = validationResult.e164Format || data.phoneNumber;

      const [result] = await db.insert(commSmsOptin).values({
        ...data,
        phoneNumber: normalizedPhone,
      }).returning();
      return result;
    },

    async updateSmsOptin(id: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      let updateData = { ...data };
      
      if (data.phoneNumber !== undefined) {
        const validationResult = await phoneValidationService.validateAndFormat(data.phoneNumber);
        if (!validationResult.isValid) {
          throw new Error(`Invalid phone number: ${validationResult.error}`);
        }
        updateData.phoneNumber = validationResult.e164Format || data.phoneNumber;
      }

      const [result] = await db.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.id, id)).returning();
      return result || undefined;
    },

    async updateSmsOptinByPhoneNumber(phoneNumber: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;

      let updateData = { ...data };
      if (data.phoneNumber !== undefined) {
        const validationResult2 = await phoneValidationService.validateAndFormat(data.phoneNumber);
        if (!validationResult2.isValid) {
          throw new Error(`Invalid phone number: ${validationResult2.error}`);
        }
        updateData.phoneNumber = validationResult2.e164Format || data.phoneNumber;
      }

      const [result] = await db.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.phoneNumber, normalizedPhone)).returning();
      return result || undefined;
    },

    async updateSmsOptinByPublicToken(token: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      let updateData = { ...data };
      
      if (data.phoneNumber !== undefined) {
        const validationResult = await phoneValidationService.validateAndFormat(data.phoneNumber);
        if (!validationResult.isValid) {
          throw new Error(`Invalid phone number: ${validationResult.error}`);
        }
        updateData.phoneNumber = validationResult.e164Format || data.phoneNumber;
      }

      const [result] = await db.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(phoneNumber: string): Promise<string> {
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;
      
      const [existing] = await db.select().from(commSmsOptin).where(eq(commSmsOptin.phoneNumber, normalizedPhone));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await db.update(commSmsOptin).set({ publicToken: newToken }).where(eq(commSmsOptin.id, existing.id));
        return newToken;
      }
      
      const newToken = crypto.randomUUID();
      await db.insert(commSmsOptin).values({
        phoneNumber: normalizedPhone,
        optin: false,
        allowlist: false,
        publicToken: newToken,
      });
      return newToken;
    },

    async deleteSmsOptin(id: string): Promise<boolean> {
      const result = await db.delete(commSmsOptin).where(eq(commSmsOptin.id, id)).returning();
      return result.length > 0;
    },
  };
}
