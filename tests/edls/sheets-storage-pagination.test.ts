import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getEdlsSheetsPageOrder } from "../../server/storage/edls/sheets-page-order";

describe("EDLS sheets storage pagination", () => {
  it("uses a unique tie-breaker so same-date sheets cannot move across page boundaries", () => {
    const order = getEdlsSheetsPageOrder();
    const statement = new PgDialect().sqlToQuery(
      sql`select id from edls_sheets order by ${sql.join(order, sql`, `)}`,
    ).sql.toLowerCase();

    expect(statement).toContain(
      'order by "edls_sheets"."ymd" desc, "edls_sheets"."id" desc',
    );

    const sameDateIds = Array.from({ length: 201 }, (_, index) =>
      `sheet-${String(index).padStart(3, "0")}`,
    ).sort((left, right) => right.localeCompare(left));
    const firstPage = sameDateIds.slice(0, 100);
    const secondPage = sameDateIds.slice(100, 200);
    const thirdPage = sameDateIds.slice(200);

    expect(new Set([...firstPage, ...secondPage, ...thirdPage]).size).toBe(201);
    expect(firstPage).not.toContain(secondPage[0]);
    expect(secondPage).not.toContain(thirdPage[0]);
  });
});