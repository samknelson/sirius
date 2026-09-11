import type { DeliverContactResult } from "./deliver";
import { recordUndeliverableMessage } from "../../services/comm/undeliverable";
import { undeliverableReason } from "../../delivery/shape";
import type { MediumName } from "@shared/delivery-fields";

/**
 * A bulk send that could not be composed for THIS recipient.
 *
 * A required field that renders blank — a subject built entirely from a
 * token that resolved to nothing — produces no message, and the old
 * behaviour left no trace of that anywhere the recipient's history could
 * show it. Every other way a send fails leaves a failed communication
 * with a reason on it, so this one does too, through the same helper the
 * event notifier uses; the run's participant row still records the
 * failure as well, and now points at the comm that explains it.
 */
export async function recordBulkUndeliverable(
  medium: MediumName,
  messageId: string,
  contactId: string,
  blankFields: string[],
  tagIds?: string[],
): Promise<DeliverContactResult> {
  const reason = undeliverableReason(medium, blankFields);
  const comm = await recordUndeliverableMessage({
    medium,
    contactId,
    reason,
    blankFields,
    source: `bulk:${messageId}`,
    tagIds,
  });
  return {
    success: false,
    commId: comm?.id,
    comm,
    error: reason,
    // Named for what happened, not for missing configuration: the
    // message HAS content, it just could not be composed for this
    // recipient. Matches the code on the comm row.
    errorCode: "BLANK_REQUIRED_FIELD",
  };
}
