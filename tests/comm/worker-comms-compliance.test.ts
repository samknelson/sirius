import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";

const { execute, componentEnabled } = vi.hoisted(() => ({
  execute: vi.fn(),
  componentEnabled: vi.fn(() => true),
}));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => ({ execute }), onAfterCommit: vi.fn() }));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: componentEnabled }));
vi.mock("../../server/services/event-bus", () => ({ eventBus: {}, EventType: {} }));
vi.mock("../../server/storage/system/entity-metadata-order", () => ({ provenanceCreatedDate: vi.fn() }));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { workerCommsDefinitionSchema, benefitPeriodSchema, resolveBenefitPeriod, type WorkerCommsDefinition } from "../../shared/worker-comms-compliance";
import { buildWorkerPopulationCondition } from "../../server/storage/workers";
import { compliancePopulationCte, createWorkerCommsComplianceStorage, qualifyingCommPredicate } from "../../server/storage/worker-comms-compliance";

const compile = (query: SQL) => new PgDialect().sqlToQuery(query);
const definition = (overrides: Partial<WorkerCommsDefinition> = {}): WorkerCommsDefinition => ({
  ...workerCommsDefinitionSchema.parse({ name: "SPD", commTagId: "spd", statuses: ["delivered", "offline"], population: {} }),
  id: "definition",
  ...overrides,
});

