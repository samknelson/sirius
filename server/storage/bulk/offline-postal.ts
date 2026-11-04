import { and, eq, inArray, sql, getTableColumns } from "drizzle-orm";
import { comm, commPostal, commTags, optionsCommTags, type InsertCommPostal } from "@shared/schema";
import { bulkParticipants } from "@shared/schema/bulk/schema";
import { getClient, onAfterCommit, runInTransaction } from "../transaction-context";
import { withStorageLogging, withMasqueradeMeta } from "../middleware/logging";
import { getRequestContext } from "../../middleware/request-context";
import { storageLogger } from "../../logger";
import { isMailingCompleted } from "../../../shared/bulk-mailing";

export interface OfflinePostalRecord {
  participantId: string;
  contactId: string;
  name: string;
  postal: Omit<InsertCommPostal, "commId">;
  previousCommId?: string | null;
  sendKey?: string;
}

export interface OfflinePostalOutcome {
  participantId: string;
  contactId: string;
  previousCommId: string | null;
  commId: string | null;
  status: "see_comm" | "send_failed";
  message: string | null;
}

// Keep statements comfortably below parameter limits, even for postal details
// with all optional fields populated. No parallel queries on the transaction.
export const OFFLINE_POSTAL_BATCH_SIZE = 100;

/** One bounded write path for success repairs and address refusals, with the
 * same snapshot guard and per-recipient after-commit audit as completion. */
async function writeOutcomes(messageId: string, outcomes: OfflinePostalOutcome[], userId?: string) {
  const context = { ...getRequestContext() };
  for (let offset = 0; offset < outcomes.length; offset += OFFLINE_POSTAL_BATCH_SIZE) {
    const batch = outcomes.slice(offset, offset + OFFLINE_POSTAL_BATCH_SIZE);
    const values = batch.map(row => sql`(${row.participantId}::varchar, ${row.contactId}::varchar,
      ${row.previousCommId}::varchar, ${row.commId}::varchar, ${row.status}::bulk_participant_status, ${row.message}::text)`);
    const updated = await getClient().update(bulkParticipants).set({
      commId: sql`links.comm_id`, status: sql`links.status`, message: sql`links.message`,
    }).from(sql`(VALUES ${sql.join(values, sql`, `)}) AS links(id, contact_id, previous_comm_id, comm_id, status, message)`)
      .where(sql`${bulkParticipants.id} = links.id
        AND ${bulkParticipants.contactId} = links.contact_id
        AND ${bulkParticipants.messageId} = ${messageId}
        AND ${bulkParticipants.medium} = 'postal'
        AND ${bulkParticipants.commId} IS NOT DISTINCT FROM links.previous_comm_id`)
      .returning(getTableColumns(bulkParticipants));
    if (updated.length !== batch.length) throw new Error("Unable to link every offline postal communication or recipient error");
    onAfterCommit(() => {
      for (const row of updated) {
        storageLogger.info("Storage operation: bulkParticipants.update", {
          module: "bulkParticipants", operation: "update", entity_id: row.id,
          host_entity_id: messageId, description: row.status === "send_failed"
            ? "Offline postal delivery blocked by address" : "Updated bulk participant",
          user_id: userId ?? context.userId, user_email: context.userEmail, ip_address: context.ipAddress,
          meta: withMasqueradeMeta({
            args: [row.id, { commId: row.commId, status: row.status, message: row.message }],
            after: { bulkParticipant: row, metadata: { messageId, contactId: row.contactId, commId: row.commId } },
          }, context),
        });
      }
    });
  }
  return outcomes.length;
}

