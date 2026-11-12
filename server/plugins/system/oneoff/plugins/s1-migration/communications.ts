import { getClient, runInTransaction } from '../../../../../storage/transaction-context';
import { comm, commInteraction } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface S1CommInteractionOperations {

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

export function createS1CommInteractionOperations(): S1CommInteractionOperations {
  return {

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
    }
  };
}

export const s1Communications = createS1CommInteractionOperations();
