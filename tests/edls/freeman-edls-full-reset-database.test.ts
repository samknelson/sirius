import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  comm,
  commSms,
  contacts,
  workers,
} from "../../shared/schema";
import { db } from "../../server/storage/db";
import { runWithTransaction } from "../../server/storage/transaction-context";

const emit = vi.fn(async () => {});
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit },
  EventType: { WORKER_DELETE_AFTER: "WORKER_DELETE_AFTER" },
}));

const { createFreemanEdlsFullResetStorage } = await import(
  "../../server/storage/sitespecific/freeman/edls-full-reset"
);

const ROLLBACK = new Error("rollback Freeman full-reset database test");

describe("Freeman EDLS full reset database behavior", () => {
  it("retains communication rows while removing worker contact PII", async () => {
    try {
      await db.transaction(async (tx) => runWithTransaction(tx, async () => {
        const [contact] = await tx.insert(contacts).values({
          displayName: "Reset Database Fixture",
          given: "Reset",
          family: "Fixture",
          email: `reset-fixture-${crypto.randomUUID()}@invalid.example`,
        }).returning();
        const [worker] = await tx.insert(workers).values({
          contactId: contact.id,
        }).returning();
        const [communication] = await tx.insert(comm).values({
          medium: "sms",
          contactId: contact.id,
          status: "sent",
        }).returning();
        const [sms] = await tx.insert(commSms).values({
          commId: communication.id,
          to: "+15555550100",
          body: "retained history",
        }).returning();

        const storage = createFreemanEdlsFullResetStorage();
        const counts = await storage.getCounts();
        const result = await storage.execute(counts);

        expect(result.workers).toBeGreaterThanOrEqual(1);
        expect(result.contactsAnonymized).toBeGreaterThanOrEqual(1);
        expect(await tx.select().from(workers).where(eq(workers.id, worker.id))).toEqual([]);
        expect(await tx.select().from(comm).where(eq(comm.id, communication.id))).toHaveLength(1);
        expect(await tx.select().from(commSms).where(eq(commSms.id, sms.id))).toHaveLength(1);

        const [retainedContact] = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.id, contact.id));
        expect(retainedContact).toMatchObject({
          displayName: "Deleted worker",
          given: null,
          family: null,
          email: null,
        });

        throw ROLLBACK;
      }));
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });
});