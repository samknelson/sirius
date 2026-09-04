/**
 * Postgres advisory locks — cross-PROCESS mutual exclusion (Task #1350).
 *
 * The deployed topology runs one image as two ECS services against a single
 * database, and a rollout restarts both at the same instant. Two processes
 * therefore execute the identical boot sequence concurrently, and the parts
 * of it that write (schema bring-up, boot-time seeding) have no other way to
 * take turns: there is no leader election, no shared filesystem, and the
 * writes they perform are not all expressible as a single atomic statement.
 *
 * Advisory locks are the right primitive because they are held by the
 * DATABASE, which is the one thing both processes agree on, and because the
 * server drops a session lock the moment its connection dies — a task that is
 * killed mid-migration cannot wedge the next rollout forever.
 *
 * TWO SHAPES, deliberately different:
 *
 *   - {@link AdvisoryLockStorage.tryAcquireSession} — a SESSION lock held on a
 *     dedicated pooled connection, across many statements and transactions.
 *     For schema bring-up, which runs DDL, migrations and bookkeeping writes
 *     that must not be one giant transaction. It polls with a deadline: a
 *     boot must never wait forever, so the caller gets `null` and can fail
 *     with a named blocker instead of hanging.
 *   - {@link AdvisoryLockStorage.withTransactionLock} — a TRANSACTION lock,
 *     released automatically at commit/rollback. For a short
 *     check-then-insert that cannot be made atomic with ON CONFLICT because
 *     the table has no unique key for it (and must not grow one — see the
 *     dashboard default-config seeder).
 *
 * Lock names are hashed with `hashtext`, inside a fixed class id so this
 * app's locks cannot collide with any other advisory-lock user on the same
 * cluster. Hash collisions between two of OUR names would only mean two
 * unrelated sections serialize against each other — never a lost lock.
 */
import type pg from "pg";
import { pool } from "./db";
import { getClient, runInTransaction } from "./transaction-context";
import { sql } from "drizzle-orm";

/**
 * Class id for every advisory lock this application takes. Arbitrary but
 * fixed: it namespaces our `hashtext(name)` object ids away from any other
 * application sharing the cluster.
 */
const ADVISORY_LOCK_CLASS_ID = 1350;

/** How often a waiter re-tries the lock while inside its deadline. */
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Ceiling on how long a transaction-scoped lock may block. These guard short
 * check-then-insert sections, so anything near this means the holder is stuck
 * — and a stuck boot must produce an error, not a hang.
 */
const TRANSACTION_LOCK_TIMEOUT_MS = 30_000;

export interface AdvisoryLockHandle {
  /** The lock name, as passed to the acquire call. */
  readonly name: string;
  /** Milliseconds spent waiting before the lock was granted. */
  readonly waitedMs: number;
  /** True when the lock was NOT free on the first attempt. */
  readonly contended: boolean;
  /** Release the lock and return the connection to the pool. Idempotent. */
  release(): Promise<void>;
}

export interface SessionLockOptions {
  /**
   * Hard deadline for acquiring the lock, in milliseconds. Never unbounded:
   * there is no "wait forever" value, and a non-positive number means a
   * single attempt with no retry, NOT an infinite wait. Callers that read
   * this from configuration must reject a non-positive setting themselves
   * rather than passing it through as if it disabled the deadline.
   */
  timeoutMs: number;
  pollIntervalMs?: number;
  /** Called once, the first time the lock is found to be held by someone else. */
  onWaitStart?: () => void;
}

export interface AdvisoryLockStorage {
  /**
   * Take a session-level advisory lock on a dedicated connection, waiting at
   * most `timeoutMs`. Resolves to `null` when the deadline passes with the
   * lock still held elsewhere — the caller decides what that means.
   *
   * Throws only when the DATABASE could not be reached (a failed checkout or
   * a failed probe), which is a different situation and must not be reported
   * as "somebody else holds the lock".
   */
  tryAcquireSession(
    name: string,
    options: SessionLockOptions,
  ): Promise<AdvisoryLockHandle | null>;

  /**
   * Run `fn` inside a transaction that first takes a transaction-scoped
   * advisory lock, so concurrent callers of the same name execute strictly
   * one after another and each one's reads see the previous one's writes.
   * The lock is released by the commit or rollback — nothing to clean up.
   */
  withTransactionLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Never let a poll delay be the reason the process stays alive.
    timer.unref?.();
  });
}

export function createAdvisoryLockStorage(): AdvisoryLockStorage {
  return {
    async tryAcquireSession(
      name: string,
      options: SessionLockOptions,
    ): Promise<AdvisoryLockHandle | null> {
      const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const startedAt = Date.now();
      const deadline = startedAt + Math.max(0, options.timeoutMs);

      // The checkout itself is bounded by the pool's connectionTimeoutMillis
      // (see server/storage/db.ts): an unreachable database fails here rather
      // than blocking forever.
      const client: pg.PoolClient = await pool.connect();
      let released = false;
      let announcedWait = false;

      const releaseClient = (err?: Error) => {
        if (released) return;
        released = true;
        client.release(err);
      };

      try {
        for (;;) {
          const result = await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock($1::int4, hashtext($2)::int4) AS locked",
            [ADVISORY_LOCK_CLASS_ID, name],
          );
          if (result.rows[0]?.locked === true) {
            const waitedMs = Date.now() - startedAt;
            return {
              name,
              waitedMs,
              contended: announcedWait,
              async release(): Promise<void> {
                if (released) return;
                try {
                  await client.query(
                    "SELECT pg_advisory_unlock($1::int4, hashtext($2)::int4)",
                    [ADVISORY_LOCK_CLASS_ID, name],
                  );
                  releaseClient();
                } catch (error) {
                  // A dead connection has already dropped the lock server-side;
                  // discard the client rather than returning it to the pool.
                  releaseClient(error instanceof Error ? error : new Error(String(error)));
                }
              },
            };
          }

          if (!announcedWait) {
            announcedWait = true;
            options.onWaitStart?.();
          }

          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            releaseClient();
            return null;
          }
          await sleep(Math.min(pollIntervalMs, remaining));
        }
      } catch (error) {
        releaseClient(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },

    async withTransactionLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
      return runInTransaction(async () => {
        const client = getClient();
        // Bound the wait. `pg_advisory_xact_lock` blocks indefinitely by
        // itself, and these run on the boot path, where an indefinite wait is
        // the exact failure this whole mechanism exists to prevent: the
        // caller must get an error it can report, not a process that never
        // finishes starting. SET LOCAL, so it expires with the transaction.
        await client.execute(sql.raw(`SET LOCAL lock_timeout = '${TRANSACTION_LOCK_TIMEOUT_MS}ms'`));
        await client.execute(
          sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASS_ID}::int4, hashtext(${name})::int4)`,
        );
        return fn();
      });
    },
  };
}
