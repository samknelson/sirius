import { beforeEach, describe, expect, it, vi } from "vitest";
import { ledgerPaymentAttempts } from "@shared/schema";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  values: undefined as any,
  updates: undefined as any,
  rows: [] as any[],
  where: undefined as any,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({
    select: () => ({ from: () => ({ where: async (where: unknown) => { state.where = where; return state.rows; } }) }),
    insert: () => ({
      values: (values: unknown) => {
        state.values = values;
        return { onConflictDoNothing: () => ({ returning: async () => [{ id: "new", ...values as object }] }) };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        state.updates = values;
        return { where: () => ({ returning: async () => [{ id: "existing", ...values as object }] }) };
      },
    }),
  }),
}));
import { createPaymentAttemptStorage } from "../../server/storage/ledger/payment_attempts";

describe("online payment storage boundaries", () => {
  beforeEach(() => {
    state.rows = [];
    state.values = undefined;
    state.updates = undefined;
  });

  it("derives account/entity snapshots and refuses mismatched caller context", async () => {
    state.rows = [{ id: "ea", accountId: "account", entityType: "employer", entityId: "employer" }];
    const storage = createPaymentAttemptStorage();
    const input = { ledgerEaId: "ea", gatewayConfigId: "gateway", idempotencyKey: "key", amount: "10.00" };
    await storage.create(input);
    expect(state.values).toMatchObject({ accountId: "account", entityType: "employer", entityId: "employer" });
    expect(state.values.createdByUserId).toBeUndefined();
    expect(state.values.consent).toBeUndefined();
    await expect(storage.create({ ...input, accountId: "other" })).rejects.toThrow("context does not match");
  });

  it("refuses runtime mutation of immutable financial context", async () => {
    await createPaymentAttemptStorage().updateStatus("attempt", "processing", {
      amount: "999", currency: "EUR", gatewayConfigId: "other", providerIntentRef: "pi",
      statementSelection: [{ invoiceNumber: "OTHER", amount: "999" }],
      metadata: { invoicePeriods: [] }, consent: { text: "Changed" },
    } as Partial<typeof ledgerPaymentAttempts.$inferSelect>);
    expect(state.updates).toMatchObject({ status: "processing", providerIntentRef: "pi" });
    expect(state.updates).not.toHaveProperty("statementSelection");
    expect(state.updates).not.toHaveProperty("metadata");
    expect(state.updates).not.toHaveProperty("consent");
    expect(state.updates).not.toHaveProperty("amount");
    expect(state.updates).not.toHaveProperty("currency");
    expect(state.updates).not.toHaveProperty("gatewayConfigId");
  });

  it("retains unknown events without storing sensitive provider objects", async () => {
    await createPaymentAttemptStorage().recordEvent({
      gatewayConfigId: "gateway", attemptId: null, providerEventId: "evt", eventType: "unknown",
      payload: { providerRef: "pi", amountMinor: 1000, currency: "usd", billing_details: { email: "private" }, client_secret: "secret" },
    });
    expect(state.values).toMatchObject({ gatewayConfigId: "gateway", attemptId: null });
    expect(state.values.payload).toEqual({ providerRef: "pi", amountMinor: 1000, currency: "usd" });
    expect(state.values.processedAt).toBeUndefined();
  });

  it("keeps failed event processing retryable instead of marking it complete", async () => {
    const storage = createPaymentAttemptStorage();
    await storage.completeEvent("gateway", "event", "Posting failed");
    expect(state.updates).toEqual({ error: "Posting failed" });
    await storage.completeEvent("gateway", "event");
    expect(state.updates).toMatchObject({ error: null, processedAt: expect.any(Date) });
  });

  it("reserves both active attempts and succeeded attempts awaiting ledger posting", async () => {
    const storage = createPaymentAttemptStorage();
    state.rows = [{ id: "pending", amount: "267.35", statementSelection: [{ invoiceNumber: "COBRA", amount: "267.35" }] }];
    expect(await storage.getReservations("ea")).toEqual(state.rows);
    const query = new PgDialect().sqlToQuery(state.where);
    expect(query.sql).toContain("'created','requires_action','processing'");
    expect(query.sql).toContain("'succeeded'");
    expect(query.sql).toContain("IS NULL");
    expect(query.params).toContain("ea");
    state.rows = [{ total: "267.35" }];
    expect(await storage.getReservedAmount("ea")).toBe(267.35);
    expect(new PgDialect().sqlToQuery(state.where)).toEqual(query);
  });
});