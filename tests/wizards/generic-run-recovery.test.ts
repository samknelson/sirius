import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { storage } from "../../server/storage";
import { registerWizardRoutes } from "../../server/modules/wizards";
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";
import { registerWizardPlugin } from "../../server/plugins/wizards";
import type { WizardPlugin } from "../../server/plugins/wizards/types";

vi.mock("../../server/plugins/wizards/entity-access", () => ({
  enforceWizardRecordAccess: async () => ({ ok: true }),
  enforceWizardEntityAccess: async () => ({ ok: true }),
}));

const typeA = "wizard_recovery_fixture";
const typeB = "wizard_recovery_other";
let origin = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
const ids: string[] = [];
const executions = new Map<string, number>();
let holdRun: { promise: Promise<void>; resolve: () => void } | undefined;

const plugin: WizardPlugin = {
  id: typeA,
  name: "Recovery fixture",
  description: "Test wizard for shared run recovery",
  steps: [
    {
      id: "unsafe",
      name: "Unsafe",
      kind: "run",
      run: async () => {
        executions.set("unsafe", (executions.get("unsafe") ?? 0) + 1);
        throw new Error("A side effect may have completed");
      },
    },
    {
      id: "safe",
      name: "Safe",
      kind: "run",
      retrySafe: true,
      run: async () => {
        const attempt = (executions.get("safe") ?? 0) + 1;
        executions.set("safe", attempt);
        if (attempt === 1) throw new Error("Read-only attempt failed");
        if (holdRun) await holdRun.promise;
        return { data: { safeResult: attempt } };
      },
    },
    {
      id: "slow",
      name: "Slow",
      kind: "run",
      retrySafe: true,
      run: async () => {
        executions.set("slow", (executions.get("slow") ?? 0) + 1);
        await holdRun?.promise;
      },
    },
  ],
};

const otherPlugin: WizardPlugin = {
  id: typeB,
  name: "Other fixture",
  description: "Second type for identity tests",
  steps: [{ id: "start", name: "Start", kind: "form" }],
};

const requireAuth: RequestHandler = (req, _res, next) => {
  req.user = { claims: { sub: "fixture" }, dbUser: { id: "fixture", role: "admin" } } as any;
  next();
};

async function create(step: string, data: Record<string, unknown> = {}) {
  const wizard = await storage.wizards.create({
    type: typeA,
    status: "draft",
    currentStep: step,
    data,
  });
  ids.push(wizard.id);
  return wizard;
}

async function postRun(id: string, step: string) {
  return fetch(`${origin}/api/wizards/${id}/dispatch/${step}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

async function waitForStatus(id: string, step: string, status: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const wizard: any = await storage.wizards.getById(id);
    if (wizard?.data?.progress?.[step]?.status === status) return wizard;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not reach ${status}`);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeAll(async () => {
  registerWizardPlugin(plugin);
  registerWizardPlugin(otherPlugin);
  const app = express();
  app.use(express.json());
  registerWizardRoutes(app, requireAuth, () => requireAuth);
  registerWizardDispatcherRoutes(app, requireAuth);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all(ids.map((id) => storage.wizards.delete(id)));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("generic wizard identity and run recovery", () => {
  it("rejects type changes after the wizard contains progress and permits only untouched drafts", async () => {
    const untouched = await storage.wizards.create({
      type: typeA, status: "draft", currentStep: null, entityId: null, data: {},
    });
    ids.push(untouched.id);
    const retyped = await fetch(`${origin}/api/wizards/${untouched.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: typeB }),
    });
    expect(retyped.status).toBe(200);
    expect((await storage.wizards.getById(untouched.id))?.type).toBe(typeB);

    const progressed = await create("safe", {
      progress: { safe: { status: "completed", runId: "previous" } },
    });
    const refused = await fetch(`${origin}/api/wizards/${progressed.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: typeB }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      message: expect.stringContaining("type is fixed"),
    });
    expect((await storage.wizards.getById(progressed.id))?.type).toBe(typeA);
  });

  it("does not automatically dispatch a failed step without an explicit safe-retry declaration", async () => {
    const wizard = await create("unsafe");
    expect((await postRun(wizard.id, "unsafe")).status).toBe(202);
    await waitForStatus(wizard.id, "unsafe", "failed");
    const retry = await postRun(wizard.id, "unsafe");
    expect(retry.status).toBe(409);
    expect(await retry.text()).toContain("not marked safe");
    expect(executions.get("unsafe")).toBe(1);
  });

  it("gives each safe retry a new run identity and keeps earlier failure evidence", async () => {
    const wizard = await create("safe");
    expect((await postRun(wizard.id, "safe")).status).toBe(202);
    const first = await waitForStatus(wizard.id, "safe", "failed");
    const firstRunId = (first.data as any).progress.safe.runId;
    holdRun = deferred();
    expect((await postRun(wizard.id, "safe")).status).toBe(202);
    const started: any = await storage.wizards.getById(wizard.id);
    const current = started.data.progress.safe;
    expect(current.status).toBe("in_progress");
    expect(current.runId).not.toBe(firstRunId);
    expect(current.attempts).toContainEqual(expect.objectContaining({
      runId: firstRunId,
      status: "failed",
      error: "Read-only attempt failed",
    }));
    expect(await storage.wizards.writeStepProgress(wizard.id, "safe", firstRunId, {
      status: "completed",
    })).toBeUndefined();
    holdRun.resolve();
    const complete = await waitForStatus(wizard.id, "safe", "completed");
    expect((complete.data as any).safeResult).toBe(2);
    expect(executions.get("safe")).toBe(2);
    holdRun = undefined;
  });

  it("does not treat an expired generic heartbeat as permission to retry", async () => {
    const wizard = await create("slow");
    holdRun = deferred();
    expect((await postRun(wizard.id, "slow")).status).toBe(202);
    const running: any = await waitForStatus(wizard.id, "slow", "in_progress");
    const runId = running.data.progress.slow.runId;
    await storage.wizards.writeStepProgress(wizard.id, "slow", runId, {
      heartbeatAt: new Date(0).toISOString(),
    });
    const refused = await postRun(wizard.id, "slow");
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("stale or unreadable heartbeat");
    expect(executions.get("slow")).toBe(1);
    holdRun.resolve();
    await waitForStatus(wizard.id, "slow", "completed");
    holdRun = undefined;
  });
});
