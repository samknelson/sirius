import { ResourceLease, LEASE_PROBE_MS } from "../../../services/resource-lease";
import { semaphoreStorage } from "../../../storage/system/semaphores";

export { SemaphoreLost as CronExecutionLost } from "../../../storage/system/semaphores";
export type { SemaphoreStore } from "../../../services/resource-lease";
export const EXECUTION_PROBE_MS = LEASE_PROBE_MS;
export const cronExecutionKey = (pluginId: string) => `cron:execution:${pluginId}`;

/** Preserve cron's acquisition API over the resource-neutral lifecycle. */
export const CronExecutionLock = {
  acquire: (pluginId: string, store = semaphoreStorage) =>
    ResourceLease.acquireKey(cronExecutionKey(pluginId), store),
  acquireKey: (key: string, store = semaphoreStorage) => ResourceLease.acquireKey(key, store),
};
export type CronExecutionLock = ResourceLease;
