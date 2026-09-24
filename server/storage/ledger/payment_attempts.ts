import { and, eq, sql, lt, isNull, asc, or } from "drizzle-orm";
import { getClient } from "../transaction-context";
import {
  ledgerPaymentAttemptEvents,
  ledgerPaymentAttempts,
  ledgerEa,
  type InsertLedgerPaymentAttempt,
  type LedgerPaymentAttempt,
  ledgerPaymentMethods,
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
  getReservations(eaId: string): Promise<LedgerPaymentAttempt[]>;
  listForRecovery(limit: number, olderThan: Date): Promise<LedgerPaymentAttempt[]>;
  listPendingEvents(limit: number): Promise<InboxEvent[]>;
  setDefaultIfAbsent(id: string, entityType: string, entityId: string, gatewayConfigId: string): Promise<void>;
  markMethodSaved(id: string): Promise<void>;
  markEventIgnored(gatewayConfigId: string, providerEventId: string, reason: string): Promise<void>;
  touchRecovery(id: string): Promise<void>;
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
       if (row) {
         // Internal marker lets the checkout service distinguish an insert from
         // the conflict row returned by the idempotency unique constraint.
         (row as LedgerPaymentAttempt & { __created?: boolean }).__created = true;
         return row;
       }
      const existing = await this.getByIdempotencyKey(input.idempotencyKey);
      if (!existing) throw new Error("Payment attempt was not created");
       (existing as LedgerPaymentAttempt & { __created?: boolean }).__created = false;
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
      for (const key of ["type", "providerIntentRef", "providerRef", "status", "amount", "amountMinor", "currency", "paymentMethodType", "methodRef", "failureCode"]) {
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
    async markEventIgnored(gatewayConfigId, providerEventId, reason) {
      await getClient().update(ledgerPaymentAttemptEvents).set({ processedAt: new Date(), error: reason })
        .where(and(eq(ledgerPaymentAttemptEvents.gatewayConfigId, gatewayConfigId),
          eq(ledgerPaymentAttemptEvents.providerEventId, providerEventId)));
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
      // A missing reference does not prove the provider never created a
      // chargeable intent (the process can die before saving its response).
      // Recovery must first recreate with the same provider idempotency key.
      void eaId;
    },
    async getReservedAmount(eaId) {
      const [row] = await getClient()
        .select({ total: sql<string>`COALESCE(SUM(${ledgerPaymentAttempts.amount}), 0)` })
        .from(ledgerPaymentAttempts)
        .where(and(
          eq(ledgerPaymentAttempts.ledgerEaId, eaId),
          sql`(${ledgerPaymentAttempts.status} IN ('created','requires_action','processing') OR (${ledgerPaymentAttempts.status} = 'succeeded' AND ${ledgerPaymentAttempts.ledgerPaymentId} IS NULL))`,
        ));
      return Number(row?.total ?? 0);
    },
    async getReservations(eaId) {
      return getClient().select().from(ledgerPaymentAttempts).where(and(
        eq(ledgerPaymentAttempts.ledgerEaId, eaId),
        sql`(${ledgerPaymentAttempts.status} IN ('created','requires_action','processing') OR (${ledgerPaymentAttempts.status} = 'succeeded' AND ${ledgerPaymentAttempts.ledgerPaymentId} IS NULL))`,
      ));
    },
    async listForRecovery(limit, olderThan) {
      return getClient().select().from(ledgerPaymentAttempts)
        .where(and(lt(ledgerPaymentAttempts.createdAt, olderThan), or(
          sql`${ledgerPaymentAttempts.status} IN ('created','requires_action','processing')`,
          and(eq(ledgerPaymentAttempts.status, "succeeded"), isNull(ledgerPaymentAttempts.ledgerPaymentId)),
          and(eq(ledgerPaymentAttempts.status, "succeeded"), eq(ledgerPaymentAttempts.saveMethod, true),
            sql`${ledgerPaymentAttempts.metadata}->>'methodSavedAt' IS NULL`),
        )))
        .orderBy(asc(ledgerPaymentAttempts.updatedAt), asc(ledgerPaymentAttempts.id)).limit(limit);
    },
    async listPendingEvents(limit) {
      return getClient().select().from(ledgerPaymentAttemptEvents)
        .where(and(isNull(ledgerPaymentAttemptEvents.processedAt), sql`${ledgerPaymentAttemptEvents.receivedAt} < now() - interval '1 minute'`))
        .orderBy(sql`CASE WHEN ${ledgerPaymentAttemptEvents.error} IS NULL THEN 0 ELSE 1 END`,
          asc(ledgerPaymentAttemptEvents.receivedAt), asc(ledgerPaymentAttemptEvents.id)).limit(limit);
    },
    async setDefaultIfAbsent(id, entityType, entityId, gatewayConfigId) {
      // Serialize default selection across separate attempts and processes.
      await getClient().execute(sql`SELECT pg_advisory_xact_lock(hashtext(${entityType + ":" + entityId + ":" + gatewayConfigId}))`);
      const [current] = await getClient().select({ id: ledgerPaymentMethods.id }).from(ledgerPaymentMethods)
        .where(and(eq(ledgerPaymentMethods.entityType, entityType), eq(ledgerPaymentMethods.entityId, entityId),
          eq(ledgerPaymentMethods.gatewayConfigId, gatewayConfigId), eq(ledgerPaymentMethods.isActive, true),
          eq(ledgerPaymentMethods.isDefault, true))).limit(1);
      if (!current) await getClient().update(ledgerPaymentMethods).set({ isDefault: true })
        .where(and(eq(ledgerPaymentMethods.id, id), eq(ledgerPaymentMethods.entityType, entityType),
          eq(ledgerPaymentMethods.entityId, entityId), eq(ledgerPaymentMethods.gatewayConfigId, gatewayConfigId)));
    },
    async markMethodSaved(id) {
      await getClient().update(ledgerPaymentAttempts)
        .set({ metadata: sql`COALESCE(${ledgerPaymentAttempts.metadata}, '{}'::jsonb) || jsonb_build_object('methodSavedAt', now()::text)` })
        .where(eq(ledgerPaymentAttempts.id, id));
    },
    async touchRecovery(id) {
      await getClient().update(ledgerPaymentAttempts).set({ updatedAt: new Date() })
        .where(eq(ledgerPaymentAttempts.id, id));
    },
  };
}