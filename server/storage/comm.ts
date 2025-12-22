import { db } from "../db";
import { comm, commSms, commSmsOptin, commEmail, commEmailOptin, commPostal, commPostalOptin, commInapp, type Comm, type InsertComm, type CommSms, type InsertCommSms, type CommSmsOptin, type InsertCommSmsOptin, type CommEmail, type InsertCommEmail, type CommEmailOptin, type InsertCommEmailOptin, type CommPostal, type InsertCommPostal, type CommPostalOptin, type InsertCommPostalOptin, type CommInapp, type InsertCommInapp } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { phoneValidationService } from "../services/phone-validation";
import { storageLogger } from "../logger";

export interface CommWithSms extends Comm {
  smsDetails?: CommSms | null;
}

export interface CommWithEmail extends Comm {
  emailDetails?: CommEmail | null;
}

export interface CommWithPostal extends Comm {
  postalDetails?: CommPostal | null;
}

export interface CommWithDetails extends Comm {
  smsDetails?: CommSms | null;
  emailDetails?: CommEmail | null;
  postalDetails?: CommPostal | null;
  inappDetails?: CommInapp | null;
}

export interface CommStorage {
  getComm(id: string): Promise<Comm | undefined>;
  getCommsByContact(contactId: string): Promise<Comm[]>;
  getCommsByContactWithSms(contactId: string): Promise<CommWithSms[]>;
  getCommsByContactWithDetails(contactId: string): Promise<CommWithDetails[]>;
  getCommWithSms(id: string): Promise<CommWithSms | undefined>;
  getCommWithDetails(id: string): Promise<CommWithDetails | undefined>;
  createComm(data: InsertComm): Promise<Comm>;
  updateComm(id: string, data: Partial<InsertComm>): Promise<Comm | undefined>;
  deleteComm(id: string): Promise<boolean>;
}

export interface CommSmsWithComm {
  commSms: CommSms;
  comm: Comm;
}

