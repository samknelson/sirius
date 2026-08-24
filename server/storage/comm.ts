import { getClient, runInTransaction } from './transaction-context';
import { comm, commSms, commSmsOptin, commEmail, commEmailOptin, commPostal, commPostalOptin, commInapp, commInteraction, optionsCallReason, contacts, type Comm, type InsertComm, type CommSms, type InsertCommSms, type CommSmsOptin, type InsertCommSmsOptin, type CommEmail, type InsertCommEmail, type CommEmailOptin, type InsertCommEmailOptin, type CommPostal, type InsertCommPostal, type CommPostalOptin, type InsertCommPostalOptin, type CommInapp, type InsertCommInapp, type CommInteraction, type InsertCommInteraction, type OptionsCommTag } from "@shared/schema";
import { eq, desc, and, SQL, inArray } from "drizzle-orm";
import { phoneValidationService } from "../services/comm/validators/phone";
import { storageLogger } from "../logger";
import { createCommTagsStorage, type CommTagsStorage } from "./comm-tags";
import type { StorageLoggingConfig } from "./middleware/logging";
import { 
  type ValidationError,
  createAsyncStorageValidator
} from "./utils/validation";

/**
 * Validates optional phone numbers - returns null for empty, validates and formats non-empty
 */
export const phoneValidateOptional = createAsyncStorageValidator<{ phoneNumber: string | null | undefined }, never, { phoneNumber: string | null }>(
  async (data) => {
    const errors: ValidationError[] = [];
    
    if (!data.phoneNumber) {
      return { ok: true, value: { phoneNumber: null } };
    }
    
    const validationResult = await phoneValidationService.validateAndFormat(data.phoneNumber);
    if (!validationResult.isValid) {
      errors.push({
        field: 'phoneNumber',
        code: 'INVALID_PHONE',
        message: `Invalid phone number: ${validationResult.error}`
      });
      return { ok: false, errors };
    }
    
    return { ok: true, value: { phoneNumber: validationResult.e164Format || data.phoneNumber } };
  }
);

/**
 * Validates required phone numbers - throws if empty or invalid
 */
export const phoneValidateRequired = createAsyncStorageValidator<{ phoneNumber: string }, never, { phoneNumber: string }>(
  async (data) => {
    const errors: ValidationError[] = [];
    
    if (!data.phoneNumber || !data.phoneNumber.trim()) {
      errors.push({
        field: 'phoneNumber',
        code: 'REQUIRED',
        message: "Phone number is required"
      });
      return { ok: false, errors };
    }
    
    const validationResult = await phoneValidationService.validateAndFormat(data.phoneNumber);
    if (!validationResult.isValid) {
      errors.push({
        field: 'phoneNumber',
        code: 'INVALID_PHONE',
        message: `Invalid phone number: ${validationResult.error}`
      });
      return { ok: false, errors };
    }
    
    return { ok: true, value: { phoneNumber: validationResult.e164Format || data.phoneNumber } };
  }
);

export interface CommWithSms extends Comm {
  smsDetails?: CommSms | null;
  tags?: OptionsCommTag[];
}

export interface CommWithEmail extends Comm {
  emailDetails?: CommEmail | null;
  tags?: OptionsCommTag[];
}

export interface CommWithPostal extends Comm {
  postalDetails?: CommPostal | null;
  tags?: OptionsCommTag[];
}

export interface CommInteractionDetails extends CommInteraction {
  reasonName?: string | null;
}

export interface CommWithDetails extends Comm {
  smsDetails?: CommSms | null;
  emailDetails?: CommEmail | null;
  postalDetails?: CommPostal | null;
  inappDetails?: CommInapp | null;
  interactionDetails?: CommInteractionDetails | null;
  tags?: OptionsCommTag[];
}

export interface CommStorage {
  getComm(id: string): Promise<Comm | undefined>;
  getByIds(ids: string[]): Promise<Comm[]>;
  getCommsByContact(contactId: string): Promise<Comm[]>;
  getCommsByContactWithSms(contactId: string): Promise<CommWithSms[]>;
  getCommsByContactWithDetails(contactId: string): Promise<CommWithDetails[]>;
  getCommWithSms(id: string): Promise<CommWithSms | undefined>;
  getCommWithDetails(id: string): Promise<CommWithDetails | undefined>;
  createComm(data: InsertComm): Promise<Comm>;
  updateComm(id: string, data: Partial<InsertComm>): Promise<Comm | undefined>;
  updateWithTags(
    id: string,
    data: Partial<InsertComm>,
    tagIds?: string[],
  ): Promise<Comm | undefined>;
  deleteComm(id: string): Promise<boolean>;
  getLogLabel(id: string): Promise<string | undefined>;
}

