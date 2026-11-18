import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sensitive: false, storage: {} as any }));
vi.mock("../../server/storage", () => ({ storage: state.storage }));
vi.mock("../../server/storage/unified-options", () => ({ createUnifiedOptionsStorage: () => ({
  get: async () => ({ id: "system:alternate-tax-id", name: "Alternate Tax ID" }),
}) }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "user" } }) }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ requireAccess: () => (_req: any, _res: any, next: any) => next() }));
import { registerWorkerIdsRoutes } from "../../server/modules/workers/ids";
import { ALTERNATE_TAX_ID } from "../../shared/utils/worker-tax-identity";
const canary = "SENSITIVE-TAX-001";
let server: Server, url: string;
beforeEach(() => {
  state.sensitive = false;
  Object.assign(state.storage, {
    users: { userHasPermission: async (_id: string, permission: string) => permission === "staff" || permission === "workers.ssn" && state.sensitive },
    workers: { getWorker: async () => ({ id: "worker" }) },
    workerIds: {
      getWorkerIdsByWorkerId: vi.fn(async (_id, include: boolean) => include ? [{ typeId: ALTERNATE_TAX_ID, value: canary }] : []),
      getWorkerId: async () => ({ id: "id", typeId: ALTERNATE_TAX_ID, value: canary }),
      createWorkerId: vi.fn(async data => data),
      updateWorkerId: vi.fn(async (_id, data) => data),
      deleteWorkerId: vi.fn(async () => true),
    },
  });
});
beforeAll(async () => {
  const app = express(); app.use(express.json());
  const pass = (_req: any, _res: any, next: any) => next();
  registerWorkerIdsRoutes(app, pass, () => pass);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
it("keeps generic reads private and requires staff SSN access for ID management", async () => {
  expect(await (await fetch(`${url}/api/workers/worker/ids`)).json()).toEqual([]);
  for (const path of ["/api/workers/worker/ids?includeSensitive=true", "/api/worker-ids/id"]) {
    const response = await fetch(url + path);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(canary);
  }
  for (const [method, path] of [["POST", "/api/workers/worker/ids"], ["PUT", "/api/worker-ids/id"], ["DELETE", "/api/worker-ids/id"]]) {
    const response = await fetch(url + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ typeId: ALTERNATE_TAX_ID, value: canary }) });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(canary);
  }
  expect(state.storage.workerIds.createWorkerId).not.toHaveBeenCalled();
  expect(state.storage.workerIds.updateWorkerId).not.toHaveBeenCalled();
  expect(state.storage.workerIds.deleteWorkerId).not.toHaveBeenCalled();
  state.sensitive = true;
  expect(await (await fetch(`${url}/api/workers/worker/ids?includeSensitive=true`)).json()).toEqual([{ typeId: ALTERNATE_TAX_ID, value: canary }]);
});
