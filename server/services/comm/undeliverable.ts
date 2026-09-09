import { createCommStorage } from '../../storage/comm';
import { storage } from '../../storage';
import { logger } from '../../logger';
import type { Comm } from '@shared/schema';
import type { MediumName } from '@shared/delivery-fields';

/**
 * Recording a message that was MEANT to go out and could not be composed.
 *
 * A template whose required field renders blank — an email subject built
 * entirely from a token that resolved to nothing — produces no message.
 * The old behaviour was to return early and send nothing, which left no
 * trace anywhere: the recipient never heard, and nobody could find out
 * why. Every other way a send can fail (not opted in, not allowlisted,
 * provider rejection) leaves a failed communication row with a reason on
 * it, so this one does too.
 *
 * There is deliberately no medium-detail row: nothing was composed, so
 * there is no subject, no body and no destination to record. The comm row
 * carries the medium, the recipient and the reason, which is the whole of
 * what happened.
 */
export interface UndeliverableRecord {
  medium: MediumName;
  contactId: string;
  /** Human-readable reason, naming the fields that rendered blank. */
  reason: string;
  /** The required fields that rendered blank. */
  blankFields: string[];
  /** Who or what was sending — a plugin id, a bulk message id. */
  source: string;
  tagIds?: string[];
}

/**
 * Write the failure. Best-effort: recording that a message could not be
 * composed must never itself break the fan-out that discovered it, so a
 * storage failure is logged and swallowed.
 */
export async function recordUndeliverableMessage(
  record: UndeliverableRecord,
): Promise<Comm | undefined> {
  const { medium, contactId, reason, blankFields, source, tagIds } = record;
  try {
    const commStorage = createCommStorage();
    const created = await commStorage.createComm({
      medium,
      contactId,
      status: 'failed',
      sent: new Date(),
      data: {
        initiatedBy: source,
        errorCode: 'BLANK_REQUIRED_FIELD',
        errorMessage: reason,
        blankFields,
      },
    });
    if (created && tagIds && tagIds.length > 0) {
      await storage.commTags.setTags(created.id, tagIds);
    }
    logger.warn('Message not sent - required field rendered blank', {
      service: 'undeliverable-recorder',
      medium,
      contactId,
      source,
      blankFields,
      commId: created?.id,
    });
    return created;
  } catch (error) {
    logger.error('Failed to record an undeliverable message', {
      service: 'undeliverable-recorder',
      medium,
      contactId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
