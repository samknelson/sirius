import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { createBulkParticipantStorage } from "../../server/storage/bulk/participants";

const mocks = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: mocks.getClient }));

describe("bulk participant insert-once storage", () => {
  it("claims the contact/channel pair atomically without updating existing delivery state", async () => {
    const db = drizzle.mock();
    let captured: { toSQL(): { sql: string; params: unknown[] } } | undefined;
    const row = { id: "new" };
    mocks.getClient.mockReturnValue({
      insert(table: PgTable) {
        const insert = db.insert(table);
        return {
          values(data: Parameters<typeof insert.values>[0]) {
            return {
              onConflictDoNothing(config: Parameters<ReturnType<typeof insert.values>["onConflictDoNothing"]>[0]) {
                const query = insert.values(data).onConflictDoNothing(config).returning();
                query.execute = vi.fn(async () => [row] as Awaited<ReturnType<typeof query.execute>>);
                captured = query;
                return { returning: () => query };
              },
            };
          },
        };
      },
    });
    const storage = createBulkParticipantStorage();
    expect(await storage.createIfMissing({ messageId: "message", contactId: "contact", medium: "postal" }))
      .toEqual(row);
    const query = captured!.toSQL();
    expect(query.sql).toContain('on conflict ("message_id","contact_id","medium") do nothing');
    expect(query.sql).not.toContain("do update");
    expect(query.sql).toContain("returning");
    expect(query.params).toEqual(expect.arrayContaining(["message", "contact", "postal"]));
  });

  it("returns no new participant when a concurrent request has already claimed the pair", async () => {
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    mocks.getClient.mockReturnValue({
      insert: () => ({ values: () => ({ onConflictDoNothing }) }),
    });
    expect(await createBulkParticipantStorage().createIfMissing({
      messageId: "message", contactId: "contact", medium: "email",
    })).toBeUndefined();
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(returning).toHaveBeenCalledOnce();
  });
});