export interface CommSmsStorage {
  getCommSms(id: string): Promise<CommSms | undefined>;
  getCommSmsByComm(commId: string): Promise<CommSms | undefined>;
  getCommSmsByTwilioSid(twilioSid: string): Promise<CommSmsWithComm | undefined>;
  createCommSms(data: InsertCommSms): Promise<CommSms>;
  updateCommSms(id: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined>;
  updateCommSmsByTwilioSid(twilioSid: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined>;
  deleteCommSms(id: string): Promise<boolean>;
}

export interface CommEmailWithComm {
  commEmail: CommEmail;
  comm: Comm;
}

export interface CommEmailStorage {
  getCommEmail(id: string): Promise<CommEmail | undefined>;
  getCommEmailByComm(commId: string): Promise<CommEmail | undefined>;
  getCommEmailBySendGridId(sendgridMessageId: string): Promise<CommEmailWithComm | undefined>;
  createCommEmail(data: InsertCommEmail): Promise<CommEmail>;
  updateCommEmail(id: string, data: Partial<InsertCommEmail>): Promise<CommEmail | undefined>;
  deleteCommEmail(id: string): Promise<boolean>;
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

    async getCommsByContactWithDetails(contactId: string): Promise<CommWithDetails[]> {
      const comms = await db.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
      
      const result: CommWithDetails[] = await Promise.all(
        comms.map(async (c) => {
          if (c.medium === 'sms') {
            const [smsDetails] = await db.select().from(commSms).where(eq(commSms.commId, c.id));
            return { ...c, smsDetails: smsDetails || null, emailDetails: null, postalDetails: null, inappDetails: null };
          } else if (c.medium === 'email') {
            const [emailDetails] = await db.select().from(commEmail).where(eq(commEmail.commId, c.id));
            return { ...c, smsDetails: null, emailDetails: emailDetails || null, postalDetails: null, inappDetails: null };
          } else if (c.medium === 'postal') {
            const [postalDetails] = await db.select().from(commPostal).where(eq(commPostal.commId, c.id));
            return { ...c, smsDetails: null, emailDetails: null, postalDetails: postalDetails || null, inappDetails: null };
          } else if (c.medium === 'inapp') {
            const [inappDetails] = await db.select().from(commInapp).where(eq(commInapp.commId, c.id));
            return { ...c, smsDetails: null, emailDetails: null, postalDetails: null, inappDetails: inappDetails || null };
          }
          return { ...c, smsDetails: null, emailDetails: null, postalDetails: null, inappDetails: null };
        })
      );
      
      return result;
    },

    async getCommWithDetails(id: string): Promise<CommWithDetails | undefined> {
      const [c] = await db.select().from(comm).where(eq(comm.id, id));
      if (!c) return undefined;
      
      if (c.medium === 'sms') {
        const [smsDetails] = await db.select().from(commSms).where(eq(commSms.commId, c.id));
        return { ...c, smsDetails: smsDetails || null, emailDetails: null, postalDetails: null, inappDetails: null };
      } else if (c.medium === 'email') {
        const [emailDetails] = await db.select().from(commEmail).where(eq(commEmail.commId, c.id));
        return { ...c, smsDetails: null, emailDetails: emailDetails || null, postalDetails: null, inappDetails: null };
      } else if (c.medium === 'postal') {
        const [postalDetails] = await db.select().from(commPostal).where(eq(commPostal.commId, c.id));
        return { ...c, smsDetails: null, emailDetails: null, postalDetails: postalDetails || null, inappDetails: null };
      } else if (c.medium === 'inapp') {
        const [inappDetails] = await db.select().from(commInapp).where(eq(commInapp.commId, c.id));
        return { ...c, smsDetails: null, emailDetails: null, postalDetails: null, inappDetails: inappDetails || null };
      }
      
      return { ...c, smsDetails: null, emailDetails: null, postalDetails: null, inappDetails: null };
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

    async getCommSmsByTwilioSid(twilioSid: string): Promise<CommSmsWithComm | undefined> {
      const allSmsRecords = await db.select().from(commSms);
      
      for (const sms of allSmsRecords) {
        const data = sms.data as { twilioMessageSid?: string } | null;
        if (data?.twilioMessageSid === twilioSid) {
          const [commRecord] = await db.select().from(comm).where(eq(comm.id, sms.commId));
          if (commRecord) {
            return { commSms: sms, comm: commRecord };
          }
        }
      }
      
      return undefined;
    },

    async updateCommSmsByTwilioSid(twilioSid: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined> {
      const found = await this.getCommSmsByTwilioSid(twilioSid);
      if (!found) return undefined;
      
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

      const [result] = await db.update(commSms).set(updateData).where(eq(commSms.id, found.commSms.id)).returning();
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

export function createCommEmailStorage(): CommEmailStorage {
  return {
    async getCommEmail(id: string): Promise<CommEmail | undefined> {
      const [result] = await db.select().from(commEmail).where(eq(commEmail.id, id));
      return result || undefined;
    },

    async getCommEmailByComm(commId: string): Promise<CommEmail | undefined> {
      const [result] = await db.select().from(commEmail).where(eq(commEmail.commId, commId));
      return result || undefined;
    },

    async getCommEmailBySendGridId(sendgridMessageId: string): Promise<CommEmailWithComm | undefined> {
      const allEmailRecords = await db.select().from(commEmail);
      
      for (const email of allEmailRecords) {
        const data = email.data as { sendgridMessageId?: string } | null;
        if (data?.sendgridMessageId === sendgridMessageId) {
          const [commRecord] = await db.select().from(comm).where(eq(comm.id, email.commId));
          if (commRecord) {
            return { commEmail: email, comm: commRecord };
          }
        }
      }
      
      return undefined;
    },

    async createCommEmail(data: InsertCommEmail): Promise<CommEmail> {
      const [result] = await db.insert(commEmail).values(data).returning();
      return result;
    },

    async updateCommEmail(id: string, data: Partial<InsertCommEmail>): Promise<CommEmail | undefined> {
      const [result] = await db.update(commEmail).set(data).where(eq(commEmail.id, id)).returning();
      return result || undefined;
    },

    async deleteCommEmail(id: string): Promise<boolean> {
      const result = await db.delete(commEmail).where(eq(commEmail.id, id)).returning();
      return result.length > 0;
    },
  };
}

export interface CommEmailOptinStorage {
  getEmailOptinByEmail(email: string): Promise<CommEmailOptin | undefined>;
  getEmailOptinByPublicToken(token: string): Promise<CommEmailOptin | undefined>;
  getEmailOptin(id: string): Promise<CommEmailOptin | undefined>;
  getAllEmailOptins(): Promise<CommEmailOptin[]>;
  createEmailOptin(data: InsertCommEmailOptin): Promise<CommEmailOptin>;
  updateEmailOptin(id: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined>;
  updateEmailOptinByEmail(email: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined>;
  updateEmailOptinByPublicToken(token: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined>;
  getOrCreatePublicToken(email: string): Promise<string>;
  deleteEmailOptin(id: string): Promise<boolean>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createCommEmailOptinStorage(): CommEmailOptinStorage {
  return {
    async getEmailOptinByEmail(email: string): Promise<CommEmailOptin | undefined> {
      const normalized = normalizeEmail(email);
      const [result] = await db.select().from(commEmailOptin).where(eq(commEmailOptin.email, normalized));
      return result || undefined;
    },

    async getEmailOptinByPublicToken(token: string): Promise<CommEmailOptin | undefined> {
      const [result] = await db.select().from(commEmailOptin).where(eq(commEmailOptin.publicToken, token));
      return result || undefined;
    },

    async getEmailOptin(id: string): Promise<CommEmailOptin | undefined> {
      const [result] = await db.select().from(commEmailOptin).where(eq(commEmailOptin.id, id));
      return result || undefined;
    },

    async getAllEmailOptins(): Promise<CommEmailOptin[]> {
      return await db.select().from(commEmailOptin);
    },

    async createEmailOptin(data: InsertCommEmailOptin): Promise<CommEmailOptin> {
      const normalized = normalizeEmail(data.email);
      const [result] = await db.insert(commEmailOptin).values({
        ...data,
        email: normalized,
      }).returning();
      return result;
    },

    async updateEmailOptin(id: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await db.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.id, id)).returning();
      return result || undefined;
    },

    async updateEmailOptinByEmail(email: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      const normalized = normalizeEmail(email);
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await db.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.email, normalized)).returning();
      return result || undefined;
    },

    async updateEmailOptinByPublicToken(token: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await db.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(email: string): Promise<string> {
      const normalized = normalizeEmail(email);
      const [existing] = await db.select().from(commEmailOptin).where(eq(commEmailOptin.email, normalized));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await db.update(commEmailOptin).set({ publicToken: newToken }).where(eq(commEmailOptin.id, existing.id));
        return newToken;
      }
      
      const newToken = crypto.randomUUID();
      await db.insert(commEmailOptin).values({
        email: normalized,
        optin: false,
        allowlist: false,
        publicToken: newToken,
      });
      return newToken;
    },

    async deleteEmailOptin(id: string): Promise<boolean> {
      const result = await db.delete(commEmailOptin).where(eq(commEmailOptin.id, id)).returning();
      return result.length > 0;
    },
  };
}

export interface CommPostalWithComm {
  commPostal: CommPostal;
  comm: Comm;
}

export interface CommPostalStorage {
  getCommPostal(id: string): Promise<CommPostal | undefined>;
  getCommPostalByComm(commId: string): Promise<CommPostal | undefined>;
  getCommPostalByLobLetterId(lobLetterId: string): Promise<CommPostalWithComm | undefined>;
  createCommPostal(data: InsertCommPostal): Promise<CommPostal>;
  updateCommPostal(id: string, data: Partial<InsertCommPostal>): Promise<CommPostal | undefined>;
  deleteCommPostal(id: string): Promise<boolean>;
}

export function createCommPostalStorage(): CommPostalStorage {
  return {
    async getCommPostal(id: string): Promise<CommPostal | undefined> {
      const [result] = await db.select().from(commPostal).where(eq(commPostal.id, id));
      return result || undefined;
    },

    async getCommPostalByComm(commId: string): Promise<CommPostal | undefined> {
      const [result] = await db.select().from(commPostal).where(eq(commPostal.commId, commId));
      return result || undefined;
    },

    async getCommPostalByLobLetterId(lobLetterId: string): Promise<CommPostalWithComm | undefined> {
      const allPostalRecords = await db.select().from(commPostal).where(eq(commPostal.lobLetterId, lobLetterId));
      
      if (allPostalRecords.length > 0) {
        const postal = allPostalRecords[0];
        const [commRecord] = await db.select().from(comm).where(eq(comm.id, postal.commId));
        if (commRecord) {
          return { commPostal: postal, comm: commRecord };
        }
      }
      
      return undefined;
    },

    async createCommPostal(data: InsertCommPostal): Promise<CommPostal> {
      const [result] = await db.insert(commPostal).values(data).returning();
      return result;
    },

    async updateCommPostal(id: string, data: Partial<InsertCommPostal>): Promise<CommPostal | undefined> {
      const [result] = await db.update(commPostal).set(data).where(eq(commPostal.id, id)).returning();
      return result || undefined;
    },

    async deleteCommPostal(id: string): Promise<boolean> {
      const result = await db.delete(commPostal).where(eq(commPostal.id, id)).returning();
      return result.length > 0;
    },
  };
}

export interface CommPostalOptinStorage {
  getPostalOptinByCanonicalAddress(canonicalAddress: string): Promise<CommPostalOptin | undefined>;
  getPostalOptinByPublicToken(token: string): Promise<CommPostalOptin | undefined>;
  getPostalOptin(id: string): Promise<CommPostalOptin | undefined>;
  getAllPostalOptins(): Promise<CommPostalOptin[]>;
  createPostalOptin(data: InsertCommPostalOptin): Promise<CommPostalOptin>;
  updatePostalOptin(id: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined>;
  updatePostalOptinByCanonicalAddress(canonicalAddress: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined>;
  updatePostalOptinByPublicToken(token: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined>;
  getOrCreatePublicToken(canonicalAddress: string): Promise<string>;
  deletePostalOptin(id: string): Promise<boolean>;
}

export function createCommPostalOptinStorage(): CommPostalOptinStorage {
  return {
    async getPostalOptinByCanonicalAddress(canonicalAddress: string): Promise<CommPostalOptin | undefined> {
      const [result] = await db.select().from(commPostalOptin).where(eq(commPostalOptin.canonicalAddress, canonicalAddress));
      return result || undefined;
    },

    async getPostalOptinByPublicToken(token: string): Promise<CommPostalOptin | undefined> {
      const [result] = await db.select().from(commPostalOptin).where(eq(commPostalOptin.publicToken, token));
      return result || undefined;
    },

    async getPostalOptin(id: string): Promise<CommPostalOptin | undefined> {
      const [result] = await db.select().from(commPostalOptin).where(eq(commPostalOptin.id, id));
      return result || undefined;
    },

    async getAllPostalOptins(): Promise<CommPostalOptin[]> {
      return await db.select().from(commPostalOptin);
    },

    async createPostalOptin(data: InsertCommPostalOptin): Promise<CommPostalOptin> {
      const [result] = await db.insert(commPostalOptin).values(data).returning();
      return result;
    },

    async updatePostalOptin(id: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const [result] = await db.update(commPostalOptin).set(data).where(eq(commPostalOptin.id, id)).returning();
      return result || undefined;
    },

    async updatePostalOptinByCanonicalAddress(canonicalAddress: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const [result] = await db.update(commPostalOptin).set(data).where(eq(commPostalOptin.canonicalAddress, canonicalAddress)).returning();
      return result || undefined;
    },

    async updatePostalOptinByPublicToken(token: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const [result] = await db.update(commPostalOptin).set(data).where(eq(commPostalOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(canonicalAddress: string): Promise<string> {
      const [existing] = await db.select().from(commPostalOptin).where(eq(commPostalOptin.canonicalAddress, canonicalAddress));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await db.update(commPostalOptin).set({ publicToken: newToken }).where(eq(commPostalOptin.id, existing.id));
        return newToken;
      }
      
      throw new Error('Postal opt-in record not found for canonical address');
    },

    async deletePostalOptin(id: string): Promise<boolean> {
      const result = await db.delete(commPostalOptin).where(eq(commPostalOptin.id, id)).returning();
      return result.length > 0;
    },
  };
}

// Communications - In-App

export interface CommInappWithComm extends CommInapp {
  comm: Comm;
}

export interface CommInappStorage {
  getCommInapp(id: string): Promise<CommInapp | undefined>;
  getCommInappByComm(commId: string): Promise<CommInapp | undefined>;
  getCommInappsByUser(userId: string, status?: string): Promise<CommInappWithComm[]>;
  getUnreadCountByUser(userId: string): Promise<number>;
  createCommInapp(data: InsertCommInapp): Promise<CommInapp>;
  updateCommInapp(id: string, data: Partial<InsertCommInapp>): Promise<CommInapp | undefined>;
  deleteCommInapp(id: string): Promise<boolean>;
}

export function createCommInappStorage(): CommInappStorage {
  return {
    async getCommInapp(id: string): Promise<CommInapp | undefined> {
      const [result] = await db.select().from(commInapp).where(eq(commInapp.id, id));
      return result || undefined;
    },

    async getCommInappByComm(commId: string): Promise<CommInapp | undefined> {
      const [result] = await db.select().from(commInapp).where(eq(commInapp.commId, commId));
      return result || undefined;
    },

    async getCommInappsByUser(userId: string, status?: string): Promise<CommInappWithComm[]> {
      const conditions = status
        ? and(eq(commInapp.userId, userId), eq(commInapp.status, status))
        : eq(commInapp.userId, userId);

      const inappRecords = await db
        .select()
        .from(commInapp)
        .where(conditions)
        .orderBy(desc(commInapp.createdAt));

      const results: CommInappWithComm[] = [];
      for (const record of inappRecords) {
        const [commRecord] = await db.select().from(comm).where(eq(comm.id, record.commId));
        if (commRecord) {
          results.push({ ...record, comm: commRecord });
        }
      }
      return results;
    },

    async getUnreadCountByUser(userId: string): Promise<number> {
      const result = await db
        .select()
        .from(commInapp)
        .where(and(eq(commInapp.userId, userId), eq(commInapp.status, "pending")));
      return result.length;
    },

    async createCommInapp(data: InsertCommInapp): Promise<CommInapp> {
      const [result] = await db.insert(commInapp).values(data).returning();
      return result;
    },

    async updateCommInapp(id: string, data: Partial<InsertCommInapp>): Promise<CommInapp | undefined> {
      const [result] = await db.update(commInapp).set(data).where(eq(commInapp.id, id)).returning();
      return result || undefined;
    },

    async deleteCommInapp(id: string): Promise<boolean> {
      const result = await db.delete(commInapp).where(eq(commInapp.id, id)).returning();
      return result.length > 0;
    },
  };
}
