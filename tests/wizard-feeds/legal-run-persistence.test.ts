import { beforeEach, expect, it, vi } from "vitest";
import type { WizardStepHandler } from "../../server/plugins/wizards/types";
const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), step: vi.fn(), error: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { wizards: { getById: mocks.read, update: mocks.write } } }));
vi.mock("../../server/plugins/wizards/registry", () => ({
  wizardPluginRegistry: {
    get: () => ({ id: "legal", steps: [] }), getStep: mocks.step, getMetadata: () => ({}),
  },
}));
vi.mock("../../server/plugins/_core", () => ({ enforcePluginGating: async () => ({ ok: true }) }));
vi.mock("../../server/logger", () => ({ logger: { error: mocks.error } }));
vi.mock("../../server/storage/transaction-context", () => ({
  onAfterCommit: (fn: () => void) => fn(), runOutsideTransaction: (fn: () => unknown) => fn(),
}));
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";

let saved: any;
beforeEach(() => {
  vi.clearAllMocks();
  saved = { id: "u", type: "legal", status: "draft", data: {} };
  mocks.read.mockImplementation(async () => structuredClone(saved));
  mocks.write.mockImplementation(async (_id, updates) => {
    saved = { ...saved, ...structuredClone(updates) };
    return structuredClone(saved);
  });
});
async function invoke(step: WizardStepHandler) {
  const routes = new Map<string, any>();
  const app = { post: (path: string, ...handlers: any[]) => routes.set(path, handlers.at(-1)), get: () => {} };
  registerWizardDispatcherRoutes(app as any, () => {});
  mocks.step.mockReturnValue(step);
  const response: any = { code: 200, status(code: number) { this.code = code; return this; }, json: vi.fn() };
  await routes.get("/api/wizards/:id/dispatch/:stepId/run")({ params: { id: "u", stepId: "process" }, body: {} }, response);
  return response;
}
it("refuses direct runs before acknowledging or changing progress when readiness fails", async () => {
  const run = vi.fn();
  const response = await invoke({
    id: "process", name: "Process", kind: "run", run,
    beforeRun: async () => { throw new Error("Approve the current estimate"); },
  });
  expect(response.code).toBe(400);
  expect(run).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
it("publishes only after results, terminal status and step completion are stored; hook failure cannot fail the upload", async () => {
  const after = vi.fn(async (wizard, outcome) => {
    expect(outcome).toBe("completed");
    expect(wizard.status).toBe("completed");
    expect(saved.data.processResults).toEqual({ successCount: 2 });
    expect(saved.data.progress.process.status).toBe("completed");
    throw new Error("Notification failed");
  });
  const response = await invoke({
    id: "process", name: "Process", kind: "run",
    run: async () => ({ data: { processResults: { successCount: 2 } }, status: "completed" }),
    afterRunPersisted: after,
  });
  expect(response.code).toBe(202);
  await vi.waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Wizard post-persistence hook failed", expect.anything()));
  expect(after).toHaveBeenCalledTimes(1);
  expect(saved.status).toBe("completed");
  expect(saved.data.progress.process.status).toBe("completed");
});
it("failed-run completion observes durable failure status and progress", async () => {
  const after = vi.fn(async (wizard, outcome) => {
    expect(outcome).toBe("failed");
    expect(wizard.status).toBe("failed");
    expect(saved.data.progress.process.status).toBe("failed");
  });
  await invoke({
    id: "process", name: "Process", kind: "run", failureStatus: "failed",
    run: async () => { throw new Error("Row processing aborted"); }, afterRunPersisted: after,
  });
  await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(1));
});
