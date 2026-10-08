import { randomUUID } from "node:crypto";
import type { Wizard } from "@shared/schema";
import { storage } from "../../storage";
import { logger } from "../../logger";
import { acquireWizardProcessLock, withWizardProcessWrite } from "../../storage/wizard-process-lock";
import { runOutsideTransaction } from "../../storage/transaction-context";
import type { WizardStepContext, WizardStepHandler } from "./types";
import { validationProgressWriter } from "./validation-run";

export const PROCESS_PROTOCOL = "bao-process-v1";
const SERVICE = "wizard-process";
const unsaved = new Map<string, { runId: string; message: string }>();
export function processPersistenceProblem(wizardId: string, runId?: string): string | null {
  const value = unsaved.get(wizardId);
  return value?.runId === runId ? value?.message ?? null : null;
}

export interface ManagedProcessRun {
  runId: string;
  assertOwned(): void;
  phase(phase: "load" | "rows" | "charges" | "results"): void;
  counts(processed: number, total: number): void;
  finalizeCharges?: () => Promise<void>;
}

export async function startProcessRun(
  wizard: Wizard, step: WizardStepHandler,
  makeContext: (wizard: Wizard, runId: string) => WizardStepContext,
): Promise<boolean> {
  const lease = await acquireWizardProcessLock(wizard.id);
  if (!lease) return false;
  const runId = randomUUID();
  try {
    const now = new Date().toISOString();
    const started = await withWizardProcessWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, {
      status: "in_progress", percentComplete: 0, startedAt: now, heartbeatAt: now,
      phase: "load", protocol: PROCESS_PROTOCOL, error: null, completedAt: null,
      partialPostingRisk: true,
    }, true, {}, undefined, lease.backendPid));
    if (!started) { await lease.release(); return false; }
    unsaved.delete(wizard.id);
    void runOutsideTransaction(async () => {
      const startedAt = Date.now();
      const stats = { progressWrites: 0, progressFailures: 0, terminalWrites: 0, progressWriteMs: 0, terminalWriteMs: 0 };
      let phase = "load";
      let processed = 0;
      let total = 0;
      let finished = false;
      let ownershipLost = false;
      let outcome = "unsaved";
      const assertOwned = () => {
        if (ownershipLost || !lease.isHeld?.()) throw new Error("Process ownership lost");
      };
      const writer = validationProgressWriter(async patch => {
        assertOwned();
        const t = Date.now();
        stats.progressWrites++;
        try {
          const saved = await withWizardProcessWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, patch, false, {}, undefined, lease.backendPid));
          if (!saved) ownershipLost = true;
        } finally { stats.progressWriteMs += Date.now() - t; }
      }, () => {
        stats.progressFailures++;
        if (stats.progressFailures === 1) logger.warn("Process progress persistence failed; execution is separately leased", {
          service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL, phase,
        });
      }, 1000);
      const report = () => writer.report({ phase, processed, total });
      const heartbeat = setInterval(report, 30_000);
      const save = async (patch: Record<string, unknown>, data: Record<string, unknown> = {}, status?: string) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          stats.terminalWrites++;
          const writeStarted = Date.now();
          try {
            assertOwned();
            const saved = await withWizardProcessWrite(() => storage.wizards.writeStepProgress(wizard.id, step.id, runId, {
              ...patch, processed, total, heartbeatAt: new Date().toISOString(),
            }, false, data, status, lease.backendPid));
            if (!saved) { ownershipLost = true; throw new Error("Process ownership lost"); }
            outcome = String(patch.status);
            return;
          } catch {
            logger.warn("Process terminal persistence attempt failed", {
              service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL, phase, attempt: attempt + 1,
            });
            if (attempt === 2 || ownershipLost || !lease.isHeld?.()) throw new Error("Process terminal persistence failed");
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          } finally { stats.terminalWriteMs += Date.now() - writeStarted; }
        }
      };
      try {
        const ctx = makeContext(started, runId);
        ctx.processRun = {
          runId, assertOwned,
          phase(next) {
            assertOwned();
            phase = next;
            report();
            logger.info("Process phase", { service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL,
              phase, processed, total, elapsedMs: Date.now() - startedAt });
          },
          counts(done, count) { processed = done; total = count; report(); },
        };
        ctx.reportProgress = async percentComplete => writer.report({ percentComplete });
        logger.info("Process admitted", { service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL });
        const out = await step.run!(ctx);
        finished = true;
        writer.stop();
        phase = "terminal";
        const results = out?.data?.processResults as { rowResults?: Array<{ hasIssues?: boolean; status?: string }> } | undefined;
        const rowIssues = results?.rowResults?.filter(row => row.hasIssues || row.status === "error").length ?? 0;
        await save({ status: "completed", phase: "completed", percentComplete: 100,
          completedAt: new Date().toISOString(), partialPostingRisk: rowIssues > 0, rowIssues }, out?.data ?? {}, out?.status);
      } catch {
        writer.stop();
        logger.error("Process execution or persistence failed", { service: SERVICE, wizardId: wizard.id, runId,
          protocol: PROCESS_PROTOCOL, phase, processed, total, executionFinished: finished });
        const message = finished
          ? "Processing finished, but results could not be saved. Business records may already be posted. Do not resubmit; ask an administrator to reconcile this run."
          : "Processing failed or lost execution ownership. Some business records may already be posted. Do not resubmit; ask an administrator to reconcile this run.";
        try {
          await save({ status: "failed", phase: finished ? "persistence-failed" : "execution-failed",
            error: message, partialPostingRisk: true, completedAt: new Date().toISOString() });
        } catch {
          unsaved.set(wizard.id, { runId, message: "The server could not save Process's final status. Results and posting are not confirmed. Do not resubmit; ask an administrator to reconcile this run." });
          if (unsaved.size > 100) unsaved.delete(unsaved.keys().next().value!);
          logger.error("Process terminal status unsaved", { service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL, phase });
        }
      } finally {
        writer.stop();
        clearInterval(heartbeat);
        try { await lease.release(); }
        finally {
          logger.info("Process run finished", { service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL,
            phase, processed, total, outcome, durationMs: Date.now() - startedAt, ...stats });
        }
      }
    }).catch(() => logger.error("Process detached cleanup failed", { service: SERVICE, wizardId: wizard.id, runId, protocol: PROCESS_PROTOCOL }));
    return true;
  } catch (error) {
    await lease.release();
    throw error;
  }
}
