import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../server/storage";
import { db, pool, databaseSourceInfo } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { runOutsideTransaction } from "../../server/storage/transaction-context";
import { withWizardProcessWrite } from "../../server/storage/wizard-process-lock";
import { startProcessRun, processPersistenceProblem } from "../../server/plugins/wizards/process-run";
import { validationProgressWriter } from "../../server/plugins/wizards/validation-run";
import type { WizardStepContext, WizardStepHandler } from "../../server/plugins/wizards/types";
import { deleteWizardWithAttachments } from "../../server/plugins/wizards/attachments";

const ids: string[] = [];
const create = async () => {
  const wizard = await storage.wizards.create({ type: "bao_monthly_hours", status: "draft", currentStep: "process", data: {} });
  ids.push(wizard.id);
  return wizard;
};
const ctx = (wizard: any, runId: string): WizardStepContext => ({
  wizard, wizardId: wizard.id, runId, req: {} as any, input: {}, storage, reportProgress: async () => {},
});
const wait = async (predicate: () => unknown | Promise<unknown>) => {
  for (let i = 0; i < 400; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Run did not reach expected state");
};
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const step = (run: WizardStepHandler["run"]): WizardStepHandler => ({ id: "process", kind: "run", name: "Process", run });
afterEach(() => { vi.restoreAllMocks(); ids.length = 0; }); // The isolated cluster owns cleanup of retained Process evidence.

describe.skipIf((databaseSourceInfo as any).source !== "isolated-test").sequential("managed Process persistence and execution boundaries", () => {
  it("atomically refuses deletion when admission commits after a stale pre-delete read, without touching files", async () => {
    const wizard = await create();
    const entered = deferred(), allowUpdate = deferred(), work = deferred();
    const real = storage.wizards.update.bind(storage.wizards);
    vi.spyOn(storage.wizards, "update").mockImplementation(async (...args) => {
      if (args[1].status === "deleting") { entered.resolve(); await allowUpdate.promise; }
      return real(...args);
    });
    const listed = vi.spyOn(storage.entityFiles, "list");
    const legacy = vi.spyOn(storage.files, "list");
    const deleting = deleteWizardWithAttachments(wizard.id);
    await entered.promise;
    expect(await startProcessRun(wizard, step(async () => {
      await work.promise; return { data: { processResults: { totalRows: 1 } } };
    }), ctx)).toBe(true);
    allowUpdate.resolve();
    expect(await deleting).toMatchObject({ deleted: false, failedFileIds: [], blockedReason: expect.stringContaining("must be retained") });
    expect(listed).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    expect((await storage.wizards.getById(wizard.id))?.status).toBe("draft");
    work.resolve();
    await wait(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.process.status === "completed");
    expect((await storage.wizards.getById(wizard.id) as any).data.processResults).toEqual({ totalRows: 1 });
    expect(await storage.wizards.update(wizard.id, { type: "gbhet_legal_workers" })).toBeUndefined();
    expect((await storage.wizards.getById(wizard.id))?.type).toBe("bao_monthly_hours");
    expect(await storage.wizards.update(wizard.id, { data: null })).toBeUndefined();
    expect(await storage.wizards.update(wizard.id, { status: "deleting" })).toBeUndefined();
    expect(await storage.wizards.delete(wizard.id)).toBe(false);
  });

  it("does not begin business work when the deletion transition wins admission", async () => {
    const wizard = await create();
    expect(await storage.wizards.update(wizard.id, { status: "deleting" })).toBeDefined();
    const business = vi.fn(async () => {});
    expect(await startProcessRun(wizard, step(business), ctx)).toBe(false);
    expect(business).not.toHaveBeenCalled();
    expect(await storage.wizards.delete(wizard.id)).toBe(true);
  });

  it("does not admit a stale BAO snapshot after an earlier type change wins", async () => {
    const wizard = await create();
    expect(await storage.wizards.update(wizard.id, { type: "gbhet_legal_workers_monthly" })).toBeDefined();
    const business = vi.fn(async () => {});
    expect(await startProcessRun(wizard, step(business), ctx)).toBe(false);
    expect(business).not.toHaveBeenCalled();
    expect(await storage.wizards.delete(wizard.id)).toBe(true);
  });

  it("leases healthy work despite stale heartbeat, atomically saves, refuses resubmission and stale snapshots", async () => {
    const wizard = await create();
    const blocked = deferred();
    expect(await startProcessRun(wizard, step(async () => { await blocked.promise; return { data: { processResults: { totalRows: 2009 } } }; }), ctx)).toBe(true);
    const current: any = await storage.wizards.getById(wizard.id);
    const runId = current.data.progress.process.runId;
    await storage.wizards.writeStepProgress(wizard.id, "process", runId, { heartbeatAt: new Date(0).toISOString() });
    const { execFileSync } = await import("node:child_process");
    const locked = execFileSync(process.execPath, ["--input-type=module", "-e",
      `import pg from 'pg'; const options = JSON.parse(process.argv[1]); const pool = new pg.Pool(options);
       const result = await pool.query("SELECT pg_try_advisory_lock(1350, hashtext($1)) AS locked", [process.argv[2]]);
       console.log(JSON.stringify(result.rows[0].locked)); await pool.end();`,
      JSON.stringify({ host: pool.options.host, port: pool.options.port, user: "postgres", database: "postgres" }),
      `wizard-validation:${wizard.id}`], { encoding: "utf8" });
    expect(locked.trim()).toBe("false");
    expect(await startProcessRun(wizard, step(async () => {}), ctx)).toBe(false);
    expect(await storage.wizards.update(wizard.id, { data: wizard.data as any })).toBeUndefined();
    blocked.resolve();
    await wait(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.process.status === "completed");
    expect(await storage.wizards.writeStepProgress(wizard.id, "process", runId, { status: "in_progress", percentComplete: 4 })).toBeUndefined();
    expect(await storage.wizards.update(wizard.id, { data: current.data })).toBeUndefined();
    expect(await startProcessRun(wizard, step(async () => {}), ctx)).toBe(false);
    expect((await storage.wizards.getById(wizard.id) as any).data.processResults.totalRows).toBe(2009);
  });

  it("retries only final metadata, never the side effects, and catches an unsavable failure", async () => {
    const wizard = await create();
    const real = storage.wizards.writeStepProgress.bind(storage.wizards);
    let completedAttempts = 0;
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (args[3].status === "completed" && ++completedAttempts < 3) throw new Error("sensitive canary");
      return real(...args);
    });
    const business = vi.fn(async () => ({ data: { processResults: { successCount: 1 } } }));
    await startProcessRun(wizard, step(business), ctx);
    await wait(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.process.status === "completed");
    expect(business).toHaveBeenCalledTimes(1);
    expect(completedAttempts).toBe(3);
    vi.restoreAllMocks();
    const second = await create();
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (["completed", "failed"].includes(String(args[3].status))) throw new Error("sensitive canary");
      return real(...args);
    });
    await startProcessRun(second, step(async () => { throw new Error("sensitive canary"); }), ctx);
    const runId = (await storage.wizards.getById(second.id) as any).data.progress.process.runId;
    await wait(() => processPersistenceProblem(second.id, runId));
    expect(processPersistenceProblem(second.id, runId)).toContain("Do not resubmit");
    expect(processPersistenceProblem(second.id, "old-run")).toBeNull();
  });

  it("cancels blocked metadata in PostgreSQL and never commits a late timed-out update", async () => {
    const wizard = await create();
    await storage.wizards.writeStepProgress(wizard.id, "process", "blocked", { status: "in_progress" }, true);
    const locked = deferred(), release = deferred();
    const blocker = db.transaction(async tx => {
      await tx.execute(sql`select id from wizards where id = ${wizard.id} for update`);
      locked.resolve(); await release.promise;
    });
    await locked.promise;
    try {
      await expect(runOutsideTransaction(() => withWizardProcessWrite(() =>
        storage.wizards.writeStepProgress(wizard.id, "process", "blocked", { percentComplete: 68 }), 50))).rejects.toThrow();
    } finally { release.resolve(); await blocker; }
    expect((await storage.wizards.getById(wizard.id) as any).data.progress.process.percentComplete).toBeUndefined();
  });

  it("records an explicit persistence failure without replaying completed work", async () => {
    const wizard = await create();
    const real = storage.wizards.writeStepProgress.bind(storage.wizards);
    let attempts = 0;
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (args[3].status === "completed") { attempts++; throw new Error("sensitive-canary"); }
      return real(...args);
    });
    const business = vi.fn(async () => ({ data: { processResults: { totalRows: 2009 } } }));
    await startProcessRun(wizard, step(business), ctx);
    await wait(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.process.status === "failed");
    const saved: any = await storage.wizards.getById(wizard.id);
    expect(saved.data.progress.process.phase).toBe("persistence-failed");
    expect(saved.data.progress.process.error).toContain("Processing finished");
    expect(saved.data.processResults).toBeUndefined();
    expect(attempts).toBe(3);
    expect(business).toHaveBeenCalledTimes(1);
  });

  it("continues healthy execution after rejected progress writes and never inherits a caller transaction", async () => {
    const wizard = await create();
    const real = storage.wizards.writeStepProgress.bind(storage.wizards);
    let failures = 0;
    vi.spyOn(storage.wizards, "writeStepProgress").mockImplementation(async (...args) => {
      if (!args[4] && !args[3].status) { failures++; throw new Error("sensitive-canary"); }
      return real(...args);
    });
    const { getCurrentTransaction, runWithTransaction } = await import("../../server/storage/transaction-context");
    await db.transaction(async tx => runWithTransaction(tx, async () => {
      await startProcessRun(wizard, step(async context => {
        expect(getCurrentTransaction()).toBeUndefined();
        await context.reportProgress(68);
        await new Promise(resolve => setTimeout(resolve, 1250));
        return { data: { processResults: { totalRows: 1 } } };
      }), ctx);
    }));
    await wait(async () => (await storage.wizards.getById(wizard.id) as any).data.progress.process.status === "completed");
    expect(failures).toBeGreaterThan(0);
  });

  it("coalesces 2009 reports without per-row pending promises or concurrent writes", async () => {
    const blocked = deferred();
    const write = vi.fn().mockImplementationOnce(() => blocked.promise).mockResolvedValue(undefined);
    const writer = validationProgressWriter(write, vi.fn(), 5);
    writer.report({ processed: 0 });
    await wait(() => write.mock.calls.length === 1);
    for (let i = 1; i <= 2009; i++) writer.report({ processed: i });
    expect(write).toHaveBeenCalledTimes(1);
    blocked.resolve();
    await wait(() => write.mock.calls.length === 2);
    expect(write.mock.calls[1][0].processed).toBe(2009);
    writer.stop();
  });

  it("detects lease loss at the next boundary and does not publish completion", async () => {
    const wizard = await create();
    const ran = deferred(), resume = deferred();
    await startProcessRun(wizard, step(async context => {
      ran.resolve(); await resume.promise;
      context.processRun!.assertOwned();
      return { data: { processResults: { successCount: 1 } } };
    }), ctx);
    await ran.promise;
    await db.execute(sql`select pg_terminate_backend(pid) from pg_locks
      where locktype = 'advisory' and objid = hashtext(${'wizard-validation:' + wizard.id})::oid and pid <> pg_backend_pid()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    resume.resolve();
    const runId = (await storage.wizards.getById(wizard.id) as any).data.progress.process.runId;
    await wait(() => processPersistenceProblem(wizard.id, runId));
    expect((await storage.wizards.getById(wizard.id) as any).data.processResults).toBeUndefined();
  });
});
