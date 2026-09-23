import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Import storage first to avoid the wizard registry initialization cycle.
import { storage } from "../../server/storage";

describe("wizard run progress (database)", () => {
  let wizardId: string;

  beforeEach(async () => {
    wizardId = (await storage.wizards.create({
      type: "bao_monthly_hours", status: "draft", currentStep: "validate",
      data: { columnMapping: {} },
    })).id;
  });

  afterEach(async () => {
    await storage.wizards.delete(wizardId);
  });

  it("refuses competing starts, preserves results despite delayed progress, and commits terminal status atomically", async () => {
    const now = new Date().toISOString();
    const [first, competing] = await Promise.all([
      storage.wizards.writeStepProgress(wizardId, "validate", "first",
        { status: "in_progress", heartbeatAt: now }, true),
      storage.wizards.writeStepProgress(wizardId, "validate", "competing",
        { status: "in_progress", heartbeatAt: now }, true),
    ]);
    const winner = first ? "first" : "competing";
    expect(!!first !== !!competing).toBe(true);
    const loser = first ? "competing" : "first";
    expect(await storage.wizards.writeStepProgress(wizardId, "validate", loser,
      { percentComplete: 90 })).toBeUndefined();

    await storage.wizards.mergeData(wizardId, { validationResults: { totalRows: 2000, invalidRows: 0 } });
    await storage.wizards.writeStepProgress(wizardId, "validate", winner,
      { status: "completed", percentComplete: 100 }, false, { result: "saved" }, "complete");
    expect(await storage.wizards.writeStepProgress(wizardId, "validate", winner,
      { status: "in_progress", percentComplete: 25 })).toBeUndefined();
    const persisted = await storage.wizards.getById(wizardId);
    expect(persisted?.status).toBe("complete");
    expect((persisted?.data as any).progress.validate.status).toBe("completed");
    expect((persisted?.data as any).validationResults.totalRows).toBe(2000);
    expect((persisted?.data as any).result).toBe("saved");
  });

  it("recovers an abandoned run after lease expiry and ignores its late writes", async () => {
    const expired = new Date(Date.now() - 3 * 60_000).toISOString();
    await storage.wizards.writeStepProgress(wizardId, "validate", "abandoned",
      { status: "in_progress", heartbeatAt: expired, startedAt: expired }, true);
    const fresh = await storage.wizards.writeStepProgress(wizardId, "validate", "restarted",
      { status: "in_progress", heartbeatAt: new Date().toISOString(), percentComplete: 0 }, true);
    expect(fresh).toBeDefined();
    expect(await storage.wizards.writeStepProgress(wizardId, "validate", "abandoned",
      { status: "completed" })).toBeUndefined();
    expect(await storage.wizards.mergeData(wizardId,
      { validationResults: { totalRows: 1 } }, "validate", "abandoned")).toBeUndefined();
    expect(await storage.wizards.mergeData(wizardId,
      { validationResults: { totalRows: 2 } }, "validate", "restarted")).toBeDefined();
    await storage.wizards.writeStepProgress(wizardId, "validate", "restarted",
      { status: "failed", error: "Source file unavailable" });
    const refreshed = await storage.wizards.getById(wizardId);
    expect((refreshed?.data as any).progress.validate.status).toBe("failed");
    expect((refreshed?.data as any).progress.validate.error).toBe("Source file unavailable");
    expect((refreshed?.data as any).validationResults.totalRows).toBe(2);
  });

  it("does not mark a run completed when its terminal payload cannot be saved", async () => {
    await storage.wizards.writeStepProgress(wizardId, "validate", "run",
      { status: "in_progress", heartbeatAt: new Date().toISOString() }, true);
    await expect(storage.wizards.writeStepProgress(wizardId, "validate", "run",
      { status: "completed" }, false, { badPayload: BigInt(1) }, "complete")).rejects.toThrow();
    let saved = await storage.wizards.getById(wizardId);
    expect(saved?.status).toBe("draft");
    expect((saved?.data as any).progress.validate.status).toBe("in_progress");
    await storage.wizards.writeStepProgress(wizardId, "validate", "run",
      { status: "failed", error: "Could not save validation results" });
    saved = await storage.wizards.getById(wizardId);
    expect((saved?.data as any).progress.validate.status).toBe("failed");
  });
});