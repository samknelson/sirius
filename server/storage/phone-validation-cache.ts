import { sql, eq } from 'drizzle-orm';
import { commSmsOptin } from '@shared/schema';
import { getClient } from './transaction-context';

/**
 * The stored answer to "has this number been validated, and when".
 *
 * There is exactly one place in the schema that records *when* a number was
 * validated — the SMS opt-in row — so that row is the cache. A number gets a
 * row the first time it is validated, opted out, which is what already
 * happened on every phone create before this cache existed.
 *
 * This module deliberately does NOT go through {@link CommSmsOptinStorage}:
 * those methods normalize their argument by calling the phone validator, and
 * the validator is this module's only caller. Reading the row directly is what
 * keeps the two from calling each other.
 */
export interface PhoneValidationCacheEntry {
  /** When the provider last answered for this number. Never set by a local parse. */
  validatedAt: Date | null;
  /** The `PhoneValidationResult` the provider answer produced, as stored. */
  validationResponse: unknown;
}

export interface PhoneValidationCacheStorage {
  read(e164PhoneNumber: string): Promise<PhoneValidationCacheEntry | undefined>;
  write(
    e164PhoneNumber: string,
    entry: {
      validationResponse: unknown;
      smsPossible: boolean | null;
      voicePossible: boolean | null;
    },
  ): Promise<void>;
  /**
   * Whether the connection this write would go out on accepts writes.
   *
   * Asked of the connection rather than tracked alongside it, so it cannot
   * drift from reality and so it picks up every mechanism that sets the
   * setting — `SET TRANSACTION READ ONLY` in the read-only storage helper,
   * `default_transaction_read_only` armed per pool checkout in maintenance
   * mode, and anything added later — without knowing any of them by name.
   */
  canStore(): Promise<boolean>;
}

export function createPhoneValidationCacheStorage(): PhoneValidationCacheStorage {
  return {
    async read(e164PhoneNumber: string): Promise<PhoneValidationCacheEntry | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          validatedAt: commSmsOptin.validatedAt,
          validationResponse: commSmsOptin.validationResponse,
        })
        .from(commSmsOptin)
        .where(eq(commSmsOptin.phoneNumber, e164PhoneNumber));
      return row || undefined;
    },

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
      // caller holds. A caller that later rolls back discards the cached
      // validation, which costs one repeat lookup and nothing else.
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

    async canStore(): Promise<boolean> {
      const client = getClient();
      try {
        const result = await client.execute(
          sql`SELECT current_setting('transaction_read_only') AS read_only`,
        );
        const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
        const value = (rows[0] as { read_only?: string } | undefined)?.read_only;
        return value === 'off';
      } catch {
        // Fail closed. The rule is "never call the provider unless the result
        // can be stored", and an unanswerable connection is not a yes.
        return false;
      }
    },
  };
}

export const phoneValidationCache = createPhoneValidationCacheStorage();
