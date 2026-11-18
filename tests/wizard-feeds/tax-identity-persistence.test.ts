import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { contacts, workers } from "../../shared/schema";
import { ALTERNATE_TAX_ID } from "../../shared/utils/worker-tax-identity";
import { db } from "../../server/storage/db";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { createWorkerIdStorage } from "../../server/storage/workers/ids";
import { claimTaxWorker, ensureAlternateTaxIdType, type TaxIdentityWriter } from "../../server/storage/workers/tax-identity";

// Real Postgres constraints + savepoints exercise the rollback/concurrent-claim
// invariant, not a mocked implementation of transaction behaviour.
const prefix = `tax-identity-test-${randomUUID()}`;
const ids = createWorkerIdStorage();
const reader: TaxIdentityWriter = {
  workers: {
    getWorkerBySSN: async value => (await getClient().select().from(workers).where(eq(workers.ssn, value)))[0],
    getWorker: async id => (await getClient().select().from(workers).where(eq(workers.id, id)))[0],
    createWorker: async name => {
      const [contact] = await getClient().insert(contacts).values({ displayName: name }).returning();
      return (await getClient().insert(workers).values({ contactId: contact.id }).returning())[0];
    },
    updateWorkerSSN: async (id, ssn) => (await getClient().update(workers).set({ ssn }).where(eq(workers.id, id)).returning())[0],
  },
  workerIds: ids,
};
const value = `T${randomUUID()}`;
beforeAll(ensureAlternateTaxIdType);
afterAll(async () => { await db.delete(contacts).where(like(contacts.displayName, `${prefix}%`)); });
describe("atomic alternate identity persistence", () => {
  it("concurrent claims create one worker/contact and reimports find it", async () => {
    const results = await Promise.all([
      claimTaxWorker(reader, value, `${prefix}-concurrent`, "create"),
      claimTaxWorker(reader, value, `${prefix}-concurrent`, "create"),
    ]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results[0].worker.id).toBe(results[1].worker.id);
    expect(results[0].worker.ssn).toBeNull();
    expect(await db.select().from(contacts).where(eq(contacts.displayName, `${prefix}-concurrent`))).toHaveLength(1);
    const edited = await ids.getWorkerIdsByWorkerId(results[0].worker.id, true);
    await ids.updateWorkerId(edited[0].id, { value: `  ${value}  ` });
    expect((await claimTaxWorker(reader, value, prefix, "update")).created).toBe(false);
    // Correcting the SSN does not remove the alternate, and a later alternate
    // import never overwrites the corrected valid SSN.
    await reader.workers.updateWorkerSSN(results[0].worker.id, "321547698");
    expect((await claimTaxWorker(reader, value, prefix, "create")).worker.ssn).toBe("321547698");
    expect(await ids.getWorkerIdsByWorkerId(results[0].worker.id)).toEqual([]);
    expect(await ids.getWorkerIdsByTypeForWorkerIds(ALTERNATE_TAX_ID, [results[0].worker.id])).toEqual([]);
  });
  it("unmatched update, placeholders and failed attachment leave no orphan contact", async () => {
    const before = await db.select().from(contacts).where(like(contacts.displayName, `${prefix}%`));
    await expect(claimTaxWorker(reader, `T${randomUUID()}`, prefix, "update")).rejects.toThrow("No worker");
    await expect(claimTaxWorker(reader, "000-00-0000", prefix, "create")).rejects.toThrow("placeholder");
    const failing: TaxIdentityWriter = { ...reader, workerIds: { ...ids, createWorkerId: async () => { throw new Error("failed attachment"); } } };
    // A caller-owned transaction can continue after the nested claim rolls back.
    await runInTransaction(async () => {
      await expect(claimTaxWorker(failing, `T${randomUUID()}`, prefix, "create")).rejects.toThrow("could not be saved");
      expect(await getClient().select().from(contacts).where(like(contacts.displayName, `${prefix}%`))).toHaveLength(before.length);
    });
  });
  it("enforces normalization and uniqueness on manual edits without reassigning IDs", async () => {
    const input = `0${Date.now()}01`;
    const first = await claimTaxWorker(reader, input, `${prefix}-manual`, "create");
    expect((await claimTaxWorker(reader, `${input.slice(0, 3)}-${input.slice(3)}`, prefix, "create")).worker.id).toBe(first.worker.id);
    const second = await claimTaxWorker(reader, `T${randomUUID()}`, `${prefix}-second`, "create");
    await expect(ids.createWorkerId({ workerId: second.worker.id, typeId: ALTERNATE_TAX_ID, value: input })).rejects.toThrow("already belong");
    const [id] = await ids.getWorkerIdsByWorkerId(first.worker.id, true);
    await expect(ids.updateWorkerId(id.id, { workerId: second.worker.id })).rejects.toThrow("reassign");
    await expect(ids.updateWorkerId(id.id, { value: "999-99-9999" })).rejects.toThrow("placeholder");
    expect((await ids.getWorkerId(id.id, true))?.workerId).toBe(first.worker.id);
  });
  it("rolls back a real unique-constraint failure without poisoning the caller's transaction", async () => {
    const claimedValue = `T${randomUUID()}`;
    await claimTaxWorker(reader, claimedValue, `${prefix}-original`, "create");
    const staleReader: TaxIdentityWriter = {
      ...reader, workerIds: { ...ids, getWorkerIdByTypeAndValue: async () => undefined },
    };
    await runInTransaction(async () => {
      await expect(claimTaxWorker(staleReader, claimedValue, `${prefix}-losing-claim`, "create")).rejects.toThrow("could not be saved");
      expect(await getClient().select().from(contacts).where(eq(contacts.displayName, `${prefix}-losing-claim`))).toEqual([]);
    });
  });
  it("does not link a new SSN-only row to an alternate-only record", async () => {
    const alternate = await claimTaxWorker(reader, `T${randomUUID()}`, `${prefix}-same-name`, "create");
    const ssn = await claimTaxWorker(reader, "412387695", `${prefix}-same-name`, "create");
    expect(ssn.worker.id).not.toBe(alternate.worker.id);
    expect((await reader.workers.getWorker(alternate.worker.id))?.ssn).toBeNull();
  });
});
