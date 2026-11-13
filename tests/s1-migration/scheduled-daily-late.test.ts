import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  query: vi.fn(), end: vi.fn(), publish: vi.fn(),
}));
vi.mock("../../server/storage/db", () => ({
  pool: { query: fake.query, end: fake.end },
}));
vi.mock("../../scripts/s1-migration/lib/sns-alert", () => ({
  publishS1AutomationAlert: fake.publish,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake.end.mockResolvedValue(undefined);
  fake.publish.mockResolvedValue(undefined);
});
afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
});

describe("scheduled daily deadline check", () => {
  it("looks for successful keep-going runs without weakening other predicates", async () => {
    fake.query.mockImplementation(async (sql: string) => {
      // Lock down the actual query used by the entrypoint, not a separate planner.
      expect(sql).toContain("COALESCE((args->>'keepGoing')::boolean, false) = true");
      expect(sql).toContain("args->>'command' = 'sync'");
      expect(sql).toContain("args->>'mode' = 'daily'");
      expect(sql).toContain("args->>'profile' = 'production'");
      for (const flag of ["forceReconcile", "skipStage"]) {
        expect(sql).toContain(`COALESCE((args->>'${flag}')::boolean, false) = false`);
      }
      expect(sql).toContain("report->>'result' = 'PASS'");
      expect(sql).toContain("started_at >= (");
      expect(sql).toContain("(now() AT TIME ZONE 'America/Los_Angeles')::date");
      return { rows: [{ started_at: new Date("2026-11-13T08:01:00Z"),
        result: "PASS", duration_sec: "123", findings: {} }] };
    });
    await import("../../scripts/s1-migration/check-scheduled-daily-late");
    await vi.waitFor(() => expect(fake.end).toHaveBeenCalledOnce());
    expect(fake.publish).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"status":"pass"'));
    expect(process.exitCode).not.toBe(1);
  });

  it("still alerts and fails when no qualifying successful run exists", async () => {
    fake.query.mockResolvedValue({ rows: [] });
    await import("../../scripts/s1-migration/check-scheduled-daily-late");
    await vi.waitFor(() => expect(fake.end).toHaveBeenCalledOnce());
    expect(fake.publish).toHaveBeenCalledWith(
      "S1 daily sync has no successful completion by 9 AM Pacific",
      expect.stringContaining('"status":"missing"'),
    );
    expect(process.exitCode).toBe(1);
  });
});