export const commLoggingConfig: StorageLoggingConfig<CommStorage> = {
  module: 'comm',
  methods: {
    createComm: { enabled: true },
    updateComm: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => storage.getComm(args[0]),
      after: async (_args, result) => result,
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const id = args[0];
        const label = (await storage.getLogLabel(id)) ?? `comm ${id.slice(0, 8)}`;
        const before = beforeState ?? {};
        const after = afterState ?? result ?? {};
        const data = (args[1] ?? {}) as Record<string, unknown>;
        const parts: string[] = [];
        for (const field of Object.keys(data)) {
          const from = (before as Record<string, unknown>)[field];
          const to = (after as Record<string, unknown>)[field];
          if (from !== to) parts.push(`${field} ${from ?? '∅'} → ${to ?? '∅'}`);
        }
        if (parts.length === 0) return `Updated ${label} (no changes)`;
        return `Updated ${label}: ${parts.join(', ')}`;
      },
    },
    updateWithTags: { enabled: true, getEntityId: (args) => args[0] },
    deleteComm: { enabled: true, getEntityId: (args) => args[0] },
  },
};

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

async function loadInteractionDetails(commId: string): Promise<CommInteractionDetails | null> {
  const client = getClient();
  const [row] = await client
    .select({ interaction: commInteraction, reasonName: optionsCallReason.name })
    .from(commInteraction)
    .leftJoin(optionsCallReason, eq(optionsCallReason.id, commInteraction.callReasonId))
    .where(eq(commInteraction.commId, commId));
  if (!row) return null;
  return { ...row.interaction, reasonName: row.reasonName ?? null };
}

