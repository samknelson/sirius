import { getClient, runInTransaction } from '../../../../../storage/transaction-context';

import { workerRelations, type WorkerRelation, type InsertWorkerRelation } from '@shared/schema';
import { eq } from 'drizzle-orm';

import { validateRelation, assertNoDuplicateRelation, emitWorkerRelationSaved, enqueueRoleHistoryInvalidations, sourcedWmbWorkerIds } from '../../../../../storage/workers/relations';

export interface S1WorkerRelationsOperations {

  /**
   * Migration-only reconciliation path. Unlike the normal staff-facing
   * update contract, this may retarget worker endpoints when S1 identity
   * resolution changes (for example, replacing a migration shell with the
   * real worker). The HTTP routes never expose this method.
   */
  reconcileFromMigration(id: string, data: Partial<InsertWorkerRelation>): Promise<WorkerRelation | undefined>;
}

export function createS1WorkerRelationsOperations(): S1WorkerRelationsOperations {
  return {

    async reconcileFromMigration(id: string, data: Partial<InsertWorkerRelation>): Promise<WorkerRelation | undefined> {
      return runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client.select().from(workerRelations).where(eq(workerRelations.id, id));
        if (!existing) return undefined;
        const sourcedWorkerIds = await sourcedWmbWorkerIds(id);

      // Reuse every normal relation invariant (endpoint existence/distinctness,
      // relation type, dates, and overlap). The only difference from update()
      // is that migration reconciliation may replace worker_1/worker_2.
      const validated = await validateRelation(data, existing);
      await assertNoDuplicateRelation(validated, id);

      const updateValues: Partial<InsertWorkerRelation> = {
        worker1: validated.worker1,
        worker2: validated.worker2,
        relationType: validated.relationType,
        startYmd: validated.startYmd,
        endYmd: validated.endYmd,
      };
      if (data.data !== undefined) updateValues.data = data.data;

      const [updated] = await client
        .update(workerRelations)
        .set(updateValues)
        .where(eq(workerRelations.id, id))
        .returning();
      if (updated) {
        // Retargeting must rescan both the old and new endpoint scopes, just as
        // moving the date range must rescan both the old and new periods.
        const scopeChanged =
          existing.worker1 !== updated.worker1 ||
          existing.worker2 !== updated.worker2 ||
          existing.startYmd !== updated.startYmd ||
          existing.endYmd !== updated.endYmd;
        if (scopeChanged) emitWorkerRelationSaved(existing, 'updated');
        emitWorkerRelationSaved(updated, 'updated');
      }
        if (updated) {
          await enqueueRoleHistoryInvalidations([
            existing.worker1, existing.worker2, updated.worker1, updated.worker2, ...sourcedWorkerIds,
          ]);
        }
        return updated;
      });
    }
  };
}

export const s1Relations = createS1WorkerRelationsOperations();
