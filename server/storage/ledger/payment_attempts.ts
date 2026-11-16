import { randomUUID } from "node:crypto";
import { and, eq, sql, asc, lt, isNotNull } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";
import { ledgerPayments, ledgerEa, ledgerAccounts, ledgerPaymentMethods, optionsLedgerPaymentType } from "@shared/schema";
import { checkoutStateSchema, paymentLifecycleSchema, type CheckoutPayment, type CreateCheckoutPayment } from "@shared/ledger/payment-lifecycle";
import { shouldApplyPaymentEvent, selectFinancialPaymentType } from "../../modules/ledger/payment-attempt-state";

type Update = Partial<Pick<CheckoutPayment, "providerIntentRef" | "lastProviderEventCreated" | "failureMessage" | "failureCode" | "reservationExpiresAt" | "completedAt">>;
const p = ledgerPayments;
const pending = sql`(${p.checkoutState} IN ('created','requires_action','processing') OR (${p.checkoutState} = 'succeeded' AND ${p.status} <> 'cleared'))`;
const date = (value: string | null) => value === null ? null : new Date(value);

async function project(row: typeof p.$inferSelect): Promise<CheckoutPayment> {
  const data = paymentLifecycleSchema.parse(row.checkoutData);
  const [ea] = await getClient().select().from(ledgerEa).where(eq(ledgerEa.id, row.ledgerEaId));
  if (!ea || ea.accountId !== row.checkoutAccountId) throw new Error("Checkout ownership is inconsistent");
  if (!row.checkoutGatewayId || !row.checkoutKey || !row.checkoutCurrency) throw new Error("Checkout identity is incomplete");
  return {
    id: row.id, ledgerEaId: row.ledgerEaId, accountId: ea.accountId,
    entityType: ea.entityType, entityId: ea.entityId, workerId: row.checkoutWorkerId,
    gatewayConfigId: row.checkoutGatewayId, createdByUserId: row.checkoutCreatorId,
    paymentMethodId: row.checkoutMethodId, idempotencyKey: row.checkoutKey,
    providerIntentRef: row.checkoutProviderRef, amount: row.amount, currency: row.checkoutCurrency,
    status: checkoutStateSchema.parse(row.checkoutState),
    ...data, consent: data.consent ?? null, createdAt: row.checkoutCreatedAt, updatedAt: row.checkoutUpdatedAt,
    completedAt: date(data.completedAt), reservationExpiresAt: date(data.reservationExpiresAt),
    ledgerPaymentId: row.dateReceived ? row.id : null,
  };
}

/**
 * All methods operate on ledger_payments. Kept behind the existing service
 * interface while old checkout URLs remain supported; there is no attempt row.
 */
