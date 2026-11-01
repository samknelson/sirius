import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";
import { getTableColumns } from "drizzle-orm";
import { users, insertUserSchema, upsertUserSchema, createUserSchema } from "../../shared/schema";
import { AmbiguousUserEmailError, isUserEmailConflict } from "../../shared/utils/user-email";

// An arbitrary account match would silently link the wrong identity or roles.
// Exercise the shared storage boundary without a database or server.
const state = vi.hoisted(() => ({
  client: undefined as any,
  rows: [] as any[],
  queries: [] as { sql: string; params: unknown[] }[],
  error: undefined as unknown,
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runInTransaction: (fn: () => unknown) => fn(),
  runOutsideTransaction: (fn: () => unknown) => fn(),
  onAfterCommit: vi.fn(),
}));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn() } }));
import { createUserStorage } from "../../server/storage/users";

beforeEach(() => {
  state.rows = [];
  state.queries = [];
  state.error = undefined;
  state.client = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    if (state.error) throw state.error;
    return { rows: state.rows.map(row => Object.keys(getTableColumns(users)).map(key => row[key] ?? null)) };
  });
});

describe("user email identity boundary", () => {
  it("refuses ambiguous accounts rather than selecting the first", async () => {
    state.rows = [{ id: "b", email: "Owner@example.com" }, { id: "a", email: "owner@example.com" }];
    await expect(createUserStorage().getUserByEmail(" Owner@EXAMPLE.com "))
      .rejects.toMatchObject({ name: "AmbiguousUserEmailError", accountIds: ["a", "b"] });
    expect(state.queries[0].params).toEqual(["Owner@EXAMPLE.com"]);
    expect(state.queries[0].sql).toContain('lower(nullif(btrim("users"."email"), \'\'::text))');
    expect(state.queries[0].sql).not.toContain("limit");
  });

  it("returns only an unambiguous match and never looks up a blank account", async () => {
    const storage = createUserStorage();
    await expect(storage.getUserByEmail(" \t ")).resolves.toBeUndefined();
    await expect(storage.hasOtherUserWithEmail(" ", "owner")).resolves.toBe(false);
    expect(state.queries).toEqual([]);
    state.rows = [{ id: "owner", email: "Owner@example.com" }];
    await expect(storage.getUserByEmail("owner@example.com")).resolves.toMatchObject({ id: "owner" });
  });

  it.each(["create", "upsert", "update"] as const)("normalizes %s at storage, including direct callers", async operation => {
    state.rows = [{ id: "owner", email: "Owner@example.com" }];
    const storage = createUserStorage();
    if (operation === "create") await storage.createUser({ email: " Owner@example.com " });
    if (operation === "upsert") await storage.upsertUser({ id: "owner", email: " Owner@example.com " });
    if (operation === "update") await storage.updateUser("owner", { email: " Owner@example.com " });
    const write = state.queries.find(q => /^(insert|update)/i.test(q.sql))!;
    expect(write.params).toContain("Owner@example.com");
    expect(write.params).not.toContain(" Owner@example.com ");
    if (operation === "upsert") expect(write.sql).toContain('on conflict ("id")');
  });

  it.each(["create", "upsert", "update"] as const)("propagates an email conflict from %s without recovery by email", async operation => {
    state.error = { code: "23505", constraint: "users_email_normalized_unique" };
    const storage = createUserStorage();
    const promise = operation === "create" ? storage.createUser({ email: "Owner@example.com" })
      : operation === "upsert" ? storage.upsertUser({ id: "new", email: "Owner@example.com" })
      : storage.updateUser("owner", { email: "Owner@example.com" });
    await expect(promise).rejects.toSatisfy(isUserEmailConflict);
    expect(state.queries.filter(q => q.sql.includes("lower(nullif"))).toHaveLength(0);
  });

  it("trims shared inputs without clearing an omitted email in partial edits", () => {
    for (const schema of [insertUserSchema, upsertUserSchema, createUserSchema]) {
      expect(schema.parse({ email: " Owner@example.com " }).email).toBe("Owner@example.com");
    }
    expect(insertUserSchema.partial().parse({ firstName: "Name" })).not.toHaveProperty("email");
  });

  it("identifies only user-email constraints, including wrapped database errors", () => {
    expect(isUserEmailConflict({ cause: { code: "23505", constraint: "users_email_normalized_unique" } })).toBe(true);
    expect(isUserEmailConflict({ code: "23505", constraint: "users_pkey" })).toBe(false);
    expect(isUserEmailConflict({ code: "23505", constraint: "contacts_email_normalized_unique" })).toBe(false);
    expect(new AmbiguousUserEmailError(["a", "b"]).message).toContain("No account was selected");
  });
});
