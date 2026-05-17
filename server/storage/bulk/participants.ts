import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { bulkParticipants, type BulkParticipant, type InsertBulkParticipant } from "../../../shared/schema/bulk/schema";
import { contacts, workers, comm } from "../../../shared/schema";
import { eq, and } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

export const validate = createNoopValidator<InsertBulkParticipant, BulkParticipant>();

export interface BulkParticipantWithRelations {
  id: string;
  messageId: string;
  contactId: string;
  medium: string;
  commId: string | null;
  data: unknown;
  contactDisplayName: string | null;
  contactGiven: string | null;
  contactFamily: string | null;
  workerId: string | null;
  workerSiriusId: number | null;
  commStatus: string | null;
}

export interface BulkParticipantDeliveryStatRow {
  participantStatus: string;
  medium: string;
  commId: string | null;
  commStatus: string | null;
}

export interface BulkParticipantStorage {
  getById(id: string): Promise<BulkParticipant | undefined>;
  getByMessageId(messageId: string): Promise<BulkParticipant[]>;
  getPendingByMessageId(messageId: string, limit: number): Promise<BulkParticipant[]>;
  listForMessageWithRelations(messageId: string): Promise<BulkParticipantWithRelations[]>;
  getDeliveryStats(messageId: string): Promise<BulkParticipantDeliveryStatRow[]>;
  create(data: InsertBulkParticipant): Promise<BulkParticipant>;
  update(id: string, data: Partial<InsertBulkParticipant>): Promise<BulkParticipant | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByMessageAndMedium(messageId: string, medium: string): Promise<number>;
  existsForMessageAndContact(messageId: string, contactId: string): Promise<boolean>;
}

export function createBulkParticipantStorage(): BulkParticipantStorage {
  const storage: BulkParticipantStorage = {
    async getById(id: string): Promise<BulkParticipant | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(bulkParticipants)
        .where(eq(bulkParticipants.id, id));
      return row || undefined;
    },

    async getByMessageId(messageId: string): Promise<BulkParticipant[]> {
      const client = getClient();
      return await client
        .select()
        .from(bulkParticipants)
        .where(eq(bulkParticipants.messageId, messageId));
    },

    async getPendingByMessageId(messageId: string, limit: number): Promise<BulkParticipant[]> {
      const client = getClient();
      return await client
        .select()
        .from(bulkParticipants)
        .where(and(
          eq(bulkParticipants.messageId, messageId),
          eq(bulkParticipants.status, "pending"),
        ))
        .limit(limit);
    },

    async listForMessageWithRelations(messageId: string): Promise<BulkParticipantWithRelations[]> {
      const client = getClient();
      const workerSub = client
        .selectDistinctOn([workers.contactId], {
          contactId: workers.contactId,
          id: workers.id,
          siriusId: workers.siriusId,
        })
        .from(workers)
        .as("w");
      const rows = await client
        .select({
          id: bulkParticipants.id,
          messageId: bulkParticipants.messageId,
          contactId: bulkParticipants.contactId,
          medium: bulkParticipants.medium,
          commId: bulkParticipants.commId,
          data: bulkParticipants.data,
          contactDisplayName: contacts.displayName,
          contactGiven: contacts.given,
          contactFamily: contacts.family,
          workerId: workerSub.id,
          workerSiriusId: workerSub.siriusId,
          commStatus: comm.status,
        })
        .from(bulkParticipants)
        .innerJoin(contacts, eq(bulkParticipants.contactId, contacts.id))
        .leftJoin(workerSub, eq(workerSub.contactId, contacts.id))
        .leftJoin(comm, eq(bulkParticipants.commId, comm.id))
        .where(eq(bulkParticipants.messageId, messageId));
      return rows;
    },

    async getDeliveryStats(messageId: string): Promise<BulkParticipantDeliveryStatRow[]> {
      const client = getClient();
      const rows = await client
        .select({
          participantStatus: bulkParticipants.status,
          medium: bulkParticipants.medium,
          commId: bulkParticipants.commId,
          commStatus: comm.status,
        })
        .from(bulkParticipants)
        .leftJoin(comm, eq(bulkParticipants.commId, comm.id))
        .where(eq(bulkParticipants.messageId, messageId));
      return rows;
    },

    async create(data: InsertBulkParticipant): Promise<BulkParticipant> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [row] = await client
        .insert(bulkParticipants)
        .values(data)
        .returning();
      return row;
    },

    async update(id: string, data: Partial<InsertBulkParticipant>): Promise<BulkParticipant | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(bulkParticipants)
        .set(data)
        .where(eq(bulkParticipants.id, id))
        .returning();
      return updated || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bulkParticipants)
        .where(eq(bulkParticipants.id, id))
        .returning();
      return result.length > 0;
    },

    async existsForMessageAndContact(messageId: string, contactId: string): Promise<boolean> {
      const client = getClient();
      const rows = await client
        .select({ id: bulkParticipants.id })
        .from(bulkParticipants)
        .where(and(
          eq(bulkParticipants.messageId, messageId),
          eq(bulkParticipants.contactId, contactId),
        ))
        .limit(1);
      return rows.length > 0;
    },

    async deleteByMessageAndMedium(messageId: string, medium: string): Promise<number> {
      const client = getClient();
      const result = await client
        .delete(bulkParticipants)
        .where(and(
          eq(bulkParticipants.messageId, messageId),
          eq(bulkParticipants.medium, medium),
        ))
        .returning();
      return result.length;
    },
  };

  return storage;
}

export const bulkParticipantLoggingConfig = defineLoggingConfig<BulkParticipantStorage>({
  module: 'bulkParticipants',
  stateKey: 'bulkParticipant',
  getter: 'getById',
  hostEntityIdField: 'messageId',
  methods: {
    create: {
      entityIdFallback: 'new bulk participant',
      metadata: (_args, result) => ({
        messageId: result?.messageId,
        contactId: result?.contactId,
        commId: result?.commId,
      }),
      getDescription: async (_args, result) =>
        `Added participant (contact ${result?.contactId}) to bulk message ${result?.messageId}`,
    },
    update: {
      before: async () => undefined,
      metadata: (_args, result) => ({
        messageId: result?.messageId,
        contactId: result?.contactId,
        commId: result?.commId,
      }),
      getDescription: async () => `Updated bulk participant`,
    },
    delete: {
      before: async (args, storage) => ({ record: await storage.getById(args[0]) }),
      getHostEntityId: (_args, _result, beforeState) => beforeState?.record?.messageId,
      after: async (_args, result, _storage, beforeState) => ({
        deleted: result,
        metadata: { messageId: beforeState?.record?.messageId },
      }),
      getDescription: async () => `Deleted bulk participant`,
    },
  },
});
