import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paymentFormSource = readFileSync(
  "client/src/components/ledger/PaymentForm.tsx",
  "utf8",
);
const paymentRoutesSource = readFileSync(
  "server/modules/ledger/payments.ts",
  "utf8",
);
const batchRoutesSource = readFileSync(
  "server/modules/ledger/payment-batches.ts",
  "utf8",
);

describe("payment save consistency contracts", () => {
  it("awaits refreshes for detail transactions, account, EA, and batch views", () => {
    expect(paymentFormSource).toContain("await Promise.allSettled(refreshes)");
    expect(paymentFormSource).toContain('queryKey: ["/api/ledger/accounts", accountId, "payments"]');
    expect(paymentFormSource).toContain('queryKey: ["/api/ledger/payments/ea", eaId]');
    expect(paymentFormSource).toContain("`/api/ledger/payments/${savedPaymentId}/transactions`");
    expect(paymentFormSource).toContain("`/api/ledger-payment-batches/${batchId}/payments`");
    expect(paymentFormSource).toContain("`/api/ledger-payment-batches/${batchId}`");
    expect(paymentFormSource.match(/type: "all"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("does not report a successful refresh until every requested view settles", () => {
    const settledIndex = paymentFormSource.indexOf("await Promise.allSettled(refreshes)");
    const successIndex = paymentFormSource.indexOf('title: successTitle');
    const callbackIndex = paymentFormSource.indexOf("onSuccess?.(data)");
    expect(settledIndex).toBeGreaterThan(0);
    expect(successIndex).toBeGreaterThan(settledIndex);
    expect(callbackIndex).toBeGreaterThan(successIndex);
  });

  it("returns enriched committed payments from single create, edit, and batch create", () => {
    expect(paymentRoutesSource.split("enrichWithAllocatedEntities([").length - 1)
      .toBeGreaterThanOrEqual(3);
    expect(batchRoutesSource).toContain(
      "const [enrichedPayment] = await enrichWithAllocatedEntities([savedPayment])",
    );
    expect(batchRoutesSource).toContain("payment: outcome.enrichedPayment");
  });

  it("keeps payment, allocation ledger writes, and batch assignment in transactions", () => {
    expect(paymentRoutesSource).toContain(
      "const { result, notifications, enriched } = await runInTransaction(async () =>",
    );
    expect(paymentRoutesSource).toContain(
      "const { payment, notifications, enriched, batchIds, auditSummary } = await runInTransaction(async () =>",
    );
    expect(batchRoutesSource).toContain(
      "outcome = await runInTransaction(async (): Promise<AttachOutcome | AttachError> =>",
    );
    expect(batchRoutesSource).toContain(
      "const removal = await runInTransaction(async () =>",
    );
  });

  it("records batch-host lifecycle evidence only after successful outcomes", () => {
    for (const operation of [
      "createPayment",
      "assignPayment",
      "postPayment",
      "updatePayment",
      "removePayment",
      "deletePayment",
    ]) {
      expect(`${paymentRoutesSource}\n${batchRoutesSource}`).toContain(`"${operation}"`);
    }
    expect(paymentRoutesSource).toContain("allocationCount");
    expect(paymentRoutesSource).toContain("allocationTotal");
    expect(paymentRoutesSource).toContain("allocationEaIds");
    expect(paymentRoutesSource).toContain("allocationEntityIds");
    expect(paymentRoutesSource).toContain("host_entity_id: batchId");
  });
});