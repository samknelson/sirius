import { and, eq, sql } from "drizzle-orm";
import { getClient } from "../transaction-context";
import {
  ledgerPaymentAttemptEvents,
  ledgerPaymentAttempts,
  ledgerEa,
  type InsertLedgerPaymentAttempt,
  type LedgerPaymentAttempt,
} from "@shared/schema";

type AttemptUpdate = Partial<Pick<LedgerPaymentAttempt, "providerIntentRef" | "lastProviderEventCreated" | "failureMessage" | "failureCode" | "reservationExpiresAt" | "completedAt">>;
type AttemptCreate = Omit<InsertLedgerPaymentAttempt, "accountId" | "entityType" | "entityId"> &
  Partial<Pick<InsertLedgerPaymentAttempt, "accountId" | "entityType" | "entityId">>;
type InboxEvent = typeof ledgerPaymentAttemptEvents.$inferSelect;

export interface PaymentAttemptStorage {
  get(id: string): Promise<LedgerPaymentAttempt | undefined>;
  getByIdempotencyKey(key: string): Promise<LedgerPaymentAttempt | undefined>;
  getByProviderIntent(ref: string, gatewayConfigId?: string): Promise<LedgerPaymentAttempt | undefined>;
  create(input: AttemptCreate): Promise<LedgerPaymentAttempt>;
  updateStatus(id: string, status: string, fields?: AttemptUpdate): Promise<LedgerPaymentAttempt | undefined>;
  recordEvent(input: { gatewayConfigId?: string; attemptId?: string | null; providerEventId: string; eventType: string; providerCreated?: number | null; payload: unknown }): Promise<boolean>;
  getEvent(gatewayConfigId: string, providerEventId: string): Promise<InboxEvent | undefined>;
  markEventProcessed(gatewayConfigId: string, providerEventId: string): Promise<void>;
  markEventError(gatewayConfigId: string, providerEventId: string, error: string): Promise<void>;
  completeEvent(gatewayConfigId: string, providerEventId: string, error?: string): Promise<void>;
  claimLedgerPosting(id: string, ledgerPaymentId: string): Promise<boolean>;
  lockEa(id: string): Promise<void>;
  /** Must be called inside the transaction that reads and posts the attempt. */
  lockAttempt(id: string): Promise<void>;
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
    async getByProviderIntent(ref, gatewayConfigId) {
      const [row] = await getClient().select().from(ledgerPaymentAttempts).where(and(eq(ledgerPaymentAttempts.providerIntentRef, ref), gatewayConfigId ? eq(ledgerPaymentAttempts.gatewayConfigId, gatewayConfigId) : undefined));
      return row;
    },
    async create(input) {
      const [ea] = await getClient().select().from(ledgerEa).where(eq(ledgerEa.id, input.ledgerEaId));
      if (!ea) throw new Error("Payment attempt entity account not found");
      if ((input.accountId !== undefined && input.accountId !== ea.accountId) ||
          (input.entityType !== undefined && input.entityType !== ea.entityType) ||
          (input.entityId !== undefined && input.entityId !== ea.entityId)) {
        throw new Error("Payment attempt context does not match its entity account");
      }
      const [row] = await getClient().insert(ledgerPaymentAttempts).values({
        ...input, accountId: ea.accountId, entityType: ea.entityType, entityId: ea.entityId,
        createdAt: new Date(), updatedAt: new Date(),
      }).onConflictDoNothing({ target: ledgerPaymentAttempts.idempotencyKey }).returning();
      if (row) return row;
      const existing = await this.getByIdempotencyKey(input.idempotencyKey);
      if (!existing) throw new Error("Payment attempt was not created");
      return existing;
    },
    async updateStatus(id, status, fields = {}) {
      // Runtime allowlist as well as a TS contract: payment context is immutable.
      const updates: AttemptUpdate = {};
      for (const key of ["providerIntentRef", "lastProviderEventCreated", "failureMessage", "failureCode", "reservationExpiresAt", "completedAt"] as const) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) Object.assign(updates, { [key]: fields[key] });
      }
      const [row] = await getClient().update(ledgerPaymentAttempts)
        .set({ ...updates, status, updatedAt: new Date(),
          ...(["succeeded", "failed", "canceled", "expired"].includes(status) ? { completedAt: new Date() } : {}),
        })
        .where(and(eq(ledgerPaymentAttempts.id, id), sql`
          NOT (${ledgerPaymentAttempts.status} = 'succeeded' AND ${status} <> 'succeeded')
          AND
          CASE ${ledgerPaymentAttempts.status}
            WHEN 'created' THEN 0
            WHEN 'requires_action' THEN 0
            WHEN 'processing' THEN 1
            WHEN 'succeeded' THEN 2
            WHEN 'failed' THEN 2
            WHEN 'canceled' THEN 2
            WHEN 'expired' THEN 2
            ELSE -1
          END <= CASE ${status}
            WHEN 'created' THEN 0
            WHEN 'requires_action' THEN 0
            WHEN 'processing' THEN 1
            WHEN 'succeeded' THEN 2
            WHEN 'failed' THEN 2
            WHEN 'canceled' THEN 2
            WHEN 'expired' THEN 2
            ELSE -1
          END`))
        .returning();
      return row;
    },
    async recordEvent(input) {
      const attempt = input.attemptId ? await this.get(input.attemptId) : undefined;
      const gatewayConfigId = input.gatewayConfigId ?? attempt?.gatewayConfigId;
      if (!gatewayConfigId || (attempt && attempt.gatewayConfigId !== gatewayConfigId)) throw new Error("Event gateway does not match payment attempt");
      // Retain only normalized financial evidence, never raw provider objects.
      const payload: Record<string, unknown> = {};
      const source = input.payload && typeof input.payload === "object" ? input.payload as Record<string, unknown> : {};
      for (const key of ["type", "providerIntentRef", "providerRef", "status", "amount", "amountMinor", "currency", "paymentMethodType", "failureCode"]) {
        if (typeof source[key] === "string" || typeof source[key] === "number") payload[key] = source[key];
      }
      const [row] = await getClient().insert(ledgerPaymentAttemptEvents).values({ ...input, gatewayConfigId, payload })
        .onConflictDoNothing({ target: [ledgerPaymentAttemptEvents.gatewayConfigId, ledgerPaymentAttemptEvents.providerEventId] }).returning({ id: ledgerPaymentAttemptEvents.id });
      return !!row;
    },
    async getEvent(gatewayConfigId, providerEventId) {
      const [row] = await getClient().select().from(ledgerPaymentAttemptEvents).where(and(eq(ledgerPaymentAttemptEvents.gatewayConfigId, gatewayConfigId), eq(ledgerPaymentAttemptEvents.providerEventId, providerEventId)));
      return row;
    },
    async markEventProcessed(gatewayConfigId, providerEventId) {
      await getClient().update(ledgerPaymentAttemptEvents).set({ processedAt: new Date(), error: null }).where(and(eq(ledgerPaymentAttemptEvents.gatewayConfigId, gatewayConfigId), eq(ledgerPaymentAttemptEvents.providerEventId, providerEventId)));
    },
    async markEventError(gatewayConfigId, providerEventId, error) {
      await getClient().update(ledgerPaymentAttemptEvents).set({ error }).where(and(eq(ledgerPaymentAttemptEvents.gatewayConfigId, gatewayConfigId), eq(ledgerPaymentAttemptEvents.providerEventId, providerEventId)));
    },
    async completeEvent(gatewayConfigId, providerEventId, error) {
      if (error !== undefined) await this.markEventError(gatewayConfigId, providerEventId, error);
      else await this.markEventProcessed(gatewayConfigId, providerEventId);
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
    async lockAttempt(id) {
      await getClient().execute(sql`SELECT id FROM ${ledgerPaymentAttempts} WHERE id = ${id} FOR UPDATE`);
    },
    async expireReservations(eaId) {
      await getClient().update(ledgerPaymentAttempts)
        .set({ status: "expired", failureMessage: "Payment confirmation expired", completedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(ledgerPaymentAttempts.ledgerEaId, eaId),
          sql`${ledgerPaymentAttempts.status} IN ('created','requires_action')`,
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
              ${ledgerPaymentAttempts.status} IN ('created','requires_action')
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