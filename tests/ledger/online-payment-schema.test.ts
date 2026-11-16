import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { ledgerPayments, insertLedgerPaymentSchema } from "@shared/schema";
import { PRIVATE_PAYMENT_FIELDS, publicPayment, paymentLifecycleSchema } from "@shared/ledger/payment-lifecycle";

describe("payment-owned checkout contract", () => {
  it("enforces separate client and provider idempotency at the database boundary", () => {
    const config = getTableConfig(ledgerPayments);
    expect(config.uniqueConstraints.map(c => c.columns.map(x => x.name))).toContainEqual(["checkout_key"]);
    expect(config.uniqueConstraints.map(c => c.columns.map(x => x.name))).toContainEqual(["checkout_gateway_id", "checkout_provider_ref"]);
    for (const name of ["checkout_gateway_id", "checkout_method_id", "checkout_creator_id", "checkout_worker_id", "checkout_account_id"])
      expect(config.foreignKeys.find(f => f.reference().columns[0].name === name)?.onDelete).toBe("restrict");
  });
  it("strips private lifecycle data at runtime and excludes it from ordinary writes", () => {
    const row = Object.fromEntries(PRIVATE_PAYMENT_FIELDS.map(k => [k, "private"]));
    expect(publicPayment({ ...row, id: "payment", status: "draft" })).toEqual({ id: "payment", status: "draft" });
    for (const key of PRIVATE_PAYMENT_FIELDS) expect(insertLedgerPaymentSchema.shape).not.toHaveProperty(key);
  });
  it("rejects an event inbox or unknown lifecycle version", () => {
    const data = { version: 1, saveMethod: false, consent: null, statementSelection: [], metadata: {},
      reservationExpiresAt: null, completedAt: null, lastProviderEventCreated: null, failureMessage: null, failureCode: null };
    expect(paymentLifecycleSchema.safeParse(data).success).toBe(true);
    expect(paymentLifecycleSchema.safeParse({ ...data, events: [] }).success).toBe(false);
    expect(paymentLifecycleSchema.safeParse({ ...data, version: 2 }).success).toBe(false);
  });
});
