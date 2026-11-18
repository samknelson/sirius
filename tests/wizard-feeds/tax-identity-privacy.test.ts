import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  storageLogger: { ...logs, warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: { recordMutation: vi.fn(), recordDeletion: vi.fn(), recordSubrecordTouch: vi.fn() },
}));
import { contacts, workers } from "../../shared/schema";
import { ALTERNATE_TAX_ID } from "../../shared/utils/worker-tax-identity";
import { db } from "../../server/storage/db";
import { ensureAlternateTaxIdType } from "../../server/storage/workers/tax-identity";
import { createWorkerIdStorage, workerIdLoggingConfig } from "../../server/storage/workers/ids";
import { withStorageLogging } from "../../server/storage/middleware/logging";
import { redactSensitiveData } from "../../server/utils/response-redaction";
import { mappedSpreadsheetRows } from "../../server/plugins/wizards/engine/spreadsheet-tax-text";
import * as XLSX from "xlsx";
const canary = `T${randomUUID()}`, secondCanary = `T${randomUUID()}`;
let contactId: string, workerId: string;
beforeAll(async () => {
  await ensureAlternateTaxIdType();
  const [contact] = await db.insert(contacts).values({ displayName: "Tax identity privacy test" }).returning();
  contactId = contact.id;
  const [worker] = await db.insert(workers).values({ contactId }).returning();
  workerId = worker.id;
});
afterAll(async () => { if (contactId) await db.delete(contacts).where(eq(contacts.id, contactId)); });

describe("sensitive alternate-ID boundaries", () => {
  it("does not persist canaries in audit args, snapshots, descriptions or failures", async () => {
    const storage = withStorageLogging(createWorkerIdStorage(), workerIdLoggingConfig);
    const id = await storage.createWorkerId({ workerId, typeId: ALTERNATE_TAX_ID, value: canary });
    await expect(storage.createWorkerId({ workerId, typeId: ALTERNATE_TAX_ID, value: canary })).rejects.toThrow();
    await storage.updateWorkerId(id.id, { value: secondCanary });
    await storage.deleteWorkerId(id.id);
    await vi.waitFor(() => expect(logs.info.mock.calls.length + logs.error.mock.calls.length).toBeGreaterThanOrEqual(4));
    const serialized = JSON.stringify([logs.info.mock.calls, logs.error.mock.calls]);
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(secondCanary);
    expect(serialized).toContain("[REDACTED]");
  });
  it("masks generic value fields in response previews without mutating the staff response", () => {
    const source = { records: [{ typeId: ALTERNATE_TAX_ID, value: canary }, { typeId: "ordinary", value: "payroll-123" }], ssn: "123456789" };
    const preview = redactSensitiveData(source);
    expect(JSON.stringify(preview)).not.toContain(canary);
    expect(JSON.stringify(preview)).not.toContain("123456789");
    expect(preview.records[1].value).toBe("payroll-123");
    expect(source.records[0].value).toBe(canary);
  });
  it("preserves spreadsheet identifier text without changing numeric hours", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["SSN", "Hours"], [123456, 10]]);
    sheet.A2.z = "000000000";
    delete sheet.A2.w;
    const rows = mappedSpreadsheetRows(sheet, { col_0: "ssn", col_1: "numberOfHours" });
    expect(rows[1]).toEqual(["000123456", 10]);
  });
});
