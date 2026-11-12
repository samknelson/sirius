
import { getClient } from '../../../../../storage/transaction-context';

import { ledgerPayments } from "@shared/schema";

import type { LedgerPayment, InsertLedgerPayment } from "@shared/schema";
import { eq } from "drizzle-orm";

import { validate } from '../../../../../storage/ledger';

export interface S1LedgerPaymentOperations {

  /** Migration-only: like create, but preserves a verbatim historical dateCreated. */
  createForMigration(payment: InsertLedgerPayment & { dateCreated?: Date | null }): Promise<LedgerPayment>;

  /** Migration-only: like update, but the patch admits dateCreated (S1-wins
   * sync re-writes the verbatim historical timestamp). */
  updateForMigration(
    id: string,
    payment: Partial<InsertLedgerPayment> & { dateCreated?: Date },
  ): Promise<LedgerPayment | undefined>;
}

export function createS1LedgerPaymentOperations(): S1LedgerPaymentOperations {
  return {

    async createForMigration(insertPayment: InsertLedgerPayment & { dateCreated?: Date | null }): Promise<LedgerPayment> {
      // Migration-only path: identical to create, but the input type admits a
      // verbatim historical dateCreated (create's public type omits it so the
      // column defaults to now() for app-originated payments). Skips the
      // currency cross-check — the T19 loader preflights payment-type/account
      // currency parity per row before calling this (currency_mismatch reject)
      // and verifies every written row post-write.
      validate.validateOrThrow(insertPayment);
      const client = getClient();
      const [payment] = await client.insert(ledgerPayments)
        .values(insertPayment as any)
        .returning();
      return payment;
    },

    async updateForMigration(
      id: string,
      paymentUpdate: Partial<InsertLedgerPayment> & { dateCreated?: Date },
    ): Promise<LedgerPayment | undefined> {
      // Migration-only path (T19 S1-wins sync): identical to update, but the
      // patch type admits dateCreated so a changed S1 payment re-writes its
      // verbatim historical timestamp (update's public type omits it). Skips
      // the currency cross-check for the same reason createForMigration does —
      // the loader preflights payment-type/account currency parity per row
      // (currency_mismatch reject) and verifies every written row post-write.
      validate.validateOrThrow(id);
      const client = getClient();
      const [payment] = await client.update(ledgerPayments)
        .set(paymentUpdate as any)
        .where(eq(ledgerPayments.id, id))
        .returning();
      return payment || undefined;
    }
  };
}

export const s1Payments = createS1LedgerPaymentOperations();
