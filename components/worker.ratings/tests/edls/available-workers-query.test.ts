import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { alterHooks } from "@shared/alter";
import { registerEdlsRatingQueryPlan } from "../../server/storage/edls-query-plan";
registerEdlsRatingQueryPlan();
alterHooks.close({ isKnown: () => true, isEnabled: async () => true });

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../../server/storage/transaction-context", () => ({
  getClient: () => ({ execute: mocks.execute }),
}));

const { getAvailableWorkersForSheetQuery, getPopulationWorkerIdsQuery } = await import(
  "../../../edls/server/storage/edls/available-workers-query"
);

describe("available scheduling worker query", () => {
  it("reads only population IDs using scheduling's active/contact rules without enrichment work", async () => {
    const statements: string[] = [];
    mocks.execute.mockImplementation(async (query: SQL) => {
      statements.push(new PgDialect().sqlToQuery(query).sql);
      return { rows: [{ id: "active-worker" }] };
    });
    expect(await getPopulationWorkerIdsQuery()).toEqual(["active-worker"]);
    await getAvailableWorkersForSheetQuery("2026-06-15", "industry");
    const [lean, scheduling] = statements;
    for (const statement of statements) {
      expect(statement).toContain("INNER JOIN contacts c ON w.contact_id = c.id");
      expect(statement).toContain("INNER JOIN worker_edls we ON we.worker_id = w.id");
      expect(statement).toContain("WHERE we.active = true");
    }
    expect(lean).toMatch(/SELECT w\.id\s+FROM/);
    expect(lean).not.toMatch(/LATERAL|edls_assignments|worker_msh_denorm|worker_ratings|ORDER BY|MATERIALIZED|display_name/);
    expect(scheduling.match(/LEFT JOIN LATERAL/g)).toHaveLength(4);
  });

  it("limits each date range only after joining the crew and sheet, preserving assignment tie breaks", async () => {
    let statement = "";
    mocks.execute.mockImplementation(async (query: SQL) => {
      statement = new PgDialect().sqlToQuery(query).sql;
      return { rows: [] };
    });
    await getAvailableWorkersForSheetQuery("2026-06-15", null);

    const lookups = [...statement.matchAll(/LEFT JOIN LATERAL \(([\s\S]*?)\) "(prior|current|next)_assignment" ON true/g)];
    expect(lookups).toHaveLength(3);
    for (const [, lookup, position] of lookups) {
      expect(lookup).toMatch(/FROM edls_assignments ea\s+INNER JOIN edls_crews ec ON ea\.crew_id = ec\.id\s+INNER JOIN edls_sheets es ON ec\.sheet_id = es\.id\s+WHERE ea\.worker_id = aw\.id/);
      expect(lookup).toContain("ea.crew_id IS NOT NULL");
      const comparison = { prior: "<", current: "=", next: ">" }[position];
      expect(lookup).toContain(`ea.ymd ${comparison} $`);
      const ordering = { prior: "ea.ymd DESC, ea.id", current: "ea.id", next: "ea.ymd ASC, ea.id" }[position];
      expect(lookup).toContain(`ORDER BY ${ordering}\n    LIMIT 1`);
      expect(lookup).not.toMatch(/es\.(status|ymd)\s*[=<>!]/);
    }
    expect(statement).not.toMatch(/array_agg|assignment_statuses/);
  });

  it.each([
    [null, undefined, false],
    [null, undefined, true],
    [null, "rating", false],
    [null, "rating", true],
    ["industry", undefined, false],
    ["industry", undefined, true],
    ["industry", "rating", false],
    ["industry", "rating", true],
  ] as const)("keeps population and ordering for industry=%s rating=%s includeInactive=%s", async (industry, rating, includeInactive) => {
    let statement = "";
    let params: unknown[] = [];
    mocks.execute.mockImplementation(async (query: SQL) => {
      const compiled = new PgDialect().sqlToQuery(query);
      statement = compiled.sql;
      params = compiled.params;
      return { rows: [] };
    });
    await getAvailableWorkersForSheetQuery("2026-06-15", industry, rating, includeInactive);

    expect(statement).toContain("INNER JOIN contacts c ON w.contact_id = c.id");
    expect(statement).toContain(`${includeInactive ? "LEFT" : "INNER"} JOIN worker_edls we ON we.worker_id = w.id`);
    expect(statement.includes("WHERE we.active = true")).toBe(!includeInactive);
    expect(statement.includes("INNER JOIN worker_ratings wr")).toBe(Boolean(rating));
    expect(statement.includes("ms.industry_id = $")).toBe(Boolean(industry));
    expect(params.filter((p) => p === "2026-06-15")).toHaveLength(3);
    if (industry) expect(params).toContain(industry);
    if (rating) expect(params).toContain(rating);
    const ordering = [
      ...(industry ? ['COALESCE(aw."memberStatusSequence", 999999)'] : []),
      ...(rating ? ['aw."ratingValue" DESC'] : []),
      "aw.family",
      "aw.given",
    ].join(", ");
    expect(statement.trimEnd()).toMatch(new RegExp(`ORDER BY ${ordering.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  });
});
