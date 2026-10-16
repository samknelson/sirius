import type { IStorage } from "../storage";
import type { User } from "@shared/schema";
import { runInTransaction } from "../storage/transaction-context";
import { assertWorkerCommsSelection, WorkerCommsError } from "./worker-comms-compliance";
import { insertBulkMessageSchema } from "@shared/schema/bulk/schema";

/**
 * The draft row is the serialization point. No vendor or delivery entry point
 * is called here. Use the audited storage namespaces on this transaction.
 */
export async function handoffBulkRecipients(storage: IStorage, input: {
  contactIds: string[];
  bulkMessageId?: string;
  name: string;
  medium: string[];
  actor?: User;
  reportSelection?: unknown;
  hasReportSelection: boolean;
}) {
  return runInTransaction(async () => {
    const uniqueIds = [...new Set(input.contactIds)];
    const existingDraft = input.bulkMessageId
      ? await storage.bulkMessages.getForUpdate(input.bulkMessageId) : undefined;
    if (input.bulkMessageId && !existingDraft) throw new WorkerCommsError("Bulk message not found", 404);
    if (existingDraft && (existingDraft.status !== "draft" || !existingDraft.medium.length)) {
      throw new WorkerCommsError("Only draft messages with at least one channel can receive recipients", 409);
    }
    if ((existingDraft?.data as { recipientDeliveryStarted?: boolean } | null)?.recipientDeliveryStarted) {
      throw new WorkerCommsError("Cannot add recipients after delivery has started", 409);
    }
    if (input.hasReportSelection) {
      await assertWorkerCommsSelection(storage, input.actor, input.reportSelection, uniqueIds);
    }
    const existingIds = new Set(await storage.contacts.getExistingIds(uniqueIds));
    if (existingIds.size !== uniqueIds.length) {
      throw new WorkerCommsError(`${uniqueIds.length - existingIds.size} supplied contactIds do not resolve to real contacts`, 400);
    }
    const existing = existingDraft ? await storage.bulkParticipants.getByMessageId(existingDraft.id) : [];
    if (existing.some(p => p.status !== "pending" || p.commId !== null)) {
      throw new WorkerCommsError("Cannot add recipients after delivery has started", 409);
    }
    const draft = existingDraft ?? await storage.bulkMessages.create(insertBulkMessageSchema.parse({
      name: input.name, medium: input.medium, status: "draft",
    }));
    const present = new Set(existing.map(p => `${p.contactId}:${p.medium}`));
    let participantsCreated = 0, participantsSkipped = 0;
    for (const contactId of uniqueIds) {
      for (const medium of draft.medium) {
        const key = `${contactId}:${medium}`;
        if (present.has(key)) { participantsSkipped++; continue; }
        await storage.bulkParticipants.create({ messageId: draft.id, contactId, medium });
        present.add(key);
        participantsCreated++;
      }
    }
    return { bulkMessage: draft, participantsCreated, participantsSkipped,
      recipientsRequested: uniqueIds.length, recipientsResolved: existingIds.size, recipientsMissing: 0 };
  });
}
