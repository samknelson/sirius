import { randomUUID } from "crypto";
import { getClient } from '../transaction-context';
import {
  workerAat,
  type WorkerAat,
} from "@shared/schema";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Storage for the `worker.aat` component's single per-worker access-token row.
 *
 * The table holds at most one row per worker (named unique on `worker_id`),
 * so every write is a create-or-update keyed by worker rather than by row id.
 */
export interface WorkerAatStorage {
  /** The worker's access-token row, or undefined when none has been issued. */
  getByWorker(workerId: string): Promise<WorkerAat | undefined>;
  /**
   * The worker holding this access UUID, or undefined when nobody does.
   *
   * A blank or absent value is nobody's token: the column is nullable and an
   * empty string normalizes to NULL on the way in, so a caller handing over
   * an empty id must never reach the (single) worker whose row happens to
   * hold one. Both ends refuse it.
   */
  getByAccessUuid(accessUuid: string): Promise<WorkerAat | undefined>;
  /**
   * Get-or-create: the worker's access-token row, issuing an access UUID only
   * when they have none. NEVER replaces a value already there — see the
   * implementation — which is what makes it safe on a send path, where a
   * replacement would silently kill every link already sent.
   *
   * `issued` says whether THIS call minted the value, which is the difference
   * between an event worth an audit entry and a send that merely looked.
   */
  ensureAccessUuid(
    workerId: string,
  ): Promise<{ record: WorkerAat; issued: boolean }>;
  /** Create-or-update: set (or replace) the worker's access UUID. */
  setAccessUuid(workerId: string, accessUuid: string): Promise<WorkerAat>;
  /** Create-or-update: set (or replace) the worker's access code. */
  setAccessCode(workerId: string, accessCode: string): Promise<WorkerAat>;
  /** Clear the worker's access code. Undefined when the worker has no row. */
  clearAccessCode(workerId: string): Promise<WorkerAat | undefined>;
}

async function workerName(workerId: string | undefined): Promise<string> {
  const { storage } = await import('../index');
  return storage.workers.getWorkerDisplayName(workerId);
}

/**
 * Audit-safe projection of a row.
 *
 * The access UUID and the access code are bearer-like credentials: a future
 * access link is authorized by the UUID alone. Everything the logging
 * middleware records — `meta.args`, `meta.before`, `meta.after` and the
 * `meta.changes` diff derived from them — is persisted to `winston_logs` and
 * readable through the admin log viewer, so none of those payloads may carry
 * the literal values. Anyone who could read them could mint a working link
 * for a worker they are not allowed to act for.
 *
 * What survives is what the audit trail actually needs: which row, which
 * worker, and whether each value was present. That is enough for
 * `meta.changes` to show a set/cleared/replaced transition without ever
 * disclosing the credential itself.
 */
interface RedactedWorkerAat {
  id: string;
  workerId: string;
  hasAccessCode: boolean;
  hasAccessUuid: boolean;
}

function redactRecord(row: WorkerAat | undefined): RedactedWorkerAat | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    workerId: row.workerId,
    hasAccessCode: row.accessCode !== null && row.accessCode !== undefined,
    hasAccessUuid: row.accessUuid !== null && row.accessUuid !== undefined,
  };
}

/** Keep the worker id (it identifies the audited entity); drop the value. */
const redactValueArg = (args: any[]) => [args[0], '[REDACTED]'];

interface BeforeState {
  record?: RedactedWorkerAat;
}

/** What {@link WorkerAatStorage.ensureAccessUuid} answers with. */
type EnsuredWorkerAat = { record: WorkerAat; issued: boolean };

/**
 * The middleware hands `getDescription` the very object it persists, so the
 * before/after hooks project to the redacted shape rather than the raw row —
 * there is no variant of these payloads that holds a literal value. The
 * presence booleans are all the descriptions need to tell a first-time issue
 * from a replacement.
 *
 * These hooks have to be spelled out at all because the synthesized ones only
 * apply to `create*`/`update*`/`delete*` method names. Without an explicit
 * `before`, `beforeState` is always undefined and every line would claim
 * "Generated" / "Set" even on a replacement.
 */
const captureBefore = async (args: any[], storage: WorkerAatStorage): Promise<BeforeState> => ({
  record: redactRecord(await storage.getByWorker(args[0])),
});

const captureAfter = async (_args: any[], result: WorkerAat | undefined): Promise<BeforeState> => ({
  record: redactRecord(result),
});

const entityId = (args: any[], result: WorkerAat | undefined, before: unknown) =>
  result?.id ?? (before as BeforeState | undefined)?.record?.id ?? args[0];

