/** Vendor-neutral execution contracts shared by callers and identity providers. */
export class SyncInterrupted extends Error {}
export class SyncRunRefusal extends Error {}
export type SyncUnit = (work: () => Promise<void>) => Promise<void>;

/** Providers augment this interface with their own operational counters. */
export interface WorkerSyncProviderResultFields {}
export interface WorkerEinSyncResult extends WorkerSyncProviderResultFields {
  rowCounts: { received: number; changed: number; unchanged: number };
  created: number; updated: number; deleted: number; unchanged: number; skipped: number; errors: number;
  workersCreated: number; phonesCreated: number; phonesDeleted: number; phonesUnchanged: number;
  optins: number; statusesSet: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}
