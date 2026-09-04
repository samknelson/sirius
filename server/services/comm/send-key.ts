import { createCommStorage } from '../../storage/comm';
import type { Comm } from '@shared/schema';

const commStorage = createCommStorage();

/**
 * The outcome code every sender reports when a send was refused because its
 * key had already been spent. It is deliberately separate from success and
 * from every existing error code: nothing failed, and a caller must not
 * report or log it as a failure. The result also carries the communication
 * record that DID go out, so an operator can be pointed at it.
 */
export const ALREADY_SENT = 'ALREADY_SENT' as const;

export type AlreadySentCode = typeof ALREADY_SENT;

export interface AlreadySentQuery {
  /** 'sms' | 'email' | 'postal' | 'inapp' — the medium the send would use. */
  medium: string;
  contactId: string;
  sendKey: string;
}

/**
 * Has a message with this key already been sent to this contact on this
 * medium? Returns the existing communication record, or `undefined`.
 *
 * OPTIMIZATION ONLY — NOT THE GUARANTEE. This query takes no lock, and two
 * callers asking at the same moment can both be told "not yet". Its only
 * purpose is to let a caller skip work it would otherwise waste: composing a
 * message, rendering a template, spending a rate-limit or paid-lookup budget
 * on a send that is going to be refused.
 *
 * What actually makes a keyed send at-most-once is the insert of the
 * communication row, which claims the key under the
 * `comm_medium_contact_id_send_key_unique` constraint and returns nothing
 * when it loses. Never treat a "not yet" answer here as permission to send
 * without a key.
 */
export async function findSentWithKey({
  medium,
  contactId,
  sendKey,
}: AlreadySentQuery): Promise<Comm | undefined> {
  return await commStorage.getCommBySendKey(medium, contactId, sendKey);
}

/**
 * Convenience form of {@link findSentWithKey}. The same caveat applies: it is
 * an optimization, never the guarantee.
 */
export async function hasSentWithKey(query: AlreadySentQuery): Promise<boolean> {
  return (await findSentWithKey(query)) !== undefined;
}
