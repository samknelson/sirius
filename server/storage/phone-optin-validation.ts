import { commSmsOptin } from '@shared/schema';
import { getClient } from './transaction-context';

/**
 * The validation facts that live on the SMS opt-in row.
 *
 * `sms_possible` and `voice_possible` are read straight off this row by the
 * senders and by the phone management UI, so they stay here rather than
 * moving into the web client cache with the response that produced them.
 * `validated_at` and `validation_response` are kept in step for the same
 * reason: the UI shows them.
 *
 * None of this is the cache any more — the answer to "have we looked this
 * number up, and when" is `wc_cache`. This is the derived write that happens
 * as the cache fills.
 *
 * This module deliberately does NOT go through {@link CommSmsOptinStorage}:
 * those methods normalize their argument by calling the phone validator, and
 * the validator is this module's only caller. Writing the row directly is what
 * keeps the two from calling each other.
 */
export interface PhoneOptinValidationStorage {
  write(
    e164PhoneNumber: string,
    entry: {
      validationResponse: unknown;
      smsPossible: boolean | null;
      voicePossible: boolean | null;
    },
  ): Promise<void>;
}

export function createPhoneOptinValidationStorage(): PhoneOptinValidationStorage {
  return {
    async write(
      e164PhoneNumber: string,
      entry: {
        validationResponse: unknown;
        smsPossible: boolean | null;
        voicePossible: boolean | null;
      },
    ): Promise<void> {
      const client = getClient();
      const validatedAt = new Date();
      // Written on the CALLER'S connection, inside whatever transaction the
      // caller holds. A caller that later rolls back discards these flags; the
      // answer itself is in the cache and is not looked up again.
      await client
        .insert(commSmsOptin)
        .values({
          phoneNumber: e164PhoneNumber,
          optin: false,
          allowlist: false,
          validatedAt,
          validationResponse: entry.validationResponse as Record<string, unknown>,
          smsPossible: entry.smsPossible,
          voicePossible: entry.voicePossible,
        })
        .onConflictDoUpdate({
          target: commSmsOptin.phoneNumber,
          set: {
            validatedAt,
            validationResponse: entry.validationResponse as Record<string, unknown>,
            smsPossible: entry.smsPossible,
            voicePossible: entry.voicePossible,
          },
        });
    },
  };
}

export const phoneOptinValidation = createPhoneOptinValidationStorage();