export function createCommStorage(
  commTagsStorage: CommTagsStorage = createCommTagsStorage(),
): CommStorage {
  return {
    async getComm(id: string): Promise<Comm | undefined> {
      const client = getClient();
      const [result] = await client.select().from(comm).where(eq(comm.id, id));
      return result || undefined;
    },

    async getByIds(ids: string[]): Promise<Comm[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      return await client.select().from(comm).where(inArray(comm.id, ids)).orderBy(desc(comm.sent));
    },

    async getCommsByContact(contactId: string): Promise<Comm[]> {
      const client = getClient();
      return await client.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
    },

    async getCommsByContactWithSms(contactId: string): Promise<CommWithSms[]> {
      const client = getClient();
      const comms = await client.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
      const tagsByComm = await commTagsStorage.listForComms(comms.map((c) => c.id));

      const result: CommWithSms[] = await Promise.all(
        comms.map(async (c) => {
          const tags = tagsByComm.get(c.id) ?? [];
          if (c.medium === 'sms') {
            const [smsDetails] = await client.select().from(commSms).where(eq(commSms.commId, c.id));
            return { ...c, smsDetails: smsDetails || null, tags };
          }
          return { ...c, smsDetails: null, tags };
        })
      );

      return result;
    },

    async getCommWithSms(id: string): Promise<CommWithSms | undefined> {
      const client = getClient();
      const [c] = await client.select().from(comm).where(eq(comm.id, id));
      if (!c) return undefined;

      const tags = await commTagsStorage.listForComm(c.id);
      if (c.medium === 'sms') {
        const [smsDetails] = await client.select().from(commSms).where(eq(commSms.commId, c.id));
        return { ...c, smsDetails: smsDetails || null, tags };
      }

      return { ...c, smsDetails: null, tags };
    },

    async getCommsByContactWithDetails(contactId: string): Promise<CommWithDetails[]> {
      const client = getClient();
      const comms = await client.select().from(comm).where(eq(comm.contactId, contactId)).orderBy(desc(comm.sent));
      const tagsByComm = await commTagsStorage.listForComms(comms.map((c) => c.id));

      const result: CommWithDetails[] = await Promise.all(
        comms.map(async (c) => {
          const tags = tagsByComm.get(c.id) ?? [];
          const base = { smsDetails: null as CommSms | null, emailDetails: null as CommEmail | null, postalDetails: null as CommPostal | null, inappDetails: null as CommInapp | null, interactionDetails: null as CommInteractionDetails | null };
          if (c.medium === 'sms') {
            const [smsDetails] = await client.select().from(commSms).where(eq(commSms.commId, c.id));
            return { ...c, ...base, smsDetails: smsDetails || null, tags };
          } else if (c.medium === 'email') {
            const [emailDetails] = await client.select().from(commEmail).where(eq(commEmail.commId, c.id));
            return { ...c, ...base, emailDetails: emailDetails || null, tags };
          } else if (c.medium === 'postal') {
            const [postalDetails] = await client.select().from(commPostal).where(eq(commPostal.commId, c.id));
            return { ...c, ...base, postalDetails: postalDetails || null, tags };
          } else if (c.medium === 'inapp') {
            const [inappDetails] = await client.select().from(commInapp).where(eq(commInapp.commId, c.id));
            return { ...c, ...base, inappDetails: inappDetails || null, tags };
          } else if (c.medium === 'interaction') {
            const interactionDetails = await loadInteractionDetails(c.id);
            return { ...c, ...base, interactionDetails, tags };
          }
          return { ...c, ...base, tags };
        })
      );

      return result;
    },

    async getCommWithDetails(id: string): Promise<CommWithDetails | undefined> {
      const client = getClient();
      const [c] = await client.select().from(comm).where(eq(comm.id, id));
      if (!c) return undefined;

      const tags = await commTagsStorage.listForComm(c.id);
      const base = { smsDetails: null as CommSms | null, emailDetails: null as CommEmail | null, postalDetails: null as CommPostal | null, inappDetails: null as CommInapp | null, interactionDetails: null as CommInteractionDetails | null };
      if (c.medium === 'sms') {
        const [smsDetails] = await client.select().from(commSms).where(eq(commSms.commId, c.id));
        return { ...c, ...base, smsDetails: smsDetails || null, tags };
      } else if (c.medium === 'email') {
        const [emailDetails] = await client.select().from(commEmail).where(eq(commEmail.commId, c.id));
        return { ...c, ...base, emailDetails: emailDetails || null, tags };
      } else if (c.medium === 'postal') {
        const [postalDetails] = await client.select().from(commPostal).where(eq(commPostal.commId, c.id));
        return { ...c, ...base, postalDetails: postalDetails || null, tags };
      } else if (c.medium === 'inapp') {
        const [inappDetails] = await client.select().from(commInapp).where(eq(commInapp.commId, c.id));
        return { ...c, ...base, inappDetails: inappDetails || null, tags };
      } else if (c.medium === 'interaction') {
        const interactionDetails = await loadInteractionDetails(c.id);
        return { ...c, ...base, interactionDetails, tags };
      }

      return { ...c, ...base, tags };
    },

    async createComm(data: InsertComm): Promise<Comm> {
      const client = getClient();
      const [result] = await client.insert(comm).values(data).returning();
      return result;
    },

    async updateComm(id: string, data: Partial<InsertComm>): Promise<Comm | undefined> {
      const client = getClient();
      const [result] = await client.update(comm).set(data).where(eq(comm.id, id)).returning();
      return result || undefined;
    },

    async updateWithTags(
      _id: string,
      _data: Partial<InsertComm>,
      _tagIds?: string[],
    ): Promise<Comm | undefined> {
      throw new Error(
        "updateWithTags must be invoked on the orchestrated storage in DatabaseStorage, not on the base CommStorage",
      );
    },

    async deleteComm(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(comm).where(eq(comm.id, id)).returning();
      return result.length > 0;
    },

    async getLogLabel(id: string): Promise<string | undefined> {
      const client = getClient();
      const [row] = await client
        .select({ medium: comm.medium, displayName: contacts.displayName })
        .from(comm)
        .leftJoin(contacts, eq(contacts.id, comm.contactId))
        .where(eq(comm.id, id));
      if (!row) return undefined;
      const medium = (row.medium || '').toUpperCase() || 'COMM';
      if (row.displayName) return `${medium} to ${row.displayName}`;
      return `${medium} comm ${id.slice(0, 8)}`;
    },
  };
}

