import { withStorageLogging } from '../../../../../storage/middleware/logging';
import { getClient, runInTransaction } from '../../../../../storage/transaction-context';
import { workerTrustElections, type WorkerTrustElection, type EnrollmentType } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { defineLoggingConfig } from '../../../../../storage/middleware/logging';

import { validateElection, emitTrustElectionSaved, describeElection, ElectionBeforeState } from '../../../../../storage/trust/elections';

export interface MigrationElectionInput {
  workerId: string;
  employerId: string;
  startYmd: string;
  endYmd?: string | null;
  benefitIds?: string[] | null;
  relationshipIds?: string[] | null;
  enrollmentType?: EnrollmentType | null;
  data?: Record<string, unknown> | null;
}
export interface S1WorkerTrustElectionsOperations {
getById(id: string): Promise<WorkerTrustElection | undefined>;

  /**
   * MIGRATION-ONLY create (S1→S2 T16 loader; cf. createWorkerForMigration).
   * Historical elections must land VERBATIM: unlike `create`, this skips the
   * dual-coverage assert and never auto-end-dates a prior open election —
   * S1 is the system of record for its own history, and rewriting or
   * rejecting it here would corrupt the import. FK existence and the
   * end-after-start contract are still enforced, and TRUST_ELECTION_SAVED
   * still fires after commit so denorm listeners observe the row. Never call
   * this from application code — wizard/API paths must use `create`.
   */
  createForMigration(input: MigrationElectionInput): Promise<WorkerTrustElection>;

  /**
   * MIGRATION-ONLY update (S1→S2 T16 daily sync reconcile). During the
   * dual-run S1 stays the system of record: when a mapped S1 election is
   * edited there, the S2 row is overwritten VERBATIM with the re-resolved
   * shape. Like createForMigration this skips the dual-coverage assert and
   * never auto-end-dates other open elections; FK existence and the
   * end-after-start contract are still enforced via validateElection.
   * Emits TRUST_ELECTION_SAVED for the new shape, and additionally for the
   * pre-update worker/range when they changed (retargets move the election
   * between workers, not just between dates) so denorm listeners recompute
   * months only the old shape covered. Never call from application code —
   * staff edits must use `update`.
   */
  updateForMigration(id: string, input: MigrationElectionInput): Promise<WorkerTrustElection | undefined>;
}

export function createS1WorkerTrustElectionsOperations(): S1WorkerTrustElectionsOperations {
  return {
async getById(id: string) { const [row] = await getClient().select().from(workerTrustElections).where(eq(workerTrustElections.id,id)); return row; },

    // MIGRATION-ONLY — see interface doc. Verbatim historical insert: no
    // dual-coverage assert, no auto-end of prior open elections. FK + date
    // contract still enforced via validateElection.
    async createForMigration(input) {
      const validated = await validateElection({
        workerId: input.workerId,
        employerId: input.employerId,
        policyId: null,
        startYmd: input.startYmd,
        endYmd: input.endYmd ?? null,
      });
      return await runInTransaction(async () => {
        const client = getClient();
        const [created] = await client
          .insert(workerTrustElections)
          .values({
            workerId: validated.workerId,
            employerId: validated.employerId,
            policyId: null,
            startYmd: validated.startYmd,
            endYmd: validated.endYmd,
            benefitIds: input.benefitIds ?? null,
            relationshipIds: input.relationshipIds ?? null,
            enrollmentType: input.enrollmentType ?? null,
            data: (input.data ?? null) as WorkerTrustElection['data'],
          })
          .returning();
        emitTrustElectionSaved(
          created.id,
          created.workerId,
          (created.enrollmentType ?? null) as EnrollmentType | null,
          'created',
          created.startYmd,
          created.endYmd ?? null,
        );
        return created;
      });
    },

    // MIGRATION-ONLY — see interface doc. Verbatim S1-wins overwrite: no
    // dual-coverage assert, no auto-end of prior open elections. FK + date
    // contract still enforced via validateElection.
    async updateForMigration(id, input) {
      const validated = await validateElection({
        workerId: input.workerId,
        employerId: input.employerId,
        policyId: null,
        startYmd: input.startYmd,
        endYmd: input.endYmd ?? null,
      });
      return await runInTransaction(async () => {
        const client = getClient();
        const [existing] = await client
          .select()
          .from(workerTrustElections)
          .where(eq(workerTrustElections.id, id));
        if (!existing) return undefined;
        const [updated] = await client
          .update(workerTrustElections)
          .set({
            workerId: validated.workerId,
            employerId: validated.employerId,
            policyId: null,
            startYmd: validated.startYmd,
            endYmd: validated.endYmd,
            benefitIds: input.benefitIds ?? null,
            relationshipIds: input.relationshipIds ?? null,
            enrollmentType: input.enrollmentType ?? null,
            data: (input.data ?? null) as WorkerTrustElection['data'],
          })
          .where(eq(workerTrustElections.id, id))
          .returning();
        emitTrustElectionSaved(
          updated.id,
          updated.workerId,
          (updated.enrollmentType ?? null) as EnrollmentType | null,
          'updated',
          updated.startYmd,
          updated.endYmd ?? null,
        );
        // Also emit the pre-update shape when the covered worker OR range
        // changed — months only the old shape covered must be recomputed.
        if (
          existing.workerId !== updated.workerId ||
          existing.startYmd !== updated.startYmd ||
          existing.endYmd !== updated.endYmd
        ) {
          emitTrustElectionSaved(
            existing.id,
            existing.workerId,
            (existing.enrollmentType ?? null) as EnrollmentType | null,
            'updated',
            existing.startYmd,
            existing.endYmd ?? null,
          );
        }
        return updated;
      });
    }
  };
}

const loggingConfig = defineLoggingConfig<S1WorkerTrustElectionsOperations>({module: 'worker-trust-elections',
table: 'worker_trust_elections',
hostTable: 'workers',
state: { key: 'election' },
getter: 'getById',
hostEntityId: (args, result, before) =>
    (before as ElectionBeforeState | undefined)?.election?.workerId
    ?? result?.workerId
    ?? args[0], methods: {
    updateForMigration: {
      getDescription: async (_args, result, beforeState) => {
        const r = result || (beforeState as ElectionBeforeState | undefined)?.election;
        return `Updated trust election (S1 sync) for ${await describeElection(r?.workerId, r?.startYmd)}`;
      },
    }}});

export const s1Elections = withStorageLogging(createS1WorkerTrustElectionsOperations(), loggingConfig);
