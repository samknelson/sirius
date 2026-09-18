import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { ordinaryPaymentAttachmentError } from "../../server/modules/ledger/payments";
import { isExtensionAllowed } from "../../server/services/entity-files/config";

const read = (path: string) => readFileSync(path, "utf8");

describe("ledger payment Entity Files cutover", () => {
  it("rejects the retired attachment field from payment and batch writes", () => {
    expect(ordinaryPaymentAttachmentError({ amount: "10.00" })).toBeNull();
    expect(ordinaryPaymentAttachmentError({ attachmentFileId: "file-1" })).toContain(
      "retired",
    );

    const batchRoutes = read("server/modules/ledger/payment-batches.ts");
    expect(batchRoutes).toContain("attachmentFileId");
    expect(batchRoutes).toContain("use the Entity Files area for payment batch attachments");
  });

  it("registers payment and batch areas with staff and component gates", () => {
    const contexts = read("server/modules/entity-files-contexts.ts");
    for (const [id, label, recordLabel, component] of [
      ["ledger_payment", "Payments", "Payment", "ledger"],
      ["ledger_payment_batch", "Payment Batches", "Payment Batch", "ledger.payment.batch"],
    ]) {
      const start = contexts.indexOf(`id: "${id}"`);
      expect(start).toBeGreaterThanOrEqual(0);
      const area = contexts.slice(start, contexts.indexOf("});", start) + 3);
      expect(area).toContain(`label: "${label}"`);
      expect(area).toContain(`recordLabel: "${recordLabel}"`);
      expect(area).toContain(`component: "${component}"`);
      expect(area).toContain("...staffOnly()");
      expect(area).toContain("entityExists");
    }

    const tables = read("server/storage/entity-files-context-tables.ts");
    expect(tables).toContain("ledger_payment: ledgerPayments");
    expect(tables).toContain("ledger_payment_batch: ledgerPaymentBatches");
  });

  it("uses the generic 50MB upload policy and allows a configured 495KB JPEG", () => {
    const entityFiles = read("server/modules/entity-files.ts");
    expect(entityFiles).toContain("fileSize: 50 * 1024 * 1024");
    expect(50 * 1024 * 1024).toBeGreaterThan(495 * 1024);
    expect(isExtensionAllowed("receipt.jpg", ["jpg", "jpeg"])).toBe(true);
    expect(isExtensionAllowed("receipt.pdf", ["jpg", "jpeg"])).toBe(false);
  });

  it("links direct file reads to the registered context policy", () => {
    const access = read("server/services/entity-files/file-read-access.ts");
    expect(access).toContain('getEntityFileContext(contextId)');
    expect(access).toContain('context.checkPolicyAccess("view", entityId, ctx)');

    const files = read("server/modules/files.ts");
    expect(files).toContain('const prefix = "entity-files:"');
  });

  it("owns payment cleanup through after-commit deletion events", () => {
    const events = read("server/services/event-bus.ts");
    expect(events).toContain("LEDGER_PAYMENT_DELETE_AFTER");
    expect(events).toContain("LEDGER_PAYMENT_BATCH_DELETE_AFTER");

    const storage = read("server/storage/ledger.ts");
    expect(storage).toContain("EventType.LEDGER_PAYMENT_DELETE_AFTER");
    expect(storage).toContain("EventType.LEDGER_PAYMENT_BATCH_DELETE_AFTER");
    expect(storage).toContain("onAfterCommit");

    const cleanup = read("server/services/entity-files/delete-cleanup.ts");
    expect(cleanup).toContain('contextId: "ledger_payment"');
    expect(cleanup).toContain('contextId: "ledger_payment_batch"');
    expect(cleanup).toContain("deleteFilesForRecord");
  });
});