export function createPaymentAttemptStorage() {
  return {
    async get(id: string): Promise<CheckoutPayment | undefined> {
      const [row] = await getClient().select().from(p).where(and(eq(p.id, id), isNotNull(p.checkoutState)));
      return row ? project(row) : undefined;
    },
    async getByIdempotencyKey(key: string): Promise<CheckoutPayment | undefined> {
      const [row] = await getClient().select().from(p).where(eq(p.checkoutKey, key));
      return row ? project(row) : undefined;
    },
    async getByProviderIntent(ref: string, gatewayConfigId?: string): Promise<CheckoutPayment | undefined> {
      if (!gatewayConfigId) throw new Error("Gateway is required for payment lookup");
      const [row] = await getClient().select().from(p).where(and(eq(p.checkoutProviderRef, ref), eq(p.checkoutGatewayId, gatewayConfigId)));
      return row ? project(row) : undefined;
    },
    async create(input: CreateCheckoutPayment): Promise<CheckoutPayment> {
      if (!/^\d+(?:\.\d{1,2})?$/.test(input.amount) || Number(input.amount) <= 0 ||
          !Number.isSafeInteger(Math.round(Number(input.amount) * 100)))
        throw new Error("Checkout amount is invalid");
      const [ea] = await getClient().select().from(ledgerEa).where(eq(ledgerEa.id, input.ledgerEaId));
      if (!ea || (input.accountId !== undefined && input.accountId !== ea.accountId) ||
          (input.entityType !== undefined && input.entityType !== ea.entityType) ||
          (input.entityId !== undefined && input.entityId !== ea.entityId))
        throw new Error("Checkout does not match its entity account");
      const [account] = await getClient().select().from(ledgerAccounts).where(eq(ledgerAccounts.id, ea.accountId));
      if (!account || account.currencyCode !== input.currency) throw new Error("Checkout currency does not match account");
      const types = await getClient().select().from(optionsLedgerPaymentType).for("share");
      const paymentType = selectFinancialPaymentType(types, input.currency);
      if (!paymentType) throw new Error("No compatible financial payment type is configured");
      const id = randomUUID();
      const now = new Date();
      const data = paymentLifecycleSchema.parse({
        version: 1, saveMethod: input.saveMethod ?? false, consent: input.consent ?? null,
        statementSelection: input.statementSelection ?? [], metadata: {
          ...(input.metadata as Record<string, unknown> ?? {}), ledgerPaymentTypeId: paymentType.id,
        },
        reservationExpiresAt: input.reservationExpiresAt?.toISOString() ?? null,
        completedAt: null, lastProviderEventCreated: null,
        failureMessage: null, failureCode: input.failureCode ?? "creation_not_started",
      });
      const [row] = await getClient().insert(p).values({
        id, status: "draft", amount: input.amount, paymentType: paymentType.id, ledgerEaId: ea.id,
        dateReceived: null, dateCleared: null, allocated: false, memo: "Online payment",
        details: { paymentAttemptId: id },
        checkoutState: checkoutStateSchema.parse(input.status ?? "created"),
        checkoutKey: input.idempotencyKey, checkoutProviderRef: null,
        checkoutGatewayId: input.gatewayConfigId, checkoutAccountId: ea.accountId,
        checkoutWorkerId: ea.entityType === "worker" ? ea.entityId : null,
        checkoutCreatorId: input.createdByUserId ?? null, checkoutMethodId: input.paymentMethodId ?? null,
        checkoutCurrency: input.currency, checkoutData: data, checkoutCreatedAt: now, checkoutUpdatedAt: now,
      }).onConflictDoNothing({ target: p.checkoutKey }).returning();
      const result = row ? await project(row) : await this.getByIdempotencyKey(input.idempotencyKey);
      if (!result) throw new Error("Checkout could not be created");
      Object.assign(result, { __created: !!row });
      return result;
    },
    async updateStatus(id: string, status: string, fields: Update = {}): Promise<CheckoutPayment | undefined> {
      return runInTransaction(async () => {
        const [row] = await getClient().select().from(p).where(eq(p.id, id)).for("update");
        if (!row?.checkoutState) return undefined;
        const next = checkoutStateSchema.parse(status);
        const data = paymentLifecycleSchema.parse(row.checkoutData);
        if (!shouldApplyPaymentEvent(row.checkoutState, data.lastProviderEventCreated, next, fields.lastProviderEventCreated)) return undefined;
        if (fields.providerIntentRef && row.checkoutProviderRef && fields.providerIntentRef !== row.checkoutProviderRef)
          throw new Error("Payment reference mismatch");
        const nextData = paymentLifecycleSchema.parse({
          ...data,
          ...Object.fromEntries(["lastProviderEventCreated", "failureMessage", "failureCode"].filter(k => fields[k as keyof Update] !== undefined).map(k => [k, fields[k as keyof Update]])),
          ...(fields.reservationExpiresAt !== undefined ? { reservationExpiresAt: fields.reservationExpiresAt?.toISOString() ?? null } : {}),
          ...(["succeeded", "failed", "canceled", "expired"].includes(next) ? { completedAt: data.completedAt ?? new Date().toISOString() } : {}),
        });
        const [updated] = await getClient().update(p).set({
          checkoutState: next, checkoutData: nextData, checkoutUpdatedAt: new Date(),
          ...(fields.providerIntentRef ? { checkoutProviderRef: fields.providerIntentRef } : {}),
          ...(row.status === "draft" && ["failed", "canceled", "expired"].includes(next) ? { status: next === "failed" ? "error" as const : "canceled" as const } : {}),
        }).where(eq(p.id, id)).returning();
        return project(updated);
      });
    },
    async receive(id: string, status: "pending" | "cleared", details: unknown): Promise<void> {
      await getClient().update(p).set({
        status, details, dateReceived: sql`COALESCE(${p.dateReceived}, now())`,
        ...(status === "cleared" ? { dateCleared: sql`COALESCE(${p.dateCleared}, now())` } : {}),
      }).where(and(eq(p.id, id), isNotNull(p.checkoutState)));
    },
    async lockEa(id: string): Promise<void> {
      await getClient().execute(sql`SELECT id FROM ${ledgerEa} WHERE id = ${id} FOR UPDATE`);
    },
    async lockAttempt(id: string): Promise<void> {
      await getClient().execute(sql`SELECT id FROM ${p} WHERE id = ${id} FOR UPDATE`);
    },
    async expireReservations(_eaId: string): Promise<void> { /* Only provider-confirmed cancellation releases a reservation. */ },
    async getReservedAmount(eaId: string): Promise<number> {
      const [row] = await getClient().select({ total: sql<string>`COALESCE(SUM(${p.amount}), 0)` })
        .from(p).where(and(eq(p.ledgerEaId, eaId), pending));
      return Number(row.total);
    },
    async getReservations(eaId: string): Promise<CheckoutPayment[]> {
      const rows = await getClient().select().from(p).where(and(eq(p.ledgerEaId, eaId), pending));
      return Promise.all(rows.map(project));
    },
    async listForRecovery(limit: number, olderThan: Date): Promise<CheckoutPayment[]> {
      const rows = await getClient().select().from(p).where(and(
        lt(p.checkoutCreatedAt, olderThan),
        sql`(${pending} OR (${p.checkoutState} = 'succeeded' AND ${p.checkoutData}->>'saveMethod' = 'true'
          AND ${p.checkoutData}->'metadata'->>'methodSavedAt' IS NULL))`,
      )).orderBy(asc(p.checkoutUpdatedAt), asc(p.id)).limit(limit);
      return Promise.all(rows.map(project));
    },
    async setDefaultIfAbsent(id: string, entityType: string, entityId: string, gatewayConfigId: string): Promise<void> {
      await getClient().execute(sql`SELECT pg_advisory_xact_lock(hashtext(${entityType + ":" + entityId + ":" + gatewayConfigId}))`);
      const [current] = await getClient().select({ id: ledgerPaymentMethods.id }).from(ledgerPaymentMethods)
        .where(and(eq(ledgerPaymentMethods.entityType, entityType), eq(ledgerPaymentMethods.entityId, entityId),
          eq(ledgerPaymentMethods.gatewayConfigId, gatewayConfigId), eq(ledgerPaymentMethods.isActive, true),
          eq(ledgerPaymentMethods.isDefault, true))).limit(1);
      if (!current) await getClient().update(ledgerPaymentMethods).set({ isDefault: true }).where(eq(ledgerPaymentMethods.id, id));
    },
    async markMethodSaved(id: string): Promise<void> {
      await getClient().update(p).set({
        checkoutData: sql`jsonb_set(${p.checkoutData}, '{metadata,methodSavedAt}', to_jsonb(now()::text))`,
      }).where(eq(p.id, id));
    },
    async touchRecovery(id: string): Promise<void> {
      await getClient().update(p).set({ checkoutUpdatedAt: new Date() }).where(eq(p.id, id));
    },
  };
}
export type PaymentAttemptStorage = ReturnType<typeof createPaymentAttemptStorage>;
