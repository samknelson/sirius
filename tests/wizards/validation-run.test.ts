import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../server/storage";
import { startValidationRun, validationPersistenceProblem, validationProgressWriter } from "../../server/plugins/wizards/validation-run";
import type { WizardStepHandler } from "../../server/plugins/wizards/types";
import { withWizardValidationWrite } from "../../server/storage/wizard-validation-lock";
import { db } from "../../server/storage/db";
import { runOutsideTransaction } from "../../server/storage/transaction-context";
import { sql } from "drizzle-orm";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function waitUntil(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error("Validation test did not reach expected state");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const makeContext = (wizard: any, runId: string): any => ({ wizardId: wizard.id, wizard, storage, runId, reportProgress: async () => {} });
const ids: string[] = [];
async function create() {
  const wizard = await storage.wizards.create({ type: "bao_monthly_hours", status: "draft", currentStep: "validate", data: {} });
  ids.push(wizard.id);
  return wizard;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const id of ids.splice(0)) await storage.wizards.delete(id);
});

describe.sequential("validation execution and persistence boundaries", () => {
  it("returns no persistence problem before any run exists", () => {
    expect(validationPersistenceProblem("never-started")).toBeNull();
    expect(validationPersistenceProblem("never-started", "unused-run")).toBeNull();
  });

  it("cancels a blocked progress UPDATE in PostgreSQL rather than leaving a late write behind", async () => {
    const wizard = await create();
    const now = new Date().toISOString();
    await storage.wizards.writeStepProgress(wizard.id, "validate", "timeout-run", { status: "in_progress", heartbeatAt: now }, true);
    const locked = deferred();
    const release = deferred();
    const locker = db.transaction(async tx => {
      await tx.execute(sql`select id from wizards where id = ${wizard.id} for update`);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      await expect(runOutsideTransaction(() => withWizardValidationWrite(() =>
        storage.wizards.writeStepProgress(wizard.id, "validate", "timeout-run", { percentComplete: 70 }), 50)))
        .rejects.toThrow();
    } finally { release.resolve(); await locker; }
    const saved: any = await storage.wizards.getById(wizard.id);
    expect(saved.data.progress.validate.percentComplete).toBeUndefined();
    await withWizardValidationWrite(() => storage.wizards.writeStepProgress(wizard.id, "validate", "timeout-run", { status: "completed" }));
  });

  it("coalesces delayed and rejected progress writes into one in-flight write and discards pending work at terminal", async () => {
    const blocked = deferred();
    const write = vi.fn().mockImplementationOnce(() => blocked.promise).mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const writer = validationProgressWriter(write, onError);
    for (let percentComplete = 0; percentComplete < 100; percentComplete++) writer.report({ percentComplete });
    expect(write).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await waitUntil(() => write.mock.calls.length === 2 && onError.mock.calls.length === 1);
    expect(write.mock.calls[1][0].percentComplete).toBe(99);
    writer.stop();
    writer.report({ percentComplete: 5 });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("refuses another healthy run even with an expired persisted heartbeat, and delayed writes cannot replace its results", async () => {
    const wizard = await create();
    const blocked = deferred();
    const step: WizardStepHandler = { id: "validate", name: "Validate", kind: "run", run: async () => {
      await blocked.promise;
      return { data: { validationResults: { totalRows: 500, validRows: 500 } } };
    } };
    expect(await startValidationRun(wizard, step, makeContext)).toBe(true);
    const running: any = await storage.wizards.getById(wizard.id);
    const runId = running.data.progress.validate.runId;
    await storage.wizards.writeStepProgress(wizard.id, "validate", runId, { heartbeatAt: new Date(Date.now() - 180_000).toISOString() });
    expect(await startValidationRun(wizard, step, makeContext)).toBe(false);
    blocked.resolve();
    await waitUntil(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.validate.status === "completed");
    expect(await storage.wizards.writeStepProgress(wizard.id, "validate", runId, { percentComplete: 20, status: "in_progress" })).toBeUndefined();
    const saved: any = await storage.wizards.getById(wizard.id);
    expect(saved.data.validationResults).toEqual({ totalRows: 500, validRows: 500 });
  });

  it("retries a transient terminal write and saves the results with completion", async () => {
    const wizard = await create();
    const realWrite = storage.wizards.writeStepProgress.bind(storage.wizards);
    let attempts = 0;
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (args[3].status === "completed" && attempts++ === 0) throw new Error("transient");
      return realWrite(...args);
    });
    const step: WizardStepHandler = { id: "validate", name: "Validate", kind: "run", run: async () =>
      ({ data: { validationResults: { totalRows: 2000, validRows: 2000 } } }) };
    expect(await startValidationRun(wizard, step, makeContext)).toBe(true);
    await waitUntil(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.validate.status === "completed");
    expect(attempts).toBe(2);
    expect((await storage.wizards.getById(wizard.id) as any).data.validationResults.validRows).toBe(2000);
  });

  it("records a failed state rather than completion when result persistence fails", async () => {
    const wizard = await create();
    const realWrite = storage.wizards.writeStepProgress.bind(storage.wizards);
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (args[3].status === "completed") throw new Error("unavailable");
      return realWrite(...args);
    });
    const step: WizardStepHandler = { id: "validate", name: "Validate", kind: "run", run: async () => ({ data: { validationResults: { totalRows: 2000 } } }) };
    await startValidationRun(wizard, step, makeContext);
    await waitUntil(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.validate.status === "failed");
    const saved: any = await storage.wizards.getById(wizard.id);
    expect(saved.data.validationResults).toBeUndefined();
    expect(saved.data.progress.validate.error).toContain("results could not be saved");
  });

  it("exposes an explicit diagnostic when neither completion nor failure can be persisted", async () => {
    const wizard = await create();
    const realWrite = storage.wizards.writeStepProgress.bind(storage.wizards);
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (["completed", "failed"].includes(String(args[3].status))) throw new Error("database unavailable");
      return realWrite(...args);
    });
    const step: WizardStepHandler = { id: "validate", name: "Validate", kind: "run", run: async () => ({}) };
    await startValidationRun(wizard, step, makeContext);
    const running: any = await storage.wizards.getById(wizard.id);
    const runId = running.data.progress.validate.runId;
    await waitUntil(() => !!validationPersistenceProblem(wizard.id, runId));
    expect(validationPersistenceProblem(wizard.id, runId)).toContain("could not save");
    expect(validationPersistenceProblem(wizard.id, "other-run")).toBeNull();
  });
});
