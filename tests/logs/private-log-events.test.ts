import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  emit: vi.fn(), values: vi.fn(), returning: vi.fn(), transportCreate: vi.fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({ insert: () => ({ values: f.values }) }),
}));
vi.mock("../../server/services/event-bus", () => ({ EventType: { LOG: "log" }, eventBus: { emit: f.emit } }));

import { createLogsStorage } from "../../server/storage/system/logs";
const row = { id: 1, level: "info", message: "Private observation", meta: { credential: "private-canary" }, module: "host" };
beforeEach(() => {
  f.emit.mockReset();
  f.returning.mockReset().mockResolvedValue([row]);
  f.values.mockReset().mockReturnValue({ returning: f.returning });
});
it("persists a private entry in full but never publishes its credentials", async () => {
  const storage = createLogsStorage();
  expect(await storage.create(row, { publishEvent: false })).toEqual(row);
  expect(f.values).toHaveBeenCalledWith(expect.objectContaining({ meta: row.meta }));
  expect(f.emit).not.toHaveBeenCalled();
});
it("preserves ordinary log publication by default", async () => {
  await createLogsStorage().create(row);
  expect(f.emit).toHaveBeenCalledWith("log", expect.objectContaining({ meta: row.meta }));
});
