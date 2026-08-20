import type { Pool, PoolClient } from "pg";
import { createInfrastructurePool } from "../storage/db";

/**
 * Cross-process lease used to keep the application readable while an S1 wet
 * reconciliation owns the write side. The migration process holds EXCLUSIVE;
 * normal app mutations hold SHARED for the lifetime of their work.
 *
 * This deliberately uses a different key from the migration-process lock:
 * one prevents two migration commands, this one coordinates migrations with
 * the live application.
 */
export const S1_APP_WRITE_FENCE_KEY = 727002;

export interface AppWriteFenceLease {
  release(): Promise<void>;
}

export type FencePool = Pick<Pool, "connect">;
type FenceClient = Pick<PoolClient, "query" | "release">;

// Separate from the storage pool: request leases can live through slow
// handlers without consuming the connections those handlers need in order to
// finish. The migration process passes its own pool explicitly.
const APP_FENCE_POOL_MAX = 32;
let appFencePool: Pool | undefined;

function getAppFencePool(): Pool {
  appFencePool ??= createInfrastructurePool({ max: APP_FENCE_POOL_MAX });
  return appFencePool;
}

/** Test/process-shutdown hook. The long-running app normally keeps this pool. */
export async function endAppWriteFencePool(): Promise<void> {
  const current = appFencePool;
  appFencePool = undefined;
  if (current) await current.end();
}

async function releaseLock(client: FenceClient, mode: "shared" | "exclusive"): Promise<void> {
  try {
    const functionName =
      mode === "shared" ? "pg_advisory_unlock_shared" : "pg_advisory_unlock";
    await client.query(`SELECT ${functionName}(${S1_APP_WRITE_FENCE_KEY})`);
    client.release();
  } catch (error) {
    // Never return a session whose lock state is unknown to the pool. Passing
    // an error discards the physical connection; PostgreSQL releases all
    // session locks when that connection closes.
    client.release(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/** Non-blocking shared lease. Undefined means a wet sync owns or is waiting for the fence. */
export async function tryAcquireAppWriteFence(
  fencePool: FencePool = getAppFencePool(),
): Promise<AppWriteFenceLease | undefined> {
  const client = await fencePool.connect();
  try {
    const [{ got }] = (await client.query(
      `SELECT pg_try_advisory_lock_shared(${S1_APP_WRITE_FENCE_KEY}) AS got`,
    )).rows as Array<{ got: boolean }>;
    if (!got) {
      client.release();
      return undefined;
    }
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        await releaseLock(client, "shared");
      },
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

/** Blocking exclusive lease for the sync orchestrator. */
export async function acquireExclusiveAppWriteFence(
  fencePool: FencePool = getAppFencePool(),
): Promise<AppWriteFenceLease> {
  const client = await fencePool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${S1_APP_WRITE_FENCE_KEY})`);
    let released = false;
    return {
      async release() {
        if (released) return;
        released = true;
        await releaseLock(client, "exclusive");
      },
    };
  } catch (error) {
    client.release();
    throw error;
  }
}