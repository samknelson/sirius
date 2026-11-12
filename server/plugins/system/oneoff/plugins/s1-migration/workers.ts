import { getClient, runInTransaction } from '../../../../../storage/transaction-context';
import { workers, type Worker } from "@shared/schema";

import { eq, sql } from "drizzle-orm";

import { advanceWorkerSequenceSafely, applySiriusIdOwnershipPlan, readSiriusIdOwnershipSnapshot, type ApplySiriusIdOwnershipPlanInput, type ApplySiriusIdOwnershipPlanResult } from "./sirius-id-ownership";
import type { SiriusIdOwnershipSnapshot } from "./sirius-id-ownership-plan";
import { stripWorkerData } from '../../../../../storage/workers/row-projection';

export interface S1WorkerOperations {

  /** S1-migration only: source workers must supply their authoritative S1
   * ID. Relationship shells explicitly persist a NULL Sirius ID; their UUID
   * remains the relationship identity. */
  createWorkerForMigration(input: {
    siriusId?: string;
    contactId: string;
    ssn: string | null;
    data?: Record<string, unknown> | null;
    kind?: "relationship-shell";
  }): Promise<Worker>;

  /** Read-only source/target ownership evidence for migration preflight and
   * operator diagnostics. */
  getMigrationSiriusIdOwnershipSnapshot(): Promise<SiriusIdOwnershipSnapshot>;

  /** Explicit hash-approved operator repair; ordinary loaders never call it. */
  applyMigrationSiriusIdOwnershipPlan(input: ApplySiriusIdOwnershipPlanInput): Promise<ApplySiriusIdOwnershipPlanResult>;

  /** S1-migration only: absorb a stub worker created by an earlier loader —
   * stamps the real sirius_id / ssn / data onto the existing row. */
  updateWorkerForMigration(workerId: string, updates: { siriusId?: string; contactId?: string; ssn?: string | null; data?: Record<string, unknown> | null }): Promise<Worker | undefined>;
}

export function createS1WorkerOperations(): S1WorkerOperations {
  return {

    async createWorkerForMigration(input: {
      siriusId?: string;
      contactId: string;
      ssn: string | null;
      data?: Record<string, unknown> | null;
      kind?: "relationship-shell";
    }): Promise<Worker> {
      return runInTransaction(async () => {
        const isRelationshipShell = input.kind === "relationship-shell";
        if (!isRelationshipShell && input.siriusId == null) {
          throw new Error("Migration source workers require an authoritative Sirius ID; no generated replacement is allowed.");
        }
        if (isRelationshipShell && input.siriusId != null) {
          throw new Error("Relationship shell workers must retain a NULL Sirius ID.");
        }
        // Keep an explicit authoritative import serial-safe for a later S2
        // cutover. Shells do not take this lock because they never consume or
        // advance the sequence.
        if (!isRelationshipShell) {
          await getClient().execute(sql`LOCK TABLE workers IN EXCLUSIVE MODE`);
        }
        const data = isRelationshipShell
          ? {
              ...(input.data ?? {}),
              migrationShell: true,
            }
          : input.data ?? null;
        const [worker] = await getClient()
          .insert(workers)
          // Explicit NULL is critical: after S2 cutover the database default
          // allocates omitted values, but a migration relationship shell must
          // never receive one.
          .values({
            siriusId: isRelationshipShell ? null : input.siriusId!,
            contactId: input.contactId,
            ssn: input.ssn,
            data,
          })
          .returning();
        if (!isRelationshipShell) await advanceWorkerSequenceSafely();
        return stripWorkerData(worker);
      });
    },

    async getMigrationSiriusIdOwnershipSnapshot(): Promise<SiriusIdOwnershipSnapshot> {
      return readSiriusIdOwnershipSnapshot();
    },

    async applyMigrationSiriusIdOwnershipPlan(
      input: ApplySiriusIdOwnershipPlanInput,
    ): Promise<ApplySiriusIdOwnershipPlanResult> {
      return applySiriusIdOwnershipPlan(input);
    },

    async updateWorkerForMigration(workerId: string, updates: { siriusId?: string; contactId?: string; ssn?: string | null; data?: Record<string, unknown> | null }): Promise<Worker | undefined> {
      const client = getClient();
      const set: Record<string, unknown> = {};
      if (updates.siriusId !== undefined) set.siriusId = updates.siriusId;
      if (updates.contactId !== undefined) set.contactId = updates.contactId;
      if (updates.ssn !== undefined) set.ssn = updates.ssn;
      if (updates.data !== undefined) set.data = updates.data;
      if (Object.keys(set).length === 0) {
        const [w] = await client.select().from(workers).where(eq(workers.id, workerId));
        return w ? stripWorkerData(w) : undefined;
      }
      const [worker] = await client
        .update(workers)
        .set(set)
        .where(eq(workers.id, workerId))
        .returning();
      return worker ? stripWorkerData(worker) : undefined;
    }
  };
}

export const s1Workers = createS1WorkerOperations();
