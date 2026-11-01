import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import { winstonLogs } from "@shared/schema";

const f = vi.hoisted(() => ({
  query: vi.fn(), emit: vi.fn(), db: undefined as any,
}));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => f.db }));
vi.mock("../../server/services/event-bus", () => ({ eventBus: { emit: f.emit }, EventType: { LOG: "log" } }));
import { createLogsStorage } from "../../server/storage/system/logs";

let timestamp: string | null;
const storage = createLogsStorage();

beforeEach(() => {
  vi.resetAllMocks();
  timestamp = "2026-10-27 05:00:00-07";
  f.db = drizzle({ client: { query: f.query } as any });
  f.query.mockImplementation(async (query: { text: string }) => ({
    rows: query.text.includes("count(*)") ? [[1]] : [
      Object.keys(getTableColumns(winstonLogs)).map((key) =>
        key === "timestamp" ? timestamp : key === "id" ? 1 : null),
    ],
  }));
});

describe("System Log instants", () => {
  it.each([
    "2026-10-27 12:00:00+00", "2026-10-27 05:00:00-07", "2026-10-27 08:00:00-04",
  ])("preserves the instant from the database offset %s on every read and emitted event", async value => {
    timestamp = value;
    const created = await storage.create({ message: "fixture" });
    const list = await storage.getLogs({});
    const detail = await storage.getLogById(1);
    const entity = await storage.getLogsByHostEntityIds({ hostEntityIds: ["fixture"] });
    for (const row of [created, ...list.logs, detail, ...entity]) {
      expect(row?.timestamp?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    }
    expect(f.emit).toHaveBeenCalledWith("log", expect.objectContaining({
      timestamp: new Date("2026-10-27T12:00:00.000Z"),
    }));
    for (const [query] of f.query.mock.calls.filter(([q]) => !q.text.includes("count(*)"))) {
      expect(query.text).toContain(`AT TIME ZONE current_setting('TimeZone')`);
    }
  });

  it("compares entity-history date filters to instants rather than naive UTC wall clocks", async () => {
    await storage.getLogsByHostEntityIds({
      hostEntityIds: ["fixture"],
      startDate: "2026-10-27T07:00:00-04:00",
      endDate: "2026-10-27T06:00:00-07:00",
    });
    const [query, params] = f.query.mock.calls[0];
    expect(query.text).toContain(">= $2::timestamptz");
    expect(query.text).toContain("<= $3::timestamptz");
    expect(params).toEqual(["fixture", "2026-10-27T11:00:00.000Z", "2026-10-27T13:00:00.000Z"]);
  });

  it("preserves missing historical timestamps instead of inventing an instant", async () => {
    timestamp = null;
    expect((await storage.getLogById(1))?.timestamp).toBeNull();
  });
});
