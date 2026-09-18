import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  ordinaryPaymentAttachmentError,
  validatePaymentAttachment,
} from "../../server/modules/ledger/payments";

describe("individual payment attachment server rules", () => {
  it("rejects attachmentFileId from ordinary create and update payloads", () => {
    expect(ordinaryPaymentAttachmentError({ amount: "10.00" })).toBeNull();
    expect(ordinaryPaymentAttachmentError({ attachmentFileId: "file-1" })).toContain(
      "attachment endpoint",
    );
    expect(ordinaryPaymentAttachmentError({ attachmentFileId: null })).toContain(
      "attachment endpoint",
    );
  });

  it.each([
    ["receipt.jpg", "image/jpeg"],
    ["receipt.jpeg", "image/jpeg"],
    ["receipt.png", "image/png"],
    ["receipt.gif", "image/gif"],
    ["receipt.webp", "image/webp"],
    ["receipt.bmp", "image/bmp"],
    ["receipt.tiff", "image/tiff"],
  ])("accepts raster image %s", (originalname, mimetype) => {
    expect(validatePaymentAttachment({ originalname, mimetype })).toBeNull();
  });

  it.each([
    ["receipt.pdf", "application/pdf"],
    ["receipt.svg", "image/svg+xml"],
    ["receipt.jpg", "image/png"],
    ["receipt.png", "image/jpeg"],
    ["receipt.exe", "image/jpeg"],
  ])("rejects unsupported or mismatched attachment %s", (originalname, mimetype) => {
    expect(validatePaymentAttachment({ originalname, mimetype })).toContain("Unsupported");
  });

  it("registers staff authorization before multipart parsing", () => {
    const source = readFileSync("server/modules/ledger/payments.ts", "utf8");
    const routeStart = source.indexOf('"/api/ledger/payments/:id/attachment"');
    const route = source.slice(routeStart, source.indexOf("// GET /api/ledger/payments/:id/transactions", routeStart));
    expect(route.indexOf('requireAccess("staff")')).toBeLessThan(
      route.indexOf("paymentAttachmentUploadMiddleware"),
    );
  });

  it("has explicit JSON handling for multipart size and parse failures", () => {
    const source = readFileSync("server/modules/ledger/payments.ts", "utf8");
    expect(source).toContain("LIMIT_FILE_SIZE");
    expect(source).toContain("Image attachment is too large");
    expect(source).toContain('res.status(400).json({ message: "Invalid image upload." })');
  });

  it("cleans replacement, removal, and deletion only through post-commit scheduling", () => {
    const source = readFileSync("server/modules/ledger/payments.ts", "utf8");
    expect(source).toContain("schedulePaymentAttachmentCleanup(replaced.oldFile)");
    expect(source).toContain("schedulePaymentAttachmentCleanup(file)");
    expect(source).toContain("schedulePaymentAttachmentCleanup");
    expect(source).toContain("runOutsideTransaction");
  });
});