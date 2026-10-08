import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTable, SelectedFields } from "drizzle-orm/pg-core";
import { createWizardEmployerMonthlyStorage } from "../../server/storage/wizard_employer_monthly";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: mocks.getClient }));

const employerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

/** Real Drizzle SQL, with only execution replaced. No database connection. */
function queryCapture(results: unknown[][]) {
  const db = drizzle.mock();
  const queries: Array<{ toSQL(): { sql: string; params: unknown[] } }> = [];
  mocks.getClient.mockReturnValue({
    select(fields?: SelectedFields) {
      const select = fields ? db.select(fields) : db.select();
      return {
        from(table: PgTable) {
          const query = select.from(table);
          queries.push(query);
          query.execute = vi.fn(async () =>
            (results.shift() ?? []) as Awaited<ReturnType<typeof query.execute>>);
          return query;
        },
      };
    },
  });
  return queries;
}

describe("employer-scoped compliance upload queries", () => {
  it("constrains BOTH the employer and upload queries, using the same period/type predicates as the dashboard", async () => {
    const queries = queryCapture([
      [{ id: employerId }],
      [{ employerId, id: "newer", year: 2026, month: 1, status: "draft" },
        { employerId, id: "older", year: 2026, month: 1, status: "completed" }],
    ]);
    const storage = createWizardEmployerMonthlyStorage();
    const single = await storage.listEmployerWithUploadsForRange(employerId, 2026, 2, "monthly", 3);
    expect(single?.uploads.map(upload => upload.id)).toEqual(["newer", "older"]);
    const [employerQuery, uploadsQuery] = queries.map(query => query.toSQL());
    expect(employerQuery.sql).toContain('where "employers"."id" =');
    expect(employerQuery.params).toEqual([employerId]);
    expect(uploadsQuery.sql).toContain('"wizard_employer_monthly"."employer_id" =');
    expect(uploadsQuery.sql).toContain('"wizards"."type" =');
    expect(uploadsQuery.sql).toContain('"wizards"."date"');
    expect(uploadsQuery.params).toEqual([2025, 12, 2026, 1, 2026, 2, "monthly", employerId]);

    const fullQueries = queryCapture([[{ id: employerId }, { id: otherId }], []]);
    expect(await storage.listAllEmployersWithUploadsForRange(2026, 2, "monthly", 3)).toHaveLength(2);
    expect(fullQueries[0].toSQL().sql).not.toContain("where");
    expect(fullQueries[1].toSQL().params).toEqual(uploadsQuery.params.slice(0, -1));
    expect(fullQueries[1].toSQL().sql).not.toContain('"wizard_employer_monthly"."employer_id" =');
    expect(fullQueries[1].toSQL().sql.split(" from ")[0]).toBe(uploadsQuery.sql.split(" from ")[0]);
  });

  it("keeps an employer with no uploads, but does not query uploads for an unavailable employer", async () => {
    const storage = createWizardEmployerMonthlyStorage();
    queryCapture([[{ id: employerId }], []]);
    expect(await storage.listEmployerWithUploadsForRange(employerId, 2026, 10, "monthly", 6))
      .toMatchObject({ employer: { id: employerId }, uploads: [] });
    const missing = queryCapture([[]]);
    expect(await storage.listEmployerWithUploadsForRange(employerId, 2026, 10, "monthly", 6)).toBeUndefined();
    expect(missing).toHaveLength(1);
  });

  it("never treats an empty scoped id as an instruction to scan all employers", async () => {
    const queries = queryCapture([[]]);
    await createWizardEmployerMonthlyStorage().listEmployerWithUploadsForRange("", 2026, 10, "monthly", 6);
    expect(queries[0].toSQL().sql).toContain('where "employers"."id" =');
    expect(queries[0].toSQL().params).toEqual([""]);
  });
});
