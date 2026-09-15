import { afterEach, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";

const createdWorkerIds: string[] = [];

afterEach(async () => {
  for (const workerId of createdWorkerIds.splice(0)) {
    await storage.workers.deleteWorker(workerId).catch(() => undefined);
  }
});

describe("worker/contact cascading deletion lock order", () => {
  it("serializes concurrent worker and owning-contact deletion without deadlock", async () => {
    const worker = await storage.workers.createWorker(`contact-delete-lock-${Date.now()}`);
    createdWorkerIds.push(worker.id);

    const outcome = await Promise.race([
      Promise.allSettled([
        storage.workers.deleteWorker(worker.id),
        storage.contacts.deleteContact(worker.contactId),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("concurrent worker/contact delete did not settle")), 10_000),
      ),
    ]);

    expect(outcome).toHaveLength(2);
    expect(outcome.every((result) => result.status === "fulfilled")).toBe(true);
    expect(outcome.filter((result) => result.status === "fulfilled" && result.value).length).toBe(1);
  }, 20_000);
});