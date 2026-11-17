import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { workerIds } from "@shared/schema";
import { getClient, runInTransaction } from "../transaction-context";

// Deliberately limited to one live T631 worker unit. A run-wide cache would
// hide other writers. The table lock blocks ALL ID writers (including SQL).
const scope = new AsyncLocalStorage<{
  client: ReturnType<typeof getClient>;
  reads: Map<string, unknown>;
  open: boolean;
}>();

function current() {
  const value = scope.getStore();
  return value?.open && value.client === getClient() ? value : undefined;
}

export async function lockWorkerIdentities(): Promise<void> {
  if (!current()) await getClient().execute(sql`LOCK TABLE ${workerIds} IN SHARE ROW EXCLUSIVE MODE`);
}

export async function withLockedIdentityReads<T>(work: () => Promise<T>): Promise<T> {
  return runInTransaction(async () => {
    await lockWorkerIdentities();
    const active = { client: getClient(), reads: new Map<string, unknown>(), open: true };
    return scope.run(active, async () => {
      try { return await work(); }
      finally { active.open = false; active.reads.clear(); }
    });
  });
}

export async function identityRead<T>(key: string[], read: () => Promise<T>): Promise<T> {
  const active = current();
  if (!active) return read();
  const cacheKey = JSON.stringify(key);
  if (active.reads.has(cacheKey)) return active.reads.get(cacheKey) as T;
  const result = await read();
  active.reads.set(cacheKey, result);
  return result;
}

export function invalidateIdentityReads(): void {
  current()?.reads.clear();
}
