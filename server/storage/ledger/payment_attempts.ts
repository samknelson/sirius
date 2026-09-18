import { and, eq, sql } from "drizzle-orm";
import { getClient } from "../transaction-context";
import {
  ledgerPaymentAttemptEvents,
  ledgerPaymentAttempts,
  ledgerEa,
  type InsertLedgerPaymentAttempt,
  type LedgerPaymentAttempt,
} from "@shared/schema";

export interface PaymentAttemptStorage {
  get(id: string): Promise<LedgerPaymentAttempt | undefined>;
  getByIdempotencyKey(key: string): Promise<LedgerPaymentAttempt | undefined>;
  getByProviderIntent(ref: string): Promise<LedgerPaymentAttempt | undefined>;
  create(input: InsertLedgerPaymentAttempt): Promise<LedgerPaymentAttempt>;
  updateStatus(id: string, status: string, fields?: Partial<LedgerPaymentAttempt>): Promise<LedgerPaymentAttempt | undefined>;
  recordEvent(input: { attemptId: string; providerEventId: string; eventType: string; providerCreated: number; payload: unknown }): Promise<boolean>;
  claimLedgerPosting(id: string, ledgerPaymentId: string): Promise<boolean>;
  lockEa(id: string): Promise<void>;
  expireReservations(eaId: string): Promise<void>;
  getReservedAmount(eaId: string): Promise<number>;
}

export function createPaymentAttemptStorage(): PaymentAttemptStorage {
  return {
    async get(id) {
      const [row] = await getClient().select().from(ledgerPaymentAttempts).where(eq(ledgerPaymentAttempts.id, id));
      return row;
    },
    async getByIdempotencyKey(key) {
      const [row] = await getClient().select().from(ledgerPaymentAttempts).where(eq(ledgerPaymentAttempts.idempotencyKey, key));
      return row;
    },
    async getByProviderIntent(ref) {
      const [row] = await getClient().select().from(ledgerPaymentAttempts).where(eq(ledgerPaymentAttempts.providerIntentRef, ref));
      return row;
    },
    async create(input) {
      const [row] = await getClient().insert(ledgerPaymentAttempts).values(input).onConflictDoNothing({ target: ledgerPaymentAttempts.idempotencyKey }).returning();
      if (row) return row;
      const existing = await this.getByIdempotencyKey(input.idempotencyKey);
      if (!existing) throw new Error("Payment attempt was not created");
      return existing;
    },
    async updateStatus(id, status, fields = {}) {
      const [row] = await getClient().update(ledgerPaymentAttempts)
        .set({ ...fields, status })
        .where(and(eq(ledgerPaymentAttempts.id, id), sql`
          NOT (${ledgerPaymentAttempts.status} = 'succeeded' AND ${sql.raw(`'${status.replace(/'/g, "''")}'`)} = 'failed')
          AND
          CASE ${ledgerPaymentAttempts.status}
            WHEN 'requires_action' THEN 0
            WHEN 'processing' THEN 1
            WHEN 'succeeded' THEN 2
            WHEN 'failed' THEN 2
            ELSE -1
          END <= CASE ${sql.raw(`'${status.replace(/'/g, "''")}'`)}
            WHEN 'requires_action' THEN 0
            WHEN 'processing' THEN 1
            WHEN 'succeeded' THEN 2
            WHEN 'failed' THEN 2
            ELSE -1
          END`))
        .returning();
      return row;
    },
    async recordEvent(input) {
      const [row] = await getClient().insert(ledgerPaymentAttemptEvents).values(input)
        .onConflictDoNothing({ target: ledgerPaymentAttemptEvents.providerEventId }).returning({ id: ledgerPaymentAttemptEvents.id });
      return !!row;
    },
    async claimLedgerPosting(id, ledgerPaymentId) {
      const [row] = await getClient().update(ledgerPaymentAttempts)
        .set({ ledgerPaymentId })
        .where(and(eq(ledgerPaymentAttempts.id, id), sql`${ledgerPaymentAttempts.ledgerPaymentId} IS NULL`))
        .returning({ id: ledgerPaymentAttempts.id });
      return !!row;
    },
    async lockEa(id) {
      await getClient().execute(sql`SELECT id FROM ${ledgerEa} WHERE id = ${id} FOR UPDATE`);
    },
    async expireReservations(eaId) {
      await getClient().update(ledgerPaymentAttempts)
        .set({ status: "failed", failureMessage: "Payment confirmation expired" })
        .where(and(
          eq(ledgerPaymentAttempts.ledgerEaId, eaId),
          eq(ledgerPaymentAttempts.status, "requires_action"),
          sql`${ledgerPaymentAttempts.reservationExpiresAt} IS NOT NULL`,
          sql`${ledgerPaymentAttempts.reservationExpiresAt} <= now()`,
        ));
    },
    async getReservedAmount(eaId) {
      const [row] = await getClient()
        .select({ total: sql<string>`COALESCE(SUM(${ledgerPaymentAttempts.amount}), 0)` })
        .from(ledgerPaymentAttempts)
        .where(and(
          eq(ledgerPaymentAttempts.ledgerEaId, eaId),
          sql`(
            ${ledgerPaymentAttempts.status} = 'processing'
            OR (
              ${ledgerPaymentAttempts.status} = 'requires_action'
              AND (
                ${ledgerPaymentAttempts.reservationExpiresAt} IS NULL
                OR ${ledgerPaymentAttempts.reservationExpiresAt} > now()
              )
            )
          )`,
        ));
      return Number(row?.total ?? 0);
    },
  };
}