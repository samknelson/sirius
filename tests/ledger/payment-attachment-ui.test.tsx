import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Entity Files payment attachment surfaces", () => {
  const paymentForm = source("client/src/components/ledger/PaymentForm.tsx");
  const paymentView = source("client/src/pages/payment-view.tsx");
  const entityFileManager = source("client/src/components/entity-files/EntityFileManager.tsx");
  const batchEdit = source("client/src/pages/ledger/payment-batch-edit.tsx");
  const batchDetails = source("client/src/pages/ledger/payment-batch-details.tsx");

  it("uses the shared manager on staff payment edit and view surfaces", () => {
    expect(paymentForm).toContain("EntityFileManager");
    expect(paymentForm).toContain("ImageAttachmentPreview");
    expect(paymentForm).toContain("uploadEntityFile");
    expect(paymentForm).toContain('context="ledger_payment"');
    expect(paymentForm).toContain('context: "ledger_payment"');
    expect(paymentForm).toContain("Retry attachment");
    expect(paymentView).toContain('import { EntityFileManager } from "@/components/entity-files/EntityFileManager";');
    expect(paymentView).toContain('context="ledger_payment"');
  });

  it("uses the shared manager on payment batch edit and details surfaces", () => {
    expect(batchEdit).toContain('import { EntityFileManager } from "@/components/entity-files/EntityFileManager";');
    expect(batchEdit).toContain('context="ledger_payment_batch"');
    expect(batchDetails).toContain('import { EntityFileManager } from "@/components/entity-files/EntityFileManager";');
    expect(batchDetails).toContain('context="ledger_payment_batch"');
  });

  it("has no retired single-attachment UI or endpoint references", () => {
    for (const file of [paymentForm, paymentView, batchEdit, batchDetails]) {
      expect(file).not.toContain("attachmentFileId");
      expect(file).not.toContain("/attachment");
      expect(file).not.toContain("private");
    }
  });

  it("does not add worker-facing file controls", () => {
    for (const file of [paymentForm, paymentView, batchEdit, batchDetails]) {
      expect(file).not.toContain('context="worker"');
      expect(file).not.toContain("worker-facing");
    }
  });

  it("offers collapsed previews only for saved image attachments", () => {
    expect(entityFileManager).toContain('mimeType?.toLowerCase().startsWith("image/")');
    expect(entityFileManager).toContain("aria-expanded={expanded}");
    expect(entityFileManager).toContain("Close preview");
    expect(entityFileManager).toContain("Image preview could not be loaded");
    expect(entityFileManager).toContain("URL.revokeObjectURL(objectUrl)");
  });
});