export function createCommSmsStorage(): CommSmsStorage {
  return {
    async getCommSms(id: string): Promise<CommSms | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commSms).where(eq(commSms.id, id));
      return result || undefined;
    },

    async getCommSmsByComm(commId: string): Promise<CommSms | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commSms).where(eq(commSms.commId, commId));
      return result || undefined;
    },

    async getCommSmsByTwilioSid(twilioSid: string): Promise<CommSmsWithComm | undefined> {
      const client = getClient();
      const allSmsRecords = await client.select().from(commSms);
      
      for (const sms of allSmsRecords) {
        const data = sms.data as { twilioMessageSid?: string } | null;
        if (data?.twilioMessageSid === twilioSid) {
          const [commRecord] = await client.select().from(comm).where(eq(comm.id, sms.commId));
          if (commRecord) {
            return { commSms: sms, comm: commRecord };
          }
        }
      }
      
      return undefined;
    },

    async updateCommSmsByTwilioSid(twilioSid: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined> {
      const client = getClient();
      const found = await this.getCommSmsByTwilioSid(twilioSid);
      if (!found) return undefined;
      
      let updateData = { ...data };
      
      if (data.to !== undefined) {
        const validated = await phoneValidateOptional.validateOrThrow({ phoneNumber: data.to ?? null });
        updateData.to = validated.phoneNumber;
      }

      const [result] = await client.update(commSms).set(updateData).where(eq(commSms.id, found.commSms.id)).returning();
      return result || undefined;
    },

    async createCommSms(data: InsertCommSms): Promise<CommSms> {
      const client = getClient();
      const validated = await phoneValidateOptional.validateOrThrow({ phoneNumber: data.to ?? null });

      const [result] = await client.insert(commSms).values({
        ...data,
        to: validated.phoneNumber,
      }).returning();
      return result;
    },

    async updateCommSms(id: string, data: Partial<InsertCommSms>): Promise<CommSms | undefined> {
      const client = getClient();
      let updateData = { ...data };
      
      if (data.to !== undefined) {
        const validated = await phoneValidateOptional.validateOrThrow({ phoneNumber: data.to ?? null });
        updateData.to = validated.phoneNumber;
      }

      const [result] = await client.update(commSms).set(updateData).where(eq(commSms.id, id)).returning();
      return result || undefined;
    },

    async deleteCommSms(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commSms).where(eq(commSms.id, id)).returning();
      return result.length > 0;
    },
  };
}

export interface CommSmsOptinStorage {
  getSmsOptinByPhoneNumber(phoneNumber: string): Promise<CommSmsOptin | undefined>;
  /**
   * Opt-in rows for many numbers in one query, keyed by the phone number AS
   * PASSED IN (callers hold un-normalized contact numbers and need to map the
   * answer back to them). Numbers with no row are absent from the map.
   * Normalization matches {@link CommSmsOptinStorage.getSmsOptinByPhoneNumber}
   * so a bulk pre-check and a single send agree on the same row.
   */
  getSmsOptinsByPhoneNumbers(phoneNumbers: string[]): Promise<Map<string, CommSmsOptin>>;
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
      const client = getClient();
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;
      
      const [result] = await client.select().from(commSmsOptin).where(eq(commSmsOptin.phoneNumber, normalizedPhone));
      return result || undefined;
    },

    async getSmsOptinsByPhoneNumbers(phoneNumbers: string[]): Promise<Map<string, CommSmsOptin>> {
      const byInput = new Map<string, CommSmsOptin>();
      const unique = Array.from(new Set(phoneNumbers.filter((p) => !!p)));
      if (unique.length === 0) return byInput;

      const client = getClient();
      // Normalize each distinct number once, then read every matching row in a
      // single query — the same normalization a single lookup does, so both
      // resolve to the same opt-in row.
      const normalizedByInput = new Map<string, string>();
      for (const phoneNumber of unique) {
        const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
        normalizedByInput.set(phoneNumber, validationResult.e164Format || phoneNumber);
      }

      const rows = await client
        .select()
        .from(commSmsOptin)
        .where(inArray(commSmsOptin.phoneNumber, Array.from(new Set(normalizedByInput.values()))));

      const byNormalized = new Map(rows.map((row) => [row.phoneNumber, row]));
      for (const [input, normalized] of normalizedByInput) {
        const row = byNormalized.get(normalized);
        if (row) byInput.set(input, row);
      }
      return byInput;
    },

    async getSmsOptinByPublicToken(token: string): Promise<CommSmsOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commSmsOptin).where(eq(commSmsOptin.publicToken, token));
      return result || undefined;
    },

    async getSmsOptin(id: string): Promise<CommSmsOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commSmsOptin).where(eq(commSmsOptin.id, id));
      return result || undefined;
    },

    async createSmsOptin(data: InsertCommSmsOptin): Promise<CommSmsOptin> {
      const client = getClient();
      const validated = await phoneValidateRequired.validateOrThrow({ phoneNumber: data.phoneNumber });

      const [result] = await client.insert(commSmsOptin).values({
        ...data,
        phoneNumber: validated.phoneNumber,
      }).returning();
      return result;
    },

    async updateSmsOptin(id: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      const client = getClient();
      let updateData = { ...data };
      
      if (data.phoneNumber !== undefined) {
        const validated = await phoneValidateRequired.validateOrThrow({ phoneNumber: data.phoneNumber });
        updateData.phoneNumber = validated.phoneNumber;
      }

      const [result] = await client.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.id, id)).returning();
      return result || undefined;
    },

    async updateSmsOptinByPhoneNumber(phoneNumber: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      const client = getClient();
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;

      let updateData = { ...data };
      if (data.phoneNumber !== undefined) {
        const validated = await phoneValidateRequired.validateOrThrow({ phoneNumber: data.phoneNumber });
        updateData.phoneNumber = validated.phoneNumber;
      }

      const [result] = await client.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.phoneNumber, normalizedPhone)).returning();
      return result || undefined;
    },

    async updateSmsOptinByPublicToken(token: string, data: Partial<InsertCommSmsOptin>): Promise<CommSmsOptin | undefined> {
      const client = getClient();
      let updateData = { ...data };
      
      if (data.phoneNumber !== undefined) {
        const validated = await phoneValidateRequired.validateOrThrow({ phoneNumber: data.phoneNumber });
        updateData.phoneNumber = validated.phoneNumber;
      }

      const [result] = await client.update(commSmsOptin).set(updateData).where(eq(commSmsOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(phoneNumber: string): Promise<string> {
      const client = getClient();
      const validationResult = await phoneValidationService.validateAndFormat(phoneNumber);
      const normalizedPhone = validationResult.e164Format || phoneNumber;
      
      const [existing] = await client.select().from(commSmsOptin).where(eq(commSmsOptin.phoneNumber, normalizedPhone));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await client.update(commSmsOptin).set({ publicToken: newToken }).where(eq(commSmsOptin.id, existing.id));
        return newToken;
      }
      
      const newToken = crypto.randomUUID();
      await client.insert(commSmsOptin).values({
        phoneNumber: normalizedPhone,
        optin: false,
        allowlist: false,
        publicToken: newToken,
      });
      return newToken;
    },

    async deleteSmsOptin(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commSmsOptin).where(eq(commSmsOptin.id, id)).returning();
      return result.length > 0;
    },
  };
}

export function createCommEmailStorage(): CommEmailStorage {
  return {
    async getCommEmail(id: string): Promise<CommEmail | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commEmail).where(eq(commEmail.id, id));
      return result || undefined;
    },

    async getCommEmailByComm(commId: string): Promise<CommEmail | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commEmail).where(eq(commEmail.commId, commId));
      return result || undefined;
    },

    async getCommEmailBySendGridId(sendgridMessageId: string): Promise<CommEmailWithComm | undefined> {
      const client = getClient();
      const allEmailRecords = await client.select().from(commEmail);
      
      for (const email of allEmailRecords) {
        const data = email.data as { sendgridMessageId?: string } | null;
        if (data?.sendgridMessageId === sendgridMessageId) {
          const [commRecord] = await client.select().from(comm).where(eq(comm.id, email.commId));
          if (commRecord) {
            return { commEmail: email, comm: commRecord };
          }
        }
      }
      
      return undefined;
    },

    async createCommEmail(data: InsertCommEmail): Promise<CommEmail> {
      const client = getClient();
      const [result] = await client.insert(commEmail).values(data).returning();
      return result;
    },

    async updateCommEmail(id: string, data: Partial<InsertCommEmail>): Promise<CommEmail | undefined> {
      const client = getClient();
      const [result] = await client.update(commEmail).set(data).where(eq(commEmail.id, id)).returning();
      return result || undefined;
    },

    async deleteCommEmail(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commEmail).where(eq(commEmail.id, id)).returning();
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
      const client = getClient();
      const normalized = normalizeEmail(email);
      const [result] = await client.select().from(commEmailOptin).where(eq(commEmailOptin.email, normalized));
      return result || undefined;
    },

    async getEmailOptinByPublicToken(token: string): Promise<CommEmailOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commEmailOptin).where(eq(commEmailOptin.publicToken, token));
      return result || undefined;
    },

    async getEmailOptin(id: string): Promise<CommEmailOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commEmailOptin).where(eq(commEmailOptin.id, id));
      return result || undefined;
    },

    async getAllEmailOptins(): Promise<CommEmailOptin[]> {
      const client = getClient();
      return await client.select().from(commEmailOptin);
    },

    async createEmailOptin(data: InsertCommEmailOptin): Promise<CommEmailOptin> {
      const client = getClient();
      const normalized = normalizeEmail(data.email);
      const [result] = await client.insert(commEmailOptin).values({
        ...data,
        email: normalized,
      }).returning();
      return result;
    },

    async updateEmailOptin(id: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      const client = getClient();
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await client.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.id, id)).returning();
      return result || undefined;
    },

    async updateEmailOptinByEmail(email: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      const client = getClient();
      const normalized = normalizeEmail(email);
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await client.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.email, normalized)).returning();
      return result || undefined;
    },

    async updateEmailOptinByPublicToken(token: string, data: Partial<InsertCommEmailOptin>): Promise<CommEmailOptin | undefined> {
      const client = getClient();
      let updateData = { ...data };
      if (data.email !== undefined) {
        updateData.email = normalizeEmail(data.email);
      }
      const [result] = await client.update(commEmailOptin).set(updateData).where(eq(commEmailOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(email: string): Promise<string> {
      const client = getClient();
      const normalized = normalizeEmail(email);
      const [existing] = await client.select().from(commEmailOptin).where(eq(commEmailOptin.email, normalized));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await client.update(commEmailOptin).set({ publicToken: newToken }).where(eq(commEmailOptin.id, existing.id));
        return newToken;
      }
      
      const newToken = crypto.randomUUID();
      await client.insert(commEmailOptin).values({
        email: normalized,
        optin: false,
        allowlist: false,
        publicToken: newToken,
      });
      return newToken;
    },

    async deleteEmailOptin(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commEmailOptin).where(eq(commEmailOptin.id, id)).returning();
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
      const client = getClient();
      const [result] = await client.select().from(commPostal).where(eq(commPostal.id, id));
      return result || undefined;
    },

    async getCommPostalByComm(commId: string): Promise<CommPostal | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commPostal).where(eq(commPostal.commId, commId));
      return result || undefined;
    },

    async getCommPostalByLobLetterId(lobLetterId: string): Promise<CommPostalWithComm | undefined> {
      const client = getClient();
      const allPostalRecords = await client.select().from(commPostal).where(eq(commPostal.lobLetterId, lobLetterId));
      
      if (allPostalRecords.length > 0) {
        const postal = allPostalRecords[0];
        const [commRecord] = await client.select().from(comm).where(eq(comm.id, postal.commId));
        if (commRecord) {
          return { commPostal: postal, comm: commRecord };
        }
      }
      
      return undefined;
    },

    async createCommPostal(data: InsertCommPostal): Promise<CommPostal> {
      const client = getClient();
      const [result] = await client.insert(commPostal).values(data).returning();
      return result;
    },

    async updateCommPostal(id: string, data: Partial<InsertCommPostal>): Promise<CommPostal | undefined> {
      const client = getClient();
      const [result] = await client.update(commPostal).set(data).where(eq(commPostal.id, id)).returning();
      return result || undefined;
    },

    async deleteCommPostal(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commPostal).where(eq(commPostal.id, id)).returning();
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
      const client = getClient();
      const [result] = await client.select().from(commPostalOptin).where(eq(commPostalOptin.canonicalAddress, canonicalAddress));
      return result || undefined;
    },

    async getPostalOptinByPublicToken(token: string): Promise<CommPostalOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commPostalOptin).where(eq(commPostalOptin.publicToken, token));
      return result || undefined;
    },

    async getPostalOptin(id: string): Promise<CommPostalOptin | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commPostalOptin).where(eq(commPostalOptin.id, id));
      return result || undefined;
    },

    async getAllPostalOptins(): Promise<CommPostalOptin[]> {
      const client = getClient();
      return await client.select().from(commPostalOptin);
    },

    async createPostalOptin(data: InsertCommPostalOptin): Promise<CommPostalOptin> {
      const client = getClient();
      const [result] = await client.insert(commPostalOptin).values(data).returning();
      return result;
    },

    async updatePostalOptin(id: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const client = getClient();
      const [result] = await client.update(commPostalOptin).set(data).where(eq(commPostalOptin.id, id)).returning();
      return result || undefined;
    },

    async updatePostalOptinByCanonicalAddress(canonicalAddress: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const client = getClient();
      const [result] = await client.update(commPostalOptin).set(data).where(eq(commPostalOptin.canonicalAddress, canonicalAddress)).returning();
      return result || undefined;
    },

    async updatePostalOptinByPublicToken(token: string, data: Partial<InsertCommPostalOptin>): Promise<CommPostalOptin | undefined> {
      const client = getClient();
      const [result] = await client.update(commPostalOptin).set(data).where(eq(commPostalOptin.publicToken, token)).returning();
      return result || undefined;
    },

    async getOrCreatePublicToken(canonicalAddress: string): Promise<string> {
      const client = getClient();
      const [existing] = await client.select().from(commPostalOptin).where(eq(commPostalOptin.canonicalAddress, canonicalAddress));
      
      if (existing) {
        if (existing.publicToken) {
          return existing.publicToken;
        }
        const newToken = crypto.randomUUID();
        await client.update(commPostalOptin).set({ publicToken: newToken }).where(eq(commPostalOptin.id, existing.id));
        return newToken;
      }
      
      throw new Error('Postal opt-in record not found for canonical address');
    },

    async deletePostalOptin(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commPostalOptin).where(eq(commPostalOptin.id, id)).returning();
      return result.length > 0;
    },
  };
}

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
      const client = getClient();
      const [result] = await client.select().from(commInapp).where(eq(commInapp.id, id));
      return result || undefined;
    },

    async getCommInappByComm(commId: string): Promise<CommInapp | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commInapp).where(eq(commInapp.commId, commId));
      return result || undefined;
    },

    async getCommInappsByUser(userId: string, status?: string): Promise<CommInappWithComm[]> {
      const client = getClient();
      const conditions: SQL[] = [eq(commInapp.userId, userId)];
      if (status) {
        conditions.push(eq(commInapp.status, status));
      }

      const rows = await client
        .select({
          inapp: commInapp,
          comm: comm,
        })
        .from(commInapp)
        .innerJoin(comm, eq(commInapp.commId, comm.id))
        .where(and(...conditions))
        .orderBy(desc(commInapp.createdAt));

      return rows.map((row) => ({
        ...row.inapp,
        comm: row.comm,
      }));
    },

    async getUnreadCountByUser(userId: string): Promise<number> {
      const client = getClient();
      const result = await client
        .select()
        .from(commInapp)
        .where(and(eq(commInapp.userId, userId), eq(commInapp.status, "pending")));
      return result.length;
    },

    async createCommInapp(data: InsertCommInapp): Promise<CommInapp> {
      const client = getClient();
      const [result] = await client.insert(commInapp).values(data).returning();
      return result;
    },

    async updateCommInapp(id: string, data: Partial<InsertCommInapp>): Promise<CommInapp | undefined> {
      const client = getClient();
      const [result] = await client.update(commInapp).set(data).where(eq(commInapp.id, id)).returning();
      return result || undefined;
    },

    async deleteCommInapp(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commInapp).where(eq(commInapp.id, id)).returning();
      return result.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Interaction (structured call/office-visit log, N21)
