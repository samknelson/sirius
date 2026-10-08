import type { Wizard } from "@shared/schema";
import { storage } from "../../storage";
import { acquireWizardValidationLock, withWizardValidationWrite } from "../../storage/wizard-validation-lock";
import { runOutsideTransaction } from "../../storage/transaction-context";
import { logger } from "../../logger";
import { randomUUID } from "node:crypto";
import type { WizardStepContext, WizardStepHandler } from "./types";
import { ValidationPhaseError } from "./validation-diagnostics";

const SERVICE = "wizard-validation";
// Keep only unpersistable terminal failures, never rows or results. This is
// supplemental evidence, not a job queue; after a restart the persisted stale
// heartbeat remains the recovery mechanism.
const unsaved = new Map<string, { runId: string; message: string }>();
export function validationPersistenceProblem(wizardId: string, runId?: string): string | null {
  const problem = unsaved.get(wizardId);
  return problem && problem.runId === runId ? problem.message : null;
}

/** One write in flight and one coalesced pending value, shared by row progress
 * and heartbeat. Failed progress writes do not abort otherwise healthy work. */
export function validationProgressWriter(write: (patch: Record<string, unknown>) => Promise<unknown>, onError: () => void, intervalMs = 0) {
  let pending: Record<string, unknown> | undefined;
  let writing = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pump = async () => {
    writing = true;
    try {
      while (pending && !stopped) {
        if (intervalMs) await new Promise<void>(resolve => {
          timer = setTimeout(resolve, intervalMs);
          timer.unref?.();
        });
        if (stopped) break;
        const patch = pending;
        pending = undefined;
        try { await write({ ...patch, heartbeatAt: new Date().toISOString() }); }
        catch { onError(); }
      }
    } finally { writing = false; }
  };
  return {
    report(patch: Record<string, unknown>) {
      if (stopped) return;
      pending = { ...pending, ...patch };
      if (!writing) void pump();
    },
    stop() { stopped = true; pending = undefined; },
  };
}

export async function startValidationRun(
  wizard: Wizard,
  step: WizardStepHandler,
  makeContext: (wizard: Wizard, runId: string) => WizardStepContext,
): Promise<boolean> {
  // Unlike a heartbeat, a database session lease cannot expire merely because
  // progress writes are slow. It also excludes a second application process.
  const lease = await acquireWizardValidationLock(wizard.id);
  if (!lease) return false;
  const runId = randomUUID();
  try {
    const now = new Date().toISOString();
    const started = await withWizardValidationWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, {
      status: "in_progress", percentComplete: 0, error: null, completedAt: null,
      startedAt: now, heartbeatAt: now, phase: "validating",
      protocol: "validation-v2",
    }, true));
    if (!started) { await lease.release(); return false; }
    unsaved.delete(wizard.id);
    void runOutsideTransaction(async () => {
      const stats = { progressWrites: 0, progressFailures: 0, progressWriteMs: 0, terminalWrites: 0, terminalWriteMs: 0 };
      const startedAt = Date.now();
      let failingPhase = "row validation";
      const writer = validationProgressWriter(async patch => {
        const t = Date.now();
        stats.progressWrites++;
        try { return await withWizardValidationWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, patch)); }
        finally { stats.progressWriteMs += Date.now() - t; }
      }, () => {
        stats.progressFailures++;
        if (stats.progressFailures === 1) logger.warn("Validation progress could not be saved; work continues", { service: SERVICE, wizardId: wizard.id, runId });
      });
      const heartbeat = setInterval(() => writer.report({}), 30_000);
      const save = async (patch: Record<string, unknown>, data: Record<string, unknown> = {}, status?: string) => {
        // Transient persistence errors are retried a bounded number of times.
        for (let attempt = 0; ; attempt++) {
          const t = Date.now();
          stats.terminalWrites++;
          try {
            if (lease.isHeld && !lease.isHeld()) throw new Error("Validation session lease was lost");
            const saved = await withWizardValidationWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, patch, false, data, status));
            if (!saved) throw new Error("Validation run no longer owns the wizard");
            return;
          } catch (error) {
            if (attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          } finally { stats.terminalWriteMs += Date.now() - t; }
        }
      };
      try {
        const ctx = makeContext(started, runId);
        ctx.reportProgress = async percentComplete => writer.report({ percentComplete });
        const out = await step.run!(ctx);
        writer.stop();
        failingPhase = "result persistence";
        await save({ status: "completed", phase: "completed", completedAt: new Date().toISOString(), percentComplete: 100 }, out?.data ?? {}, out?.status);
      } catch (error) {
        writer.stop();
        if (error instanceof ValidationPhaseError) failingPhase = error.phase;
        // Never log row validation messages or underlying transport errors:
        // these may contain sensitive row values or connection credentials.
        logger.error("Validation execution or result persistence failed", { service: SERVICE, wizardId: wizard.id, runId, phase: failingPhase });
        try {
          await save({ status: "failed", phase: "failed", error: failingPhase === "result persistence"
            ? "Validation finished, but its results could not be saved. Retry validation; if this repeats, ask an administrator to check database availability."
            : "Validation could not read or validate the upload. Check that the uploaded file is available, then retry; if this repeats, ask an administrator to check the validation logs." });
        } catch {
          const message = "The server could not save validation's final status. Results are not confirmed. Ask an administrator to check database availability, then retry.";
          unsaved.set(wizard.id, { runId, message });
          if (unsaved.size > 100) unsaved.delete(unsaved.keys().next().value!);
          logger.error("Validation terminal status could not be saved after retries", { service: SERVICE, wizardId: wizard.id, runId });
        }
      } finally {
        writer.stop();
        clearInterval(heartbeat);
        await lease.release();
        logger.info("Validation run finished", { service: SERVICE, wizardId: wizard.id, runId, durationMs: Date.now() - startedAt, ...stats });
      }
    }).catch(() => logger.error("Validation cleanup failed", { service: SERVICE, wizardId: wizard.id, runId }));
    return true;
  } catch (error) {
    await lease.release();
    throw error;
  }
}
