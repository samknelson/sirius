import type { BulkMessage } from "../../../shared/schema/bulk/schema";
import type { BulkParticipantStorage } from "../../storage/bulk/participants";

/**
 * Enroll only new contact/channel pairs. Existing delivery records must remain
 * untouched, including failed and already-delivered participants.
 * The caller supplies the transaction containing the entire enrollment.
 */
export async function enqueueBulkRecipients(
  participants: Pick<BulkParticipantStorage, "createIfMissing">,
  message: Pick<BulkMessage, "id" | "medium">,
  contactIds: string[],
): Promise<{ participantsCreated: number; participantsSkipped: number }> {
  let participantsCreated = 0;
  let participantsSkipped = 0;
  for (const contactId of new Set(contactIds)) {
    for (const medium of new Set(message.medium)) {
      const created = await participants.createIfMissing({
        messageId: message.id,
        contactId,
        medium,
      });
      if (created) participantsCreated++;
      else participantsSkipped++;
    }
  }
  return { participantsCreated, participantsSkipped };
}