// ---------------------------------------------------------------------------

export interface CreateInteractionInput {
  contactId: string;
  channel: string;
  callReasonId: string;
  notes?: string | null;
  /** When the interaction happened; defaults to now. */
  occurredAt?: Date | null;
  /** Extra metadata stored on the comm_interaction row (e.g. S1 provenance). */
  data?: Record<string, unknown> | null;
  /** Extra metadata stored on the parent comm row (e.g. loggedBy). */
  commData?: Record<string, unknown> | null;
}

export interface CommInteractionStorage {
  getCommInteraction(id: string): Promise<CommInteraction | undefined>;
  getCommInteractionByComm(commId: string): Promise<CommInteraction | undefined>;
  createCommInteraction(data: InsertCommInteraction): Promise<CommInteraction>;
  /** Creates the parent comm row (medium "interaction") and the child row in one transaction. */
  createInteractionWithComm(input: CreateInteractionInput): Promise<{ comm: Comm; interaction: CommInteraction }>;
  deleteCommInteraction(id: string): Promise<boolean>;
  /**
   * MIGRATION-ONLY (S1 sync): patch an interaction and/or its parent comm in
   * one transaction, keyed by the COMM id (the migration id_map anchor).
   * Narrow by design — never changes medium/status/tags, and only accepts
   * medium "interaction" comms. Returns false when the pair does not exist.
   */
  updateInteractionWithCommForMigration(
    commId: string,
    patch: {
      contactId?: string;
      occurredAt?: Date;
      channel?: string;
      callReasonId?: string;
      notes?: string | null;
      interactionData?: unknown;
      commData?: unknown;
    },
  ): Promise<boolean>;
}

export function createCommInteractionStorage(): CommInteractionStorage {
  return {
    async getCommInteraction(id: string): Promise<CommInteraction | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commInteraction).where(eq(commInteraction.id, id));
      return result || undefined;
    },

    async getCommInteractionByComm(commId: string): Promise<CommInteraction | undefined> {
      const client = getClient();
      const [result] = await client.select().from(commInteraction).where(eq(commInteraction.commId, commId));
      return result || undefined;
    },

    async createCommInteraction(data: InsertCommInteraction): Promise<CommInteraction> {
      const client = getClient();
      const [result] = await client.insert(commInteraction).values(data).returning();
      return result;
    },

    async createInteractionWithComm(input: CreateInteractionInput): Promise<{ comm: Comm; interaction: CommInteraction }> {
      return runInTransaction(async () => {
        const client = getClient();
        const [commRow] = await client
          .insert(comm)
          .values({
            medium: 'interaction',
            contactId: input.contactId,
            status: 'logged',
            sent: input.occurredAt ?? new Date(),
            data: input.commData ?? null,
          })
          .returning();
        const [interactionRow] = await client
          .insert(commInteraction)
          .values({
            commId: commRow.id,
            channel: input.channel,
            callReasonId: input.callReasonId,
            notes: input.notes ?? null,
            data: input.data ?? null,
          })
          .returning();
        return { comm: commRow, interaction: interactionRow };
      });
    },

    async deleteCommInteraction(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(commInteraction).where(eq(commInteraction.id, id)).returning();
      return result.length > 0;
    },

    async updateInteractionWithCommForMigration(
      commId: string,
      patch: {
        contactId?: string;
        occurredAt?: Date;
        channel?: string;
        callReasonId?: string;
        notes?: string | null;
        interactionData?: unknown;
        commData?: unknown;
      },
    ): Promise<boolean> {
      return runInTransaction(async () => {
        const client = getClient();
        // BOTH halves of the pair must exist BEFORE any write: returning
        // false after mutating the comm would still COMMIT the transaction,
        // leaving an incomplete pair partially updated while the caller
        // believes nothing happened.
        const [existing] = await client
          .select({ id: comm.id })
          .from(comm)
          .where(and(eq(comm.id, commId), eq(comm.medium, 'interaction')));
        if (!existing) return false;
        const [existingInteraction] = await client
          .select({ id: commInteraction.id })
          .from(commInteraction)
          .where(eq(commInteraction.commId, commId));
        if (!existingInteraction) return false;
        const commSet: Partial<typeof comm.$inferInsert> = {};
        if (patch.contactId !== undefined) commSet.contactId = patch.contactId;
        if (patch.occurredAt !== undefined) commSet.sent = patch.occurredAt;
        if (patch.commData !== undefined) commSet.data = patch.commData;
        if (Object.keys(commSet).length > 0) {
          await client.update(comm).set(commSet).where(eq(comm.id, commId));
        }
        const intSet: Partial<typeof commInteraction.$inferInsert> = {};
        if (patch.channel !== undefined) intSet.channel = patch.channel;
        if (patch.callReasonId !== undefined) intSet.callReasonId = patch.callReasonId;
        if (patch.notes !== undefined) intSet.notes = patch.notes;
        if (patch.interactionData !== undefined) intSet.data = patch.interactionData;
        if (Object.keys(intSet).length > 0) {
          const res = await client
            .update(commInteraction)
            .set(intSet)
            .where(eq(commInteraction.commId, commId))
            .returning({ id: commInteraction.id });
          if (res.length === 0) {
            // pre-checked above — reaching zero rows means a concurrent
            // delete; throw so the comm update rolls back with it.
            throw new Error(`comm_interaction vanished mid-update for comm ${commId}`);
          }
        }
        return true;
      });
    },
  };
}
