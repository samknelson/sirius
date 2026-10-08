import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { stringify } from "csv-stringify/sync";
import * as XLSX from "xlsx";

const uploads = vi.hoisted(() => new Map<string, { id: string; mimeType: string; bytes: Buffer }>());
vi.mock("../../server/plugins/wizards/attachments", () => ({
  getWizardAttachment: vi.fn(async (id: string) => uploads.get(id)),
  downloadWizardAttachment: vi.fn(async (id: string) => uploads.get(id)!.bytes),
}));
vi.mock("../../server/plugins/_core", async (original) => ({
  ...await original<any>(), enforcePluginGating: async () => ({ ok: true }),
}));
vi.mock("../../server/plugins/wizards/entity-access", () => ({
  enforceWizardEntityAccess: async () => ({ ok: true }),
  enforceWizardRecordAccess: async () => ({ ok: true }),
}));
import { storage } from "../../server/storage";
import { db, databaseSourceInfo } from "../../server/storage/db";
import { optionsEmploymentStatus } from "../../shared/schema";
import { baoMonthlyHours } from "../../server/plugins/wizards/engine/types/bao_monthly_hours";
import "../../server/plugins/wizards/plugins/bao-monthly-hours";
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";
import { registerWizardRoutes } from "../../server/modules/wizards";

afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  // Real application DBs already have options. The disposable test DB does not.
  if ((databaseSourceInfo as any).source === "isolated-test") {
    await db.insert(optionsEmploymentStatus).values([
      { name: "Active", code: "active", employed: true },
      { name: "FMLA", code: "fmla", employed: true },
    ]);
  }
});

describe.sequential("BAO real Validate dispatcher, parser and database", () => {
  for (const count of [500, 2000]) for (const format of ["csv", "xlsx"]) for (const mode of ["create", "update"] as const) {
    it(`${count} ${format} rows in ${mode} mode durably complete`, async () => {
      const fields = ["ssn", "firstName", "lastName", "dateOfBirth", "employmentStatus", "numberOfHours",
        "phoneNumber", "addressLine1", "city", "state", "postalCode", "withholdingAmount"];
      const rows = Array.from({ length: count }, (_, i) => [
        `700-12-${String(i + 1).padStart(4, "0")}`, "Synthetic", "Fixture", i % 2 ? "6/8/85" : "1985-06-08",
        i % 10 === 3 ? "FMLA" : "Active", i % 7 ? "160" : "", "5550100",
        "1 Test Street", "Test City", "MN", "55401", "$1,234.50",
      ]);
      const fileId = randomUUID();
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([fields, ...rows]), "Hours");
      uploads.set(fileId, { id: fileId, mimeType: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: format === "csv" ? Buffer.from(stringify([fields, ...rows])) : XLSX.write(book, { type: "buffer", bookType: "xlsx" }) });
      const wizard = await storage.wizards.create({
        type: "bao_monthly_hours", status: "draft", currentStep: "validate",
        data: { uploadedFileId: fileId, mode, hasHeaders: true,
          columnMapping: Object.fromEntries(fields.map((field, i) => [field, `col_${i}`])) },
      });
      const metrics: Record<string, { count: number; ms: number }> = {};
      function measure(obj: any, key: string) {
        const original = obj[key].bind(obj);
        vi.spyOn(obj, key).mockImplementation(async (...args: any[]) => {
          const start = performance.now();
          const label = key === "writeStepProgress"
            ? args[3].status === "completed" ? "terminalPersistence" : args[4] ? "runClaim" : "progressPersistence"
            : key;
          try { return await original(...args); }
          finally {
            const m = metrics[label] ??= { count: 0, ms: 0 };
            m.count++; m.ms += performance.now() - start;
          }
        });
      }
      for (const key of ["getById", "mergeData", "writeStepProgress"]) measure(storage.wizards, key);
      for (const key of ["getWorkerBySSN", "getWorkersBySSNs"]) measure(storage.workers, key);
      for (const key of ["loadMappedRows", "validateRow"]) measure(baoMonthlyHours, key);
      measure(baoMonthlyHours, "prepareValidationRows");
      const mutations = [
        vi.spyOn(storage.workers, "createWorker"), vi.spyOn(storage.workerHours, "upsertWorkerHours"),
        vi.spyOn(storage.baoWithholdingAllocations, "upsert"),
        vi.spyOn(storage.workers, "updateWorkerSSN"),
        vi.spyOn(storage.ledger.entries, "create"),
        vi.spyOn(storage.ledger.entries, "bulkCreate"),
      ];
      const app = express();
      app.use(express.json());
      registerWizardDispatcherRoutes(app, (_req, _res, next) => next());
      registerWizardRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>(resolve => server.once("listening", resolve));
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      let start = performance.now();
      try {
        const initial = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/validate/data`);
        expect(initial.status).toBe(200);
        expect(await initial.json()).toMatchObject({ validationResults: null, persistenceProblem: null });
        start = performance.now();
        const response = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/validate/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        expect(response.status).toBe(202);
        let saved: any;
        const deadline = Date.now() + 60_000;
        do {
          saved = await (await fetch(`${base}/api/wizards/${wizard.id}`)).json();
          if (saved.data.progress.validate.status !== "in_progress") break;
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        expect(saved.data.progress.validate.status).toBe("completed");
        expect(saved.manifest.steps.find((s: any) => s.id === "validate").state).toBe(mode === "create" ? "completed" : "in_progress");
        expect(saved.data.validationResults.totalRows).toBe(count);
        const stepRead = await fetch(`${base}/api/wizards/${wizard.id}/dispatch/validate/data`);
        expect(stepRead.status).toBe(200);
        expect(await stepRead.json()).toMatchObject({
          validationResults: { totalRows: count }, persistenceProblem: null,
        });
        if (mode === "create") expect(saved.data.validationResults.invalidRows).toBe(0);
        else {
          expect(saved.data.validationResults.invalidRows).toBe(count);
          expect(saved.data.validationResults.errors).toHaveLength(12);
          expect(saved.data.validationResults.errors.every((e: any) => e.message === "Worker with this SSN does not exist")).toBe(true);
        }
        expect(metrics.validateRow.count).toBe(count);
        expect(metrics.getWorkerBySSN?.count ?? 0).toBe(0);
        expect(metrics.getWorkersBySSNs?.count ?? 0).toBe(mode === "update" ? 1 : 0);
        for (const mutation of mutations) expect(mutation).not.toHaveBeenCalled();
        const report = { count, format, mode, totalMs: performance.now() - start, validRows: saved.data.validationResults.validRows, invalidRows: saved.data.validationResults.invalidRows,
          phases: saved.data.validationResults.diagnostics, metrics };
        console.log("VALIDATE_PROFILE", JSON.stringify(report));
        writeFileSync(`/tmp/bao-validate-${count}-${format}-${mode}.json`, JSON.stringify(report, null, 2));
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await storage.wizards.delete(wizard.id);
        uploads.delete(fileId);
      }
    }, 90_000);
  }
});