export function createOfflinePostalExportStorage() {
  const implementation = {
    async applyOutcomes(messageId: string, outcomes: OfflinePostalOutcome[], userId?: string) {
      return runInTransaction(() => writeOutcomes(messageId, outcomes, userId));
    },
    async record(messageId: string, records: OfflinePostalRecord[], tagIds: string[], userId?: string) {
      return runInTransaction(async () => {
        if (!records.length) return 0;
        const client = getClient();
        const uniqueTags = [...new Set(tagIds)];
        const tags = uniqueTags.length
          ? await client.select().from(optionsCommTags).where(inArray(optionsCommTags.id, uniqueTags))
          : [];
        if (tags.length !== uniqueTags.length) throw new Error("A mailing communication tag is no longer available");
        const sendKey = `bulk-postal-export:${messageId}`;
        const context = { ...getRequestContext() };
        const auditActor = {
          user_id: userId ?? context.userId,
          user_email: context.userEmail,
          ip_address: context.ipAddress,
        };
        const seenContacts = new Set<string>();
        const seenParticipants = new Set<string>();
        for (const record of records) {
          if (seenContacts.has(record.contactId) || seenParticipants.has(record.participantId)) {
            throw new Error("Duplicate offline mailing recipient");
          }
          seenContacts.add(record.contactId);
          seenParticipants.add(record.participantId);
        }
        for (let offset = 0; offset < records.length; offset += OFFLINE_POSTAL_BATCH_SIZE) {
          const batch = records.slice(offset, offset + OFFLINE_POSTAL_BATCH_SIZE);
          // As on the single-send path, the insert IS the send-once claim.
          const created = await client.insert(comm).values(batch.map(record => ({
            medium: "postal", contactId: record.contactId, status: "offline",
            sent: new Date(), data: { initiatedBy: userId || "system", offline: true },
            sendKey: record.sendKey ?? sendKey,
          }))).onConflictDoNothing({ target: [comm.medium, comm.contactId, comm.sendKey] }).returning();
          const byContact = new Map(created.map(row => [row.contactId, row.id]));
          const missing = batch.filter(record => !byContact.has(record.contactId));
          if (missing.length) {
            // A separate statement sees the winner after a conflicting insert
            // waits. Do not use a same-statement snapshot to recover the key.
            const existing = await client.select().from(comm).where(and(
              eq(comm.medium, "postal"), inArray(comm.sendKey, missing.map(record => record.sendKey ?? sendKey)),
              inArray(comm.contactId, missing.map(record => record.contactId)),
            ));
            for (const record of missing) {
              const row = existing.find(row => row.contactId === record.contactId && row.sendKey === (record.sendKey ?? sendKey));
              if (!row || !isMailingCompleted(row.status)) {
                throw new Error("An existing mailing attempt is not completed. Refresh before retrying.");
              }
              byContact.set(row.contactId, row.id);
            }
          }
          const newlyCreated = new Set(created.map(row => row.contactId));
          const newRecords = batch.filter(record => newlyCreated.has(record.contactId));
          if (newRecords.length) {
            await client.insert(commPostal).values(newRecords.map(record => ({
              ...record.postal, commId: byContact.get(record.contactId)!,
            })));
            if (tags.length) {
              const links = newRecords.flatMap(record =>
                tags.map(tag => ({ commId: byContact.get(record.contactId)!, commTagId: tag.id })),
              );
              const names = new Map(newRecords.map(record => [byContact.get(record.contactId)!, record.name]));
              const tagNames = new Map(tags.map(tag => [tag.id, tag.name]));
              for (let tagOffset = 0; tagOffset < links.length; tagOffset += 1000) {
                const insertedTags = await client.insert(commTags)
                  .values(links.slice(tagOffset, tagOffset + 1000)).onConflictDoNothing().returning();
                onAfterCommit(() => {
                  for (const link of insertedTags) {
                    storageLogger.info("Storage operation: comm-tags.addTag", {
                      module: "comm-tags", operation: "addTag", entity_id: link.commTagId,
                      host_entity_id: link.commId,
                      ...auditActor,
                      description: `setTags diff: linked tag "${tagNames.get(link.commTagId)}" to comm "POSTAL to ${names.get(link.commId)}"`,
                      meta: withMasqueradeMeta({ commId: link.commId, tagId: link.commTagId, source: "setTags" }, context),
                    });
                  }
                });
              }
            }
          }
          const outcomes = batch.map(record => {
            const commId = byContact.get(record.contactId);
            if (!commId) throw new Error("Unable to recover offline postal communication");
            return {
              participantId: record.participantId, contactId: record.contactId,
              previousCommId: record.previousCommId ?? null, commId,
              status: "see_comm" as const, message: null,
            };
          });
          await writeOutcomes(messageId, outcomes, userId);
        }
        return records.length;
      });
    },
  };
  return withStorageLogging(implementation, {
    module: "bulkParticipants", table: "bulk_participants", hostTable: "bulk_messages",
    methods: { applyOutcomes: {
      enabled: true, metadataMode: "modified", metadataEntityId: () => undefined,
      getEntityId: args => args[0], getHostEntityId: args => args[0],
      logArgs: args => [args[0], { recipientCount: args[1].length }],
      getDescription: async (_args, result) => `Updated ${result} offline postal recipient outcomes`,
    }, record: {
      enabled: true,
      metadataMode: "modified", metadataEntityId: () => undefined,
      getEntityId: args => args[0], getHostEntityId: args => args[0],
      logArgs: args => [args[0], { recipientCount: args[1].length }],
      getDescription: async (_args, result) => `Linked ${result} offline postal communications`,
    } },
  });
}
