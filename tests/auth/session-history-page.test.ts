import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { sessionHistoryPagingSchema } from "@shared/session-history";
import { getTabAccessRequirements, userTabTree } from "@shared/tabRegistry";

const context = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => context.client }));
import { createSessionHistoryStorage } from "../../server/storage/system/session-history";

describe("safe user session history pages", () => {
  beforeEach(() => { context.client = undefined; });

  it("scopes count and rows independently, orders ties, and strips credentials before returning", async () => {
    const queries: { sql: string; params: unknown[] }[] = [];
    context.client = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return sql.includes("count(")
        ? { rows: [[3]] }
        : { rows: [
          ["row-b", "2026-10-05 12:00:00", null, "synthetic-cookie-secret", null],
          ["row-a", "2026-10-05 12:00:00", "192.0.2.1", "synthetic-cookie-secret", "Browser/1 (supplied)"],
        ] };
    });
    const page = await createSessionHistoryStorage().getUserPage("target-user", { page: 2, pageSize: 2 });
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.sql).toContain('where "session_history"."user_id" = $1');
      expect(query.params[0]).toBe("target-user");
      expect(query.sql).not.toMatch(/\bor\b|\bjoin\b/i);
    }
    expect(queries[1].sql).toContain('order by "session_history"."timestamp" desc, "session_history"."id" desc');
    expect(queries[1].params).toEqual(["target-user", 2, 2]);
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2, totalPages: 2 });
    expect(page.entries[0].sessionReference).toMatch(/^[a-f0-9]{64}$/);
    expect(page.entries[0].sessionReference).toBe(page.entries[1].sessionReference);
    expect(Object.keys(page.entries[0]).sort()).toEqual(["id", "ip", "sessionReference", "timestamp", "userAgent"]);
    expect(page.entries.map(entry => entry.userAgent)).toEqual([null, "Browser/1 (supplied)"]);
    expect(JSON.stringify(page)).not.toContain("synthetic-cookie-secret");
    expect(queries[1].sql).toContain("jsonb_typeof");
    expect(queries[1].sql).toContain("'{device,user_agent}'");
    expect(queries[1].sql).not.toContain("authenticationSessionReference");
    expect(queries[1].sql).not.toContain("device_id");
    expect(queries[1].sql).not.toMatch(/,\s*"data"\s*(,|from)/);
  });

  it.each([{ page: 0, pageSize: 25 }, { page: 1.5, pageSize: 25 }, { page: 1, pageSize: 101 }, { page: 1, pageSize: 0 }, { page: Number.MAX_SAFE_INTEGER, pageSize: 100 }])(
    "refuses invalid storage paging before querying: %o", async paging => {
      await expect(createSessionHistoryStorage().getUserPage("target", paging)).rejects.toThrow();
    },
  );

  it("has the identical admin/component contract for navigation and direct routes", () => {
    expect(userTabTree.find(tab => tab.id === "session_history")).toMatchObject({
      hrefTemplate: "/users/{id}/session_history", permission: "admin", component: "system.session_history",
    });
    expect(getTabAccessRequirements("user", "session_history")).toMatchObject({
      permission: "admin", component: "system.session_history",
    });
    expect(sessionHistoryPagingSchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });
});
