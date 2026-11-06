import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { stringify } from "csv-stringify/sync";

const uploads = vi.hoisted(() => new Map<string, any>());
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  storageLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Only the attachment bytes are in memory; processing, hours, DC, history,
// transactions and event delivery all use their production implementations.
vi.mock("../../server/plugins/wizards/attachments", async original => ({
  ...await original<any>(),
  getWizardAttachment: async (id: string) => uploads.get(id),
  downloadWizardAttachment: async (id: string) => uploads.get(id).bytes,
  createWizardAttachment: async (input: any) => {
    const file = { ...input, id: randomUUID() }; uploads.set(file.id, file); return file;
  },
}));
import { db, databaseSourceInfo } from "../../server/storage/db";
import { storage } from "../../server/storage";
import * as schema from "@shared/schema";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
import { updateComponentCache } from "../../server/services/component-cache";
import {
  initDcGrantReconciliation, stopDcGrantReconciliation, reconcileDcGrantForWorkerMonth,
} from "../../server/services/sitespecific/bao/dc-grant";
import { summarizeDcGrantActivity } from "@shared/sitespecific/bao/dc-reporting";

describe.skipIf(String(databaseSourceInfo.source) !== "isolated-test").sequential("BAO corrections through full monthly feed and hours listener", () => {
  let employerId: string, otherEmployerId: string, activeId: string, fmlaId: string;
  let fund: { employerId: string; employmentStatusId: string };
  const fields = ["ssn", "firstName", "lastName", "dateOfBirth", "employmentStatus", "numberOfHours",
    "phoneNumber", "addressLine1", "city", "state", "postalCode"];
  let serial = 0;
  beforeAll(async () => {
    await updateComponentCache("sitespecific.bao", true);
    [employerId, otherEmployerId] = (await db.insert(schema.employers).values([
      { name: "Correction employer" }, { name: "Other qualifying employer" },
    ]).returning()).map(e => e.id);
    [activeId, fmlaId] = (await db.insert(schema.optionsEmploymentStatus).values([
      { name: "Active", code: "active", employed: true },
      { name: "FMLA", code: "fmla", employed: false },
    ]).returning()).map(s => s.id);
    await db.insert(schema.optionsWorkerWs).values([{ name: "Active" }, { name: "FMLA" }]);
    fund = await storage.baoDisabilityCredit.ensureDcFundIdentities();
    initDcGrantReconciliation();
  });
  afterAll(() => stopDcGrantReconciliation());

  async function fixture(initialHours = 40) {
    const worker = await storage.workers.createWorker("Correction Fixture");
    const ssn = `790110${String(++serial).padStart(3, "0")}`;
    await storage.workers.updateWorkerSSN(worker.id, ssn);
    const [theCase] = await db.insert(schema.sitespecificBaoDcCases).values({
      workerId: worker.id, status: "approved", openedYmd: "2020-01-01",
      qualifyingBasis: { asOfYmd: "2020-01-01", conditions: ["staff_exception"], exceptionReason: "Fixture" },
    }).returning();
    const [month] = await db.insert(schema.sitespecificBaoDcCaseMonths).values({
      caseId: theCase.id, workerId: worker.id, workMonthYmd: "2020-02-01", status: "selected",
      data: { threshold: 120, coverageMonthYmd: "2020-05-01", lagMonths: 3 },
    }).returning();
    await storage.workerHours.upsertWorkerHours({
      workerId: worker.id, employerId: fund.employerId, employmentStatusId: fund.employmentStatusId,
      year: 2020, month: 2, day: 1, hours: initialHours,
    });
    await storage.baoDisabilityCredit.applyMonthGrantTransition(month.id, {
      status: "granted", data: { grantedHours: initialHours },
      event: { type: "case_month_granted", dedupeKey: `case_month_granted:${month.id}`, payload: { grantedHours: initialHours } },
    });
    const fileId = randomUUID();
    const wizard = await storage.wizards.create({
      type: "bao_monthly_hours", entityId: employerId, currentStep: "process", status: "draft",
      data: { uploadedFileId: fileId, hasHeaders: true, mode: "update", launchArguments: { year: 2020, month: 2 },
        columnMapping: Object.fromEntries(fields.map((field, i) => [field, `col_${i}`])),
        validationResults: { totalRows: 1, validRows: 1, invalidRows: 0 } },
    });
    const hours = async () => (await storage.baoDisabilityCredit.getHoursRowsForWorkerEmployerMonth(
      worker.id, fund.employerId, 2020, 2,
    )).reduce((sum, h) => sum + (h.hours ?? 0), 0);
    const events = () => storage.baoDisabilityCredit.listEventsForCase(theCase.id);
    async function correct(reported: number, expected: number) {
      // Uploaded files are immutable and parsing is cached by file ID. A
      // correction replaces the attachment on the SAME employer/period wizard.
      const correctionFileId = randomUUID();
      const current = await storage.wizards.getById(wizard.id);
      await storage.wizards.update(wizard.id, {
        data: { ...(current!.data as Record<string, unknown>), uploadedFileId: correctionFileId },
      });
      uploads.set(correctionFileId, { id: correctionFileId, mimeType: "text/csv", fileName: "correction.csv",
        bytes: Buffer.from(stringify([fields, [ssn, "Correction", "Fixture", "1985-06-08", "Active",
          reported, "5550100", "1 Test Street", "Test City", "MN", "55401"]])) });
      const result = await baoMonthlyHours.processFeedData(wizard.id);
      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(1);
      expect(result.rowResults?.[0].hasIssues).not.toBe(true);
      await vi.waitFor(async () => expect(await hours()).toBe(expected), { timeout: 5000 });
      // Acquire the same lock as the detached listener to observe committed
      // month state/history rather than just its in-flight hours write.
      await storage.baoDisabilityCredit.withWorkerSerialization(worker.id, async () => {});
    }
    return { worker, theCase, month, correct, hours, events };
  }

  it("increases a still-granted month, removes obsolete rows, aggregates FMLA, and excludes Fund hours", async () => {
    const f = await fixture();
    await db.insert(schema.workerHours).values([
      { workerId: f.worker.id, employerId, employmentStatusId: fmlaId, year: 2020, month: 2, day: 15, hours: 25 },
      { workerId: f.worker.id, employerId: otherEmployerId, employmentStatusId: fmlaId, year: 2020, month: 2, day: 1, hours: 10 },
      { workerId: f.worker.id, employerId: otherEmployerId, employmentStatusId: activeId, year: 2020, month: 2, day: 2, hours: 5 },
      // Even a legacy Fund row mislabeled employed must not count toward
      // qualifying hours, and reconciliation must remove duplicate DC rows.
      { workerId: f.worker.id, employerId: fund.employerId, employmentStatusId: activeId, year: 2020, month: 2, day: 3, hours: 999 },
    ]);
    await f.correct(80, 25); // stale employer day-15 FMLA row is deleted
    await f.correct(40, 65); // 40 + 10 FMLA + 5 active + 65 DC = 120
    const rows = await storage.workerHours.getWorkerHoursForMonth(f.worker.id, employerId, 2020, 2);
    expect(rows).toHaveLength(1);
    const count = (await f.events()).length;
    await f.correct(40, 65);
    expect(await f.events()).toHaveLength(count);
    expect((await storage.baoDisabilityCredit.getMonthById(f.month.id))?.data).toMatchObject({ threshold: 120 });
    await expect(baoMonthlyHours.processFeedData((await storage.wizards.create({
      type: "bao_monthly_hours", entityId: fund.employerId, status: "draft", currentStep: "process",
    })).id)).rejects.toThrow("fund attribution");
  });

  it("restores threshold removals through repeated retroactive corrections, with truthful net history", async () => {
    const f = await fixture();
    await f.correct(120, 0);
    await f.correct(80, 40);
    await f.correct(120, 0);
    await f.correct(80, 40); // same target in a distinct correction cycle
    await f.correct(121, 0);
    await f.correct(120, 0); // a downward correction to the exact threshold still needs no DC
    await f.correct(121, 0);
    const events = await f.events();
    const changes = events.filter(e => e.eventType === "case_month_reconciled");
    expect(changes).toHaveLength(5);
    expect(new Set(changes.map(e => e.dedupeKey)).size).toBe(5);
    expect(summarizeDcGrantActivity(events)).toEqual([
      { workMonthYmd: "2020-02-01", grants: 3, removals: 3, net: 0 },
    ]);
  });

  it("restores an approval-time no-shortfall removal only with its saved threshold and typed evidence", async () => {
    const f = await fixture();
    await db.delete(schema.workerHours).where(and(
      eq(schema.workerHours.workerId, f.worker.id), eq(schema.workerHours.employerId, fund.employerId),
    ));
    await storage.baoDisabilityCredit.applyMonthGrantTransition(f.month.id, {
      status: "removed",
      voidReason: "No shortfall — qualifying employer hours already meet the continuation threshold",
      data: { grantedHours: 0 },
      event: { type: "case_month_voided", dedupeKey: `case_month_voided:${f.month.id}:no_shortfall`,
        payload: { reason: "no_shortfall", threshold: 120 } },
    });
    await f.correct(120, 0);
    await f.correct(25, 95);
    expect((await storage.baoDisabilityCredit.getMonthById(f.month.id))?.voidReason).toBeNull();
  });

  it("refuses restoration without a valid saved threshold or matching removal evidence", async () => {
    const f = await fixture();
    await f.correct(120, 0);
    const saved = await storage.baoDisabilityCredit.getMonthById(f.month.id);
    await db.update(schema.sitespecificBaoDcCaseMonths).set({
      data: { ...(saved!.data as Record<string, unknown>), threshold: null },
    }).where(eq(schema.sitespecificBaoDcCaseMonths.id, f.month.id));
    await f.correct(80, 0);
    expect((await reconcileDcGrantForWorkerMonth(f.worker.id, "2020-02-01")).action).toBe("unchanged");
    await db.update(schema.sitespecificBaoDcCaseMonths).set({ data: saved!.data })
      .where(eq(schema.sitespecificBaoDcCaseMonths.id, f.month.id));
    await db.delete(schema.sitespecificBaoDcEvents).where(and(
      eq(schema.sitespecificBaoDcEvents.caseId, f.theCase.id),
      eq(schema.sitespecificBaoDcEvents.eventType, "case_month_reconciled"),
    ));
    await f.correct(70, 0);
    expect((await reconcileDcGrantForWorkerMonth(f.worker.id, "2020-02-01")).action).toBe("not_granted");
  });

  it("respects annual capacity and ownership, and does not revive administrative removals or unapproved cases", async () => {
    const f = await fixture();
    await f.correct(120, 0);
    const reserved = await db.insert(schema.sitespecificBaoDcCaseMonths).values(
      [3, 4, 5, 6, 7, 8].map(month => ({
        caseId: f.theCase.id, workerId: f.worker.id, workMonthYmd: `2020-${String(month).padStart(2, "0")}-01`,
        status: "queued" as const,
      })),
    ).returning();
    // Process still records employer evidence, but restoration cannot consume
    // a seventh month. The helper exposes the blocked outcome explicitly.
    await f.correct(80, 0);
    expect((await reconcileDcGrantForWorkerMonth(f.worker.id, "2020-02-01")).action).toBe("capacity_blocked");
    await db.delete(schema.sitespecificBaoDcCaseMonths).where(eq(schema.sitespecificBaoDcCaseMonths.id, reserved[0].id));
    await f.correct(80, 40); // exactly the sixth slot
    expect(await storage.baoDisabilityCredit.countApplicableMonthsForWorkerYear(f.worker.id, 2020)).toBe(6);
    await f.correct(120, 0);
    const [owner] = await db.insert(schema.sitespecificBaoDcCaseMonths).values({
      caseId: f.theCase.id, workerId: f.worker.id, workMonthYmd: "2020-02-01", status: "selected",
    }).returning();
    await f.correct(80, 0);
    await db.delete(schema.sitespecificBaoDcCaseMonths).where(eq(schema.sitespecificBaoDcCaseMonths.id, owner.id));
    await db.update(schema.sitespecificBaoDcCaseMonths).set({ voidReason: "Administrative removal" })
      .where(eq(schema.sitespecificBaoDcCaseMonths.id, f.month.id));
    await f.correct(70, 0);
    await db.update(schema.sitespecificBaoDcCaseMonths).set({
      voidReason: "Reconciled away — later employer hours reached the continuation threshold",
    }).where(eq(schema.sitespecificBaoDcCaseMonths.id, f.month.id));
    await db.update(schema.sitespecificBaoDcCases).set({ status: "draft" }).where(eq(schema.sitespecificBaoDcCases.id, f.theCase.id));
    await f.correct(60, 0);
    expect(await db.select().from(schema.workerHours).where(and(
      eq(schema.workerHours.workerId, f.worker.id), eq(schema.workerHours.employerId, fund.employerId),
    ))).toHaveLength(0);
  });
});
