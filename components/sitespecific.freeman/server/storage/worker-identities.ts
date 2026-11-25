import { eq } from "drizzle-orm";
import { workers } from "@shared/schema";
import { getClient, runInTransaction } from "../../../../server/storage/transaction-context";
import { lockWorkerIdentities } from "../../../../server/storage/workers/identity-read-scope";
import type { WorkerIdStorage } from "../../../../server/storage/workers/ids";
import { t631IdentityValues } from "../../shared/t631-identity";

/** Keep identity resolution/attachment atomic; callers may inject reads in tests. */
export function createFreemanWorkerIdentityStorage(getIds?: () => WorkerIdStorage) {
  async function ids() {
    return getIds?.() ?? (await import("../../../../server/storage/database")).storage.workerIds;
  }
  return {
    async resolveT631Identity(typeId: string, value: string, einTypeId: string, ein: string, dryRun: boolean) {
      return runInTransaction(async () => {
        const client = getClient();
        const reads = await ids();
        if (!dryRun) await lockWorkerIdentities();
        const matches = await reads.getByTypeAndValues(typeId, t631IdentityValues(value));
        if (new Set(matches.map(row => row.workerId)).size > 1) {
          throw new Error("ambiguous_t631_identity: prefixed and numeric IDs belong to different workers");
        }
        const match = matches.find(row => row.value === value) ?? matches[0];
        const holder = ein ? await reads.getWorkerIdByTypeAndValue(einTypeId, ein) : undefined;
        if (match) {
          if (holder && holder.workerId !== match.workerId) throw new Error("ein_conflict: incoming EIN belongs to another worker");
          return { workerId: match.workerId, value: match.value, linked: false };
        }
        if (!holder) return null;
        const query = client.select({ id: workers.id }).from(workers).where(eq(workers.id, holder.workerId));
        const [worker] = await (dryRun ? query : query.for("update"));
        if (!worker) throw new Error("Worker no longer exists.");
        const identities = await reads.getWorkerIdsByWorkerId(holder.workerId);
        if (identities.some(row => row.typeId === typeId)) {
          throw new Error("t631_conflict: EIN-matched worker already has a different T631 ID");
        }
        if (!dryRun) {
          const { storage } = await import("../../../../server/storage/database");
          await storage.workerIds.createWorkerId({ workerId: holder.workerId, typeId, value });
        }
        return { workerId: holder.workerId, value, linked: true };
      });
    },
    async reconcileWorkerId(workerId: string, typeId: string, value: string, dryRun: boolean, source: { typeId: string; value: string }) {
      if (!value.trim()) throw new Error("Cannot reconcile a blank worker ID.");
      return runInTransaction(async () => {
        const client = getClient();
        const reads = await ids();
        if (!dryRun) await lockWorkerIdentities();
        const workerQuery = client.select({ id: workers.id }).from(workers).where(eq(workers.id, workerId));
        const [worker] = await (dryRun ? workerQuery : workerQuery.for("update"));
        if (!worker) throw new Error("Worker no longer exists.");
        const identities = await reads.getWorkerIdsByWorkerId(workerId);
        const sourceRows = identities.filter(row => row.typeId === source.typeId);
        if (sourceRows.length !== 1 || sourceRows[0].value !== source.value) {
          throw new Error("ambiguous_t631_identity: worker's T631 identity changed or is ambiguous");
        }
        const holder = await reads.getWorkerIdByTypeAndValue(typeId, value);
        if (holder && holder.workerId !== workerId) throw new Error("ein_conflict: incoming EIN belongs to another worker");
        const rows = identities.filter(row => row.typeId === typeId);
        const keep = rows.find(row => row.value === value);
        const remove = rows.filter(row => row.id !== keep?.id);
        if (!dryRun) {
          const { storage } = await import("../../../../server/storage/database");
          for (const row of remove) await storage.workerIds.deleteWorkerId(row.id);
          if (!keep) await storage.workerIds.createWorkerId({ workerId, typeId, value });
        }
        return { deleted: remove.length, created: keep ? 0 : 1 };
      });
    },
  };
}
