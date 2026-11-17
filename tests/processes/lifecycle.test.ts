import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../server/storage/system/processes", () => ({ createProcessesStorage: vi.fn() }));
import { ProcessReporter } from "../../server/services/process-reporter";
import type { ProcessesStorage } from "../../server/storage/system/processes";
import { processPagingSchema, processReportingStatus } from "../../shared/processes";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const identity = { id: "boot-a", name: null, roles: ["api-ws"], startedTs: new Date(0) };
function setup() {
  const heartbeat = vi.fn().mockResolvedValue({ updatedTs: new Date() });
  const end = vi.fn().mockResolvedValue(undefined);
  const reporter = new ProcessReporter(identity, { heartbeat, end } as unknown as ProcessesStorage);
  return { reporter, heartbeat, end };
}
it("retries failures, serializes observations, and preserves the boot snapshot", async () => {
  const { reporter, heartbeat } = setup();
  heartbeat.mockRejectedValueOnce(new Error("temporary failure"));
  reporter.start(); reporter.start();
  await vi.advanceTimersByTimeAsync(9_999);
  expect(heartbeat).toHaveBeenCalledTimes(1);
  expect(reporter.writeFailed).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(heartbeat.mock.calls[1][0]).toBe(identity);
  expect(reporter.writeFailed).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(heartbeat).toHaveBeenCalledTimes(3);
  await reporter.stop();
});
it("waits for in-flight work before one terminal write and never restarts", async () => {
  const { reporter, heartbeat, end } = setup();
  let release!: (row: unknown) => void;
  heartbeat.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  reporter.start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(heartbeat).toHaveBeenCalledTimes(1);
  const stop = reporter.stop();
  expect(reporter.stop()).toBe(stop);
  expect(heartbeat.mock.calls[0][1]()).toBe(false);
  expect(end).not.toHaveBeenCalled();
  release({ updatedTs: new Date() });
  await stop;
  expect(end).toHaveBeenCalledTimes(1);
  reporter.start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(heartbeat).toHaveBeenCalledTimes(1);
});
it("bounds shutdown even when the database does not settle", async () => {
  const { reporter, heartbeat, end } = setup();
  heartbeat.mockImplementation(() => new Promise(() => {}));
  reporter.start();
  const stop = reporter.stop();
  await vi.advanceTimersByTimeAsync(5_000);
  await stop;
  expect(end).not.toHaveBeenCalled();
});
it("uses a three-minute freshness boundary and bounded integer pagination", () => {
  expect(processReportingStatus(new Date(0), 180_000)).toBe("Reporting");
  expect(processReportingStatus(new Date(0), 180_001)).toBe("Stale");
  expect(processPagingSchema.parse({})).toEqual({ page: 1, pageSize: 50 });
  for (const input of [{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { page: "1e30" }, { pageSize: [] }]) {
    expect(processPagingSchema.safeParse(input).success).toBe(false);
  }
});
