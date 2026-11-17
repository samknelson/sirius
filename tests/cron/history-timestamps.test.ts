import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns } from "drizzle-orm";
import { jobRuns } from "@shared/schema";

const f = vi.hoisted(() => ({ query: vi.fn(), db: undefined as any }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => f.db }));
import { createJobRunStorage } from "../../server/storage/system/cron";

const storage = createJobRunStorage();
let start: string;
let completion: string | null;

beforeEach(() => {
  vi.resetAllMocks();
  completion = "2026-11-17 19:00:00.250";
  f.db = drizzle({ client: { query: f.query } as any });
  f.query.mockImplementation(async () => ({
    rows: [[
      ...Object.keys(getTableColumns(jobRuns)).map(key =>
        key === "startedAt" ? start : key === "completedAt" ? completion : null),
      null, null, null,
    ]],
  }));
});

describe("cron history timestamp boundary", () => {
  it.each([
    // PostgreSQL returns the projected timestamptz with an explicit session offset.
    ["2026-11-17 11:00:00-08", "2026-11-17T19:00:00.000Z"],
    ["2026-07-17 11:00:00-07", "2026-07-17T18:00:00.000Z"],
    ["2026-11-17 11:00:00+00", "2026-11-17T11:00:00.000Z"],
  ])("decodes projected start %s consistently without reinterpreting completion", async (value, expected) => {
    start = value;
    const rows = [
      ...(await storage.list({ pluginKind: "cron", summaryOnly: true, limit: 25, offset: 25 })),
      ...(await storage.list({ pluginKind: "cron" })),
      await storage.getById("run"),
      await storage.getLatestByPlugin("cron", "job"),
      await storage.getLatestByConfigurationId("config"),
    ];
    for (const row of rows) {
      expect(row?.startedAt.toISOString()).toBe(expected);
      expect(row?.completedAt?.toISOString()).toBe("2026-11-17T19:00:00.250Z");
    }
    for (const [query] of f.query.mock.calls) {
      expect(query.text).toContain(`CASE WHEN "job_runs"."plugin_kind" = 'cron'`);
      expect(query.text).toContain(`THEN "job_runs"."started_at" AT TIME ZONE current_setting('TimeZone')`);
      expect(query.text).toContain(`ELSE "job_runs"."started_at" AT TIME ZONE 'UTC'`);
      expect(query.text).not.toContain(`"completed_at" AT TIME ZONE`);
    }
  });

  it("preserves a running run's missing completion and non-cron UTC decoding", async () => {
    start = "2026-11-17 11:00:00+00";
    completion = null;
    const row = await storage.getLatestByPlugin("oneoff", "job");
    expect(row?.startedAt.toISOString()).toBe("2026-11-17T11:00:00.000Z");
    expect(row?.completedAt).toBeNull();
  });
});