export const workerAatLoggingConfig = defineLoggingConfig<WorkerAatStorage>({
  module: 'worker-aat',
  state: { key: 'record' },
  methods: {
    ensureAccessUuid: {
      // Takes no secret argument (the value is minted inside storage), so
      // `args` need no projection — but the RESULT does, and it arrives in
      // this method's own `{ record, issued }` shape rather than as a row.
      before: captureBefore,
      after: async (_args: any[], result: EnsuredWorkerAat | undefined) => ({
        record: redactRecord(result?.record),
      }),
      getEntityId: (args: any[], result: EnsuredWorkerAat | undefined, before: unknown) =>
        result?.record.id ?? (before as BeforeState | undefined)?.record?.id ?? args[0],
      getHostEntityId: (args) => args[0],
      // Only a genuine issue is an event. A worker who already held a token
      // was not written to at all, and one audit line per notified worker
      // saying so would bury the lines that matter.
      shouldLog: (_args: any[], result: EnsuredWorkerAat | undefined) =>
        result?.issued === true,
      getDescription: async (args) =>
        `Issued access UUID for ${await workerName(args[0])}`,
    },
    setAccessUuid: {
      logArgs: redactValueArg,
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args, _result, beforeState: BeforeState | undefined) => {
        const name = await workerName(args[0]);
        return beforeState?.record?.hasAccessUuid
          ? `Regenerated access UUID for ${name}`
          : `Generated access UUID for ${name}`;
      },
    },
    setAccessCode: {
      logArgs: redactValueArg,
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args, _result, beforeState: BeforeState | undefined) => {
        const name = await workerName(args[0]);
        return beforeState?.record?.hasAccessCode
          ? `Changed access code for ${name}`
          : `Set access code for ${name}`;
      },
    },
    clearAccessCode: {
      // Takes no secret argument, so args need no projection.
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Cleared access code for ${await workerName(args[0])}`,
    },
  },
});

export function createWorkerAatStorage(): WorkerAatStorage {
  async function upsert(
    workerId: string,
    values: { accessUuid?: string | null; accessCode?: string | null },
  ): Promise<WorkerAat> {
    const client = getClient();
    const [row] = await client
      .insert(workerAat)
      .values({ workerId, ...values })
      .onConflictDoUpdate({
        target: workerAat.workerId,
        set: values,
      })
      .returning();
    return row;
  }

  return {
    async getByWorker(workerId: string): Promise<WorkerAat | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerAat)
        .where(eq(workerAat.workerId, workerId))
        .limit(1);
      return row;
    },

    async getByAccessUuid(accessUuid: string): Promise<WorkerAat | undefined> {
      // A blank id is refused before the query rather than by it: `= ''` would
      // be a real comparison against a real stored value, and the column's
      // blank-to-NULL normalization is an invariant of the write path, not
      // something a read is entitled to assume.
      const value = accessUuid?.trim();
      if (!value) return undefined;
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerAat)
        .where(
          and(
            eq(workerAat.accessUuid, value),
            isNotNull(workerAat.accessUuid),
            ne(workerAat.accessUuid, ""),
          ),
        )
        .limit(1);
      return row;
    },

    async ensureAccessUuid(
      workerId: string,
    ): Promise<{ record: WorkerAat; issued: boolean }> {
      const client = getClient();

      // The common case — a worker who already holds a token — is answered
      // without writing anything at all: every send would otherwise churn a
      // new row version for a value it did not change.
      const [current] = await client
        .select()
        .from(workerAat)
        .where(eq(workerAat.workerId, workerId))
        .limit(1);
      if (current?.accessUuid) return { record: current, issued: false };

      // Issuing is ONE statement, so two callers racing for the same worker
      // resolve to one shared value rather than each invalidating the other's
      // links. The loser of the insert race lands in DO UPDATE, which keeps
      // whatever is already committed and takes the proposed value only when
      // there is nothing there: `EXCLUDED` is the row this statement
      // proposed, the bare column is the row that is already stored. That is
      // also why the read above is an optimization and not the decision — the
      // guarantee lives in the statement.
      const proposed = randomUUID();
      const [row] = await client
        .insert(workerAat)
        .values({ workerId, accessUuid: proposed })
        .onConflictDoUpdate({
          target: workerAat.workerId,
          set: {
            accessUuid: sql`COALESCE(NULLIF(${workerAat.accessUuid}, ''), EXCLUDED.access_uuid)`,
          },
        })
        .returning();
      // Whether this call is the one that minted the value: the proposal is
      // freshly generated, so it survives only when nothing else was there.
      return { record: row, issued: row.accessUuid === proposed };
    },

    async setAccessUuid(workerId: string, accessUuid: string): Promise<WorkerAat> {
      return upsert(workerId, { accessUuid });
    },

    async setAccessCode(workerId: string, accessCode: string): Promise<WorkerAat> {
      return upsert(workerId, { accessCode });
    },

    async clearAccessCode(workerId: string): Promise<WorkerAat | undefined> {
      const client = getClient();
      const [row] = await client
        .update(workerAat)
        .set({ accessCode: null })
        .where(eq(workerAat.workerId, workerId))
        .returning();
      return row;
    },
  };
}
