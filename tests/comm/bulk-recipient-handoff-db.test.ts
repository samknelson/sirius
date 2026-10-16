import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getEnvironmentVariable } from "../../server/config/env-registry";
import type { IStorage } from "../../server/storage";

const state = vi.hoisted(() => ({ client: undefined as any }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => state.client,
  runInTransaction: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: vi.fn() }));
vi.mock("../../server/services/access-policy-evaluator", () => ({ checkAccess: vi.fn() }));
import { createBulkMessageStorage } from "../../server/storage/bulk/messages";
import { createBulkParticipantStorage } from "../../server/storage/bulk/participants";
import { handoffBulkRecipients } from "../../server/services/bulk-recipient-handoff";

const url = getEnvironmentVariable("DATABASE_URL");
const isLocalDevelopment = url && ["helium", "localhost", "127.0.0.1"].includes(new URL(url).hostname)
  && getEnvironmentVariable("NODE_ENV") !== "production";

describe.skipIf(!isLocalDevelopment)("draft handoff on the development database", () => {
  it("uses compatible storage SQL, deduplicates, closes delivery permanently and rolls back on failure", async () => {
    const { db, pool } = await import("../../server/storage/db");
    const rollback = new Error("rollback isolated bulk fixture");
    try {
      await db.transaction(async tx => {
        state.client = tx;
        // Clone the actual target shape/indexes, with no production FK targets.
        await tx.execute(sql`CREATE TEMP TABLE bulk_messages (LIKE public.bulk_messages INCLUDING ALL) ON COMMIT DROP`);
        await tx.execute(sql`CREATE TEMP TABLE bulk_participants (LIKE public.bulk_participants INCLUDING ALL) ON COMMIT DROP`);
        const bulkMessages = createBulkMessageStorage();
        const bulkParticipants = createBulkParticipantStorage();
        const storage = { bulkMessages, bulkParticipants, contacts: {
          getExistingIds: async (ids: string[]) => ids.filter(id => !id.startsWith("missing")),
        } } as unknown as IStorage;
        const input = { name: "No-send isolated fixture", medium: ["email", "postal"], contactIds: ["fixture-a", "fixture-a", "fixture-b"], hasReportSelection: false };
        const created = await handoffBulkRecipients(storage, input);
        expect(created).toMatchObject({ recipientsResolved: 2, participantsCreated: 4 });
        const id = created.bulkMessage.id;
        const repeated = await handoffBulkRecipients(storage, { ...input, bulkMessageId: id });
        expect(repeated).toMatchObject({ participantsCreated: 0, participantsSkipped: 4 });
        expect((await bulkMessages.getEligibleDrafts()).map(row => row.id)).toContain(id);
        const initialCount = (await tx.execute(sql`SELECT count(*)::int AS n FROM bulk_messages`)).rows[0].n;
        await expect(handoffBulkRecipients(storage, { ...input, contactIds: ["fixture-a", "missing-contact"] })).rejects.toMatchObject({ status: 400 });
        expect((await tx.execute(sql`SELECT count(*)::int AS n FROM bulk_messages`)).rows[0].n).toBe(initialCount);
        await bulkMessages.markDeliveryStarted(id);
        // Settings saves and participant deletion cannot clear the seal.
        await bulkMessages.update(id, { data: { offline: true } });
        await tx.execute(sql`DELETE FROM bulk_participants WHERE message_id = ${id}`);
        expect((await bulkMessages.getById(id))?.data).toMatchObject({ recipientDeliveryStarted: true, offline: true });
        expect((await bulkMessages.getEligibleDrafts()).map(row => row.id)).not.toContain(id);
        await expect(handoffBulkRecipients(storage, { ...input, bulkMessageId: id })).rejects.toMatchObject({ status: 409 });
        for (const status of ["queued", "sent"] as const) {
          const other = await bulkMessages.create({ name: "Not eligible", status, medium: ["email"] });
          await expect(handoffBulkRecipients(storage, { ...input, bulkMessageId: other.id })).rejects.toMatchObject({ status: 409 });
        }
        throw rollback;
      }).catch(error => { if (error !== rollback) throw error; });
    } finally {
      await pool.end();
    }
  });
});