describe("worker communications compliance", () => {
  beforeEach(() => { vi.clearAllMocks(); componentEnabled.mockReturnValue(true); });

  it("keeps old definitions current-month and resolves lookback across year boundaries", () => {
    const p = { ...definition().population, benefitIds: ["legal"] };
    expect(resolveBenefitPeriod(p, "2026-01")).toMatchObject({ mode: "current", fromMonth: "2026-01", throughMonth: "2026-01" });
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "lookback", months: 6 } }, "2026-03"))
      .toMatchObject({ fromMonth: "2025-10", throughMonth: "2026-03" });
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "lookback", months: 1 } }, "2026-01"))
      .toMatchObject({ fromMonth: "2026-01", throughMonth: "2026-01" });
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "ever" } }, "2026-10"))
      .toMatchObject({ fromMonth: null, throughMonth: "2026-10" });
    expect(resolveBenefitPeriod({ ...p, benefitIds: [], benefitPeriod: { mode: "ever" } }, "2026-10"))
      .toMatchObject({ mode: "all", fromMonth: null, throughMonth: null });
  });

  it("validates only known period shapes and real ordered dates, mapping inclusive dates to overlapping months", () => {
    for (const invalid of [
      { mode: "typo" }, { mode: "lookback", months: 0 }, { mode: "lookback", months: -1 },
      { mode: "lookback", months: 1.5 }, { mode: "lookback", months: "6" },
      { mode: "lookback", months: 1201 }, { mode: "range", from: "", through: "" },
      { mode: "range", from: "2025-02-29", through: "2025-03-01" },
      { mode: "range", from: "2025-12-31", through: "2025-01-01" },
      { mode: "current", from: "2025-01-01" },
    ]) expect(benefitPeriodSchema.safeParse(invalid).success).toBe(false);
    const p = { ...definition().population, benefitIds: ["legal"] };
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "range", from: "2025-01-01", through: "2025-12-31" } }, "2026-10"))
      .toMatchObject({ fromMonth: "2025-01", throughMonth: "2025-12" });
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "range", from: "2024-02-29", through: "2024-03-02" } }, "2026-10"))
      .toMatchObject({ fromMonth: "2024-02", throughMonth: "2024-03" });
    expect(resolveBenefitPeriod({ ...p, benefitPeriod: { mode: "range", from: "2025-01-31", through: "2025-01-31" } }, "2026-10"))
      .toMatchObject({ fromMonth: "2025-01", throughMonth: "2025-01" });
  });

  it.each([
    [{ mode: "ever" }, [2026, 10]],
    [{ mode: "lookback", months: 6 }, [2026, 5, 2026, 10]],
    [{ mode: "range", from: "2025-01-01", through: "2025-12-31" }, [2025, 1, 2025, 12]],
  ] as const)("uses one historical EXISTS without the old current-month restriction: %j", (period, bounds) => {
    const value = definition();
    const p = { ...value.population, benefitIds: ["legal", "other"], benefitPeriod: benefitPeriodSchema.parse(period) };
    const query = compile(compliancePopulationCte({ ...value, population: p }, "2026-10"));
    expect(query.sql.match(/FROM trust_wmb/g)).toHaveLength(1);
    expect(query.sql).not.toContain("wmb.month =");
    expect(query.sql).toContain("(wmb.year, wmb.month) <=");
    expect(query.params).toEqual(expect.arrayContaining(["legal", "other"]));
    const benefitOffset = query.params.indexOf("other") + 1;
    expect(query.params.slice(benefitOffset, benefitOffset + bounds.length)).toEqual(bounds);
  });

  it("validates real dates, inclusive range ordering and at least one explicit status", () => {
    const valid = definition();
    expect(workerCommsDefinitionSchema.safeParse({ ...valid, id: undefined }).success).toBe(false); // no arbitrary extension keys
    const { id: _id, ...input } = valid;
    expect(workerCommsDefinitionSchema.safeParse({ ...input, sentFrom: "2026-02-29" }).success).toBe(false);
    expect(workerCommsDefinitionSchema.safeParse({ ...input, sentFrom: "2024-02-29" }).success).toBe(true);
    expect(workerCommsDefinitionSchema.safeParse({ ...input, statuses: [] }).success).toBe(false);
    expect(workerCommsDefinitionSchema.safeParse({ ...input, statuses: ["invented"] }).success).toBe(false);
    expect(workerCommsDefinitionSchema.safeParse({ ...input, sentFrom: "2026-10-10", sentThrough: "2026-10-01" }).success).toBe(false);
  });

  it("uses OR within member/benefit choices and AND across dimensions without interpolating IDs", () => {
    const query = compile(buildWorkerPopulationCondition({
      memberStatusIds: ["a", "b", "none"], benefitIds: ["benefit-1", "benefit-2"],
      employerId: "employer' OR true --",
    }));
    expect(query.sql).toMatch(/AND \(\s*NOT EXISTS[\s\S]*OR EXISTS[\s\S]*wmd.ms_id IN/);
    expect(query.sql).toMatch(/AND EXISTS[\s\S]*wmb.benefit_id IN/);
    expect(query.params).toEqual(expect.arrayContaining(["a", "b", "benefit-1", "benefit-2", "employer' OR true --"]));
    expect(query.sql).not.toContain("employer' OR true");
    expect(query.sql).toContain("wmb.month =");
    expect(query.sql).toContain("wmb.year =");
  });

  it("preserves singleton worker-list filters and omits empty multi-select restrictions", () => {
    const single = compile(buildWorkerPopulationCondition({ memberStatusId: "a", benefitId: "benefit-1" }));
    expect(single.params).toEqual(expect.arrayContaining(["a", "benefit-1"]));
    const empty = compile(buildWorkerPopulationCondition({ memberStatusIds: [], benefitIds: [] }));
    expect(empty.sql).not.toContain("worker_msh_denorm");
    expect(empty.sql).not.toContain("trust_wmb");
    const noStatus = compile(buildWorkerPopulationCondition({ memberStatusId: "none" }));
    expect(noStatus.sql).toContain("NOT EXISTS");
  });

  it("applies the selected tag, status, medium and date boundaries to the SAME contact's comm", () => {
    const query = compile(qualifyingCommPredicate(definition({
      medium: "postal", sentFrom: "2026-10-01", sentThrough: "2026-10-31",
    })));
    expect(query.sql).toContain("cm.contact_id = c.id");
    expect(query.sql).toContain("ct.comm_id = cm.id");
    expect(query.sql).toContain("cm.status IN");
    expect(query.sql).toContain("cm.medium =");
    expect(query.sql).toMatch(/cm.sent >= \$\d+::date/);
    expect(query.sql).toMatch(/cm.sent < \(\$\d+::date \+ INTERVAL '1 day'\)/);
    expect(query.params).toEqual(["spd", "delivered", "offline", "postal", "2026-10-01", "2026-10-31"]);
    expect(query.params).not.toContain("queued");
    expect(query.params).not.toContain("failed");
  });

  it("leaves date-less comms eligible only when no sent-date restriction was requested", () => {
    const query = compile(qualifyingCommPredicate(definition({ statuses: ["queued"] })));
    expect(query.params).toEqual(["spd", "queued"]);
    expect(query.sql).not.toContain("cm.sent");
  });

  it("uses a single evidence row per worker even with many matching comms or tags", () => {
    const query = compile(compliancePopulationCte(definition()));
    expect(query.sql).toContain("DISTINCT ON (cm.contact_id)");
    expect(query.sql).toMatch(/ORDER BY cm.contact_id, cm.sent DESC NULLS LAST, cm.id/);
    expect(query.sql).toContain("LEFT JOIN evidence ON evidence.contact_id = c.id");
    expect(query.sql).toContain("EXISTS (SELECT 1 FROM comm_tags");
  });

  it.each([
    ["trust.benefits", { benefitIds: ["b"] }],
    ["bargainingunits", { bargainingUnitId: "u" }],
    ["sitespecific.btu.political", { representativeId: "r" }],
  ])("refuses saved %s restrictions when the component is disabled instead of widening", (component, population) => {
    componentEnabled.mockImplementation((name?: string) => name !== component);
    const value = definition();
    expect(() => compliancePopulationCte({ ...value, population: { ...value.population, ...population } })).toThrow("requires");
  });

  it("computes counts, report rows and select-all from the identical shared population/view predicate", async () => {
    const value = definition();
    const row = { workerId: "w", contactId: "c", name: "Worker", siriusId: 1, commId: null, status: null, medium: null, sent: null };
    execute.mockResolvedValueOnce({ rows: [{ population: 2, with: 1, without: 1, total: 1, rows: [row] }] })
      .mockResolvedValueOnce({ rows: [{ contactId: "c" }] });
    const store = createWorkerCommsComplianceStorage();
    const report = await store.report(value, "without", 2, 50);
    const contacts = await store.contacts(value, "without");
    expect(report.counts).toEqual({ population: 2, with: 1, without: 1 });
    expect(report.rows).toEqual([row]);
    expect(contacts).toEqual(["c"]);
    const queries = execute.mock.calls.map(([query]) => compile(query));
    const populationSql = compile(compliancePopulationCte(value)).sql;
    expect(queries[0].sql.startsWith(populationSql)).toBe(true);
    expect(queries[1].sql.startsWith(populationSql)).toBe(true);
    expect(queries[0].sql).toContain('WHERE "commId" IS NULL');
    expect(queries[1].sql).toContain('WHERE "commId" IS NULL');
    expect(queries[0].params.slice(-2)).toEqual([50, 50]);
    expect(queries[1].sql).toContain('SELECT DISTINCT "contactId"');
  });
});
