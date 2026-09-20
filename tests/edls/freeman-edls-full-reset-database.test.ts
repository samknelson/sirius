import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  comm,
  commSms,
  contactPostal,
  contacts,
  facilities,
  phoneNumbers,
  workers,
} from "../../shared/schema";
import { db } from "../../server/storage/db";
import { runWithTransaction } from "../../server/storage/transaction-context";

const emit = vi.fn(async () => {});
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit },
  EventType: { WORKER_DELETE_AFTER: "WORKER_DELETE_AFTER" },
}));

const {
  createFreemanEdlsFullResetStorage,
  lockFreemanEdlsFullResetTables,
} = await import(
  "../../server/storage/sitespecific/freeman/edls-full-reset"
);

const ROLLBACK = new Error("rollback Freeman full-reset database test");

describe("Freeman EDLS full reset database behavior", () => {
  it("retains communication rows while removing worker contact PII", async () => {
    try {
      await db.transaction(async (tx) => runWithTransaction(tx, async () => {
        await lockFreemanEdlsFullResetTables();
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

  it("preserves a facility contact intact while deleting its worker", async () => {
    try {
      await db.transaction(async (tx) => runWithTransaction(tx, async () => {
        await lockFreemanEdlsFullResetTables();
        const [contact] = await tx.insert(contacts).values({
          displayName: "Facility Contact Fixture",
          given: "Facility",
          family: "Fixture",
          email: `facility-reset-${crypto.randomUUID()}@invalid.example`,
        }).returning();
        const [worker] = await tx.insert(workers).values({
          contactId: contact.id,
        }).returning();
        const [facility] = await tx.insert(facilities).values({
          name: "Main Hall",
          contactId: contact.id,
        }).returning();
        const [postal] = await tx.insert(contactPostal).values({
          contactId: contact.id,
          friendlyName: "Main Hall mailing",
          street: "123 Main Street",
          city: "Boston",
          state: "MA",
          postalCode: "02108",
          country: "US",
          isPrimary: true,
        }).returning();
        const [phone] = await tx.insert(phoneNumbers).values({
          contactId: contact.id,
          friendlyName: "Main Hall office",
          phoneNumber: "+15555550101",
          isPrimary: true,
        }).returning();

        const storage = createFreemanEdlsFullResetStorage();
        const plan = await storage.getPlan();
        expect(plan.preservations).toEqual(expect.arrayContaining([
          expect.objectContaining({
            workerId: worker.id,
            workerName: "Facility Contact Fixture",
            contactId: contact.id,
            contactName: "Facility Contact Fixture",
            referencingTable: "facilities",
            recordId: facility.id,
            label: "Main Hall",
            disposition: "intact",
          }),
        ]));

        const result = await storage.execute(plan);
        expect(result.contactsPreserved).toBeGreaterThanOrEqual(1);
        expect(await tx.select().from(workers).where(eq(workers.id, worker.id))).toEqual([]);
        expect(await tx.select().from(facilities).where(eq(facilities.id, facility.id))).toHaveLength(1);
        expect(await tx.select().from(contactPostal).where(eq(contactPostal.id, postal.id))).toEqual([
          expect.objectContaining({
            street: "123 Main Street",
            city: "Boston",
            postalCode: "02108",
          }),
        ]);
        expect(await tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, phone.id))).toEqual([
          expect.objectContaining({
            phoneNumber: "+15555550101",
            friendlyName: "Main Hall office",
          }),
        ]);
        expect(await tx.select().from(contacts).where(eq(contacts.id, contact.id))).toEqual([
          expect.objectContaining({
            displayName: "Facility Contact Fixture",
            given: "Facility",
            family: "Fixture",
          }),
        ]);

        throw ROLLBACK;
      }));
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });

  it("reports the concrete worker identity for a catalog-discovered blocker", async () => {
    try {
      await db.transaction(async (tx) => runWithTransaction(tx, async () => {
        await lockFreemanEdlsFullResetTables();
        const [contact] = await tx.insert(contacts).values({
          displayName: "Blocked Worker Fixture",
        }).returning();
        const [worker] = await tx.insert(workers).values({
          contactId: contact.id,
        }).returning();
        await tx.execute(sql`
          CREATE TABLE full_reset_worker_blocker_fixture (
            id varchar PRIMARY KEY,
            worker_id varchar NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
            name text NOT NULL
          )
        `);
        await tx.execute(sql`
          INSERT INTO full_reset_worker_blocker_fixture (id, worker_id, name)
          VALUES ('blocker-record', ${worker.id}, 'Required payroll record')
        `);
        const storage = createFreemanEdlsFullResetStorage();
        const plan = await storage.getPlan();
        expect(plan.blockers).toEqual(expect.arrayContaining([
          expect.objectContaining({
            workerId: worker.id,
            workerName: "Blocked Worker Fixture",
            contactId: contact.id,
            contactName: "Blocked Worker Fixture",
            referencingTable: "full_reset_worker_blocker_fixture",
            recordId: "blocker-record",
            label: "Required payroll record",
            disposition: "blocker",
          }),
        ]));
        await expect(storage.execute(plan)).rejects.toMatchObject({
          name: "FreemanEdlsFullResetRelationshipError",
          entity: "worker",
          metadata: expect.objectContaining({
            table: "full_reset_worker_blocker_fixture",
            recordId: "blocker-record",
            workerId: worker.id,
            contactId: contact.id,
          }),
        });

        throw ROLLBACK;
      }));
    } catch (error) {
      if (error !== ROLLBACK) throw error;
    }
  });
});