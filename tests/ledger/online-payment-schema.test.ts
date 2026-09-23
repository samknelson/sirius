import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { ledger, ledgerPaymentAttempts, ledgerPaymentAttemptEvents, ledgerPaymentMethods } from "@shared/schema";

describe("durable online payment compatibility", () => {
  it("allows new-method and employer attempts without inventing a legacy payer", () => {
    expect(ledgerPaymentAttempts.workerId.notNull).toBe(false);
    expect(ledgerPaymentAttempts.paymentMethodId.notNull).toBe(false);
    expect(ledgerPaymentAttempts.createdByUserId.notNull).toBe(false);
    expect(ledgerPaymentAttempts.createdAt.default).toBeUndefined();
    expect(ledgerPaymentAttempts.completedAt.default).toBeUndefined();
    expect(ledgerPaymentAttempts.accountId.notNull).toBe(true);
    expect(ledgerPaymentAttempts.gatewayConfigId.notNull).toBe(true);
    expect(ledgerPaymentAttempts.currency.notNull).toBe(true);
  });

  it("retains unknown events and deduplicates separately for each gateway", () => {
    expect(ledgerPaymentAttemptEvents.attemptId.notNull).toBe(false);
    expect(ledgerPaymentAttemptEvents.processedAt.default).toBeUndefined();
    const unique = getTableConfig(ledgerPaymentAttemptEvents).uniqueConstraints;
    expect(unique.find(c => c.name === "ledger_payment_attempt_events_provider_event_unique")?.columns.map(c => c.name))
      .toEqual(["gateway_config_id", "provider_event_id"]);
  });

  it("restricts history deletion and scopes saved provider identities", () => {
    const fk = getTableConfig(ledger).foreignKeys.find(f => f.reference().columns[0].name === "ea_id");
    expect(fk?.onDelete).toBe("restrict");
    const unique = getTableConfig(ledgerPaymentMethods).uniqueConstraints;
    expect(unique.find(c => c.name === "ledger_paymentmethods_gateway_provider_unique")?.columns.map(c => c.name))
      .toEqual(["gateway_config_id", "provider_method_ref"]);
  });

  it("migrates in place without reassigning identities or settling pending ACH", () => {
    const migration = readFileSync("scripts/migrate/core/1200_generalize_online_payments.ts", "utf8");
    expect(migration).not.toMatch(/DELETE FROM|TRUNCATE|SET status\s*=/i);
    expect(migration).toContain("FROM ledger_ea e WHERE e.id = a.ledger_ea_id");
    expect(migration).not.toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(readFileSync("scripts/migrate/core/1201_restore_payment_attempt_immediate_fk.ts", "utf8"))
      .toContain("NOT DEFERRABLE");
    expect(migration).toContain("r.n = 1");
    expect(migration).toContain("'online-card'");
    expect(migration).toContain("'online-bank-ach'");
    expect(migration).not.toMatch(/SET created_by_user_id|SET consent|SET processed_at/);
  });
});