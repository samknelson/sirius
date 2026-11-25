import { drizzle } from "drizzle-orm/node-postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: undefined as any,
  query: vi.fn(),
  jobGroups: false,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => mocks.client,
  runInTransaction: vi.fn(),
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: vi.fn(),
}));
vi.mock("../../server/storage/edls/crews", () => ({
  createEdlsCrewsStorage: vi.fn(),
}));
vi.mock("../../server/services/component/cache", () => ({
  isComponentEnabledSync: () => mocks.jobGroups,
}));

const { createEdlsAssignmentsStorage } = await import("../../server/storage/edls/assignments");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobGroups = false;
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.client = drizzle({ client: { query: mocks.query } as any });
});

describe("next assignment read", () => {
  it("bounds the narrow lookup per worker before enriching, without capping scheduling reads", async () => {
    const storage = createEdlsAssignmentsStorage();
    expect(await storage.getNextAssignmentsForWorkerIds(["worker", "missing", "worker"], "2026-06-15"))
      .toEqual(new Map([["worker", null], ["missing", null]]));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [nextQuery, params] = mocks.query.mock.calls[0];
    const candidates = nextQuery.text.match(/SELECT DISTINCT ON \(a\.worker_id\)([\s\S]*?)\)\s+limit/)?.[1];
    expect(candidates).toBeDefined();
    expect(candidates).toMatch(/a\.id\s+FROM edls_assignments a/);
    expect(candidates).toMatch(/a\.worker_id IN \(\$/);
    expect(candidates).toContain("s.status <> 'trash'");
    expect(candidates).toMatch(/s\.ymd > \$/);
    expect(candidates).toContain("ORDER BY a.worker_id ASC, s.ymd ASC, c.start_time ASC");
    expect(candidates).not.toMatch(/LEFT JOIN|a\.data/);
    // The derived-table LIMIT is an optimization fence, not an outer display
    // cap: no unbounded future row can reach the descriptive joins.
    expect(nextQuery.text).toMatch(/limit \$\d+\) "edls_assignments" inner join/);
    expect(params).toContain(2);
    expect(params).toContain("2026-06-15");
    expect(nextQuery.text).not.toContain('"dispatch_job_group"');

    await storage.getAssignmentsForWorkerIds(["worker"], { afterYmd: "2026-06-15" });
    const [scheduleQuery] = mocks.query.mock.calls[1];
    expect(scheduleQuery.text).not.toMatch(/LIMIT|LATERAL/);
    expect(scheduleQuery.text).toMatch(/"edls_sheets"\."ymd" > \$/);
    expect(scheduleQuery.text).toContain('order by "edls_sheets"."ymd" asc, "edls_crews"."start_time" asc');
  });

  it("keeps the full detail shape and explicit nulls for workers without another shift", async () => {
    // Driver array order follows the shared projection used by both readers.
    mocks.query.mockResolvedValue({ rows: [[
      "worker", "assignment", "generation", { classificationId: "class", custom: true }, false,
      "2026-06-16", "sheet", "Sheet", "reserved", "crew", "Crew", "08:00:00", "16:00:00", "Gate",
      "supervisor", "First", "Last", "supervisor@example.test",
      "facility", "Facility", "department", "Department", "employer", "Employer",
      "show", "Show", "task", "Task", "Classification", "C", "group", "Group",
    ]] });
    mocks.jobGroups = true;
    const storage = createEdlsAssignmentsStorage();
    const next = await storage.getNextAssignmentsForWorkerIds(["worker", "missing"], "2026-06-15");
    const all = await storage.getAssignmentsForWorkerIds(["worker", "missing"], { afterYmd: "2026-06-15" });
    expect(next.get("worker")).toEqual(all.get("worker")![0]);
    expect(next.get("worker")).toMatchObject({
      assignmentId: "assignment", generationId: "generation", sheetStatus: "reserved",
      supervisor: { id: "supervisor", email: "supervisor@example.test" },
      classification: { name: "Classification", code: "C" },
      jobGroup: { id: "group", name: "Group" },
      accepted: false, data: { classificationId: "class", custom: true },
    });
    expect(next.get("missing")).toBeNull();
    expect(mocks.query.mock.calls[0][0].text).toContain('left join "dispatch_job_group"');
  });

  it("does no database work for an empty sheet", async () => {
    expect(await createEdlsAssignmentsStorage().getNextAssignmentsForWorkerIds([], "2026-06-15"))
      .toEqual(new Map());
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
