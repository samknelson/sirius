/**
 * A searcher's correlated subqueries must reference the row being selected
 * with a TABLE-QUALIFIED column.
 *
 * Drizzle renders an interpolated column qualified (`"grievances"."id"`) in a
 * WHERE clause but unqualified (`"id"`) in the select list of a single-table
 * select. Reusing one fragment in both positions — as these searchers do, to
 * both filter and report what a row matched on — therefore produced a bare
 * `"id"` inside a subquery joining three tables that each have one, and
 * Postgres refused the whole statement with `column reference "id" is
 * ambiguous`. The dialog reported "Grievances could not be searched" for every
 * query.
 *
 * The clause-plan tests could not catch that: they stub the database, and a
 * test that only exercised the WHERE clause would have passed throughout.
 * These assert on the SQL Drizzle actually generates, which needs no database.
 */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import { buildWorkerSearchQuery, planWorkerSearch } from "../../server/plugins/quicksearch/plugins/worker";
import {
  buildGrievanceSearchQuery,
  planGrievanceSearch,
} from "../../server/plugins/quicksearch/plugins/grievance";
import type { QuicksearchDb } from "../../server/plugins/quicksearch/sql";

/** A client that can render SQL but has nothing to execute against. */
const client = drizzle.mock() as unknown as QuicksearchDb;

/**
 * The select list is everything up to the statement's own FROM. Subqueries
 * carry their own FROM, so split on the last one.
 */
function selectList(statement: string): string {
  const from = statement.lastIndexOf(" from ");
  expect(from).toBeGreaterThan(-1);
  return statement.slice(0, from);
}

function whereClause(statement: string): string {
  const from = statement.lastIndexOf(" from ");
  return statement.slice(from);
}

describe("grievance search SQL", () => {
  // Every clause participating, so nothing is skipped by the planner.
  const plan = planGrievanceSearch("20260426-1");
  const statement = buildGrievanceSearchQuery(client, plan, 8).toSQL().sql;

  it("correlates on a table-qualified id in the select list", () => {
    // The select list carries the match-explanation flags and the worker-name
    // subquery — this is the position that was broken.
    expect(selectList(statement)).toContain(`gw.grievance_id = "grievances"."id"`);
    expect(selectList(statement)).not.toMatch(/gw\.grievance_id = "id"/);
  });

  it("correlates on a table-qualified id in the filter", () => {
    expect(whereClause(statement)).toContain(`gw.grievance_id = "grievances"."id"`);
  });

  it("never emits a bare correlated id anywhere", () => {
    expect(statement).not.toMatch(/= "id"/);
  });
});

describe("worker search SQL", () => {
  const plan = planWorkerSearch("5551234", {
    idTypeIds: ["type-a"],
    searchPhone: true,
    searchSsn: true,
  });
  const statement = buildWorkerSearchQuery(client, plan, 8).toSQL().sql;

  it("correlates the worker-id subquery on a qualified column", () => {
    expect(plan.workerIdValue).not.toBeNull();
    expect(selectList(statement)).toContain(`wi.worker_id = "workers"."id"`);
    expect(whereClause(statement)).toContain(`wi.worker_id = "workers"."id"`);
  });

  it("correlates the phone subquery on a qualified column", () => {
    expect(plan.phoneDigits).not.toBeNull();
    expect(selectList(statement)).toContain(`pn.contact_id = "workers"."contact_id"`);
    expect(whereClause(statement)).toContain(`pn.contact_id = "workers"."contact_id"`);
  });

  it("never emits a bare correlated column anywhere", () => {
    expect(statement).not.toMatch(/= "id"/);
    expect(statement).not.toMatch(/= "contact_id"/);
  });
});
