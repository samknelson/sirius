export class SyncInterrupted extends Error {}
export class SyncRunRefusal extends Error {}
export type SyncUnit = (work: () => Promise<void>) => Promise<void>;

export interface WorkerEinSyncResult {
  rowCounts: { received: number; changed: number; unchanged: number };
  created: number; updated: number; deleted: number; unchanged: number; skipped: number; errors: number;
  workersCreated: number; phonesCreated: number; phonesDeleted: number; phonesUnchanged: number;
  optins: number; statusesSet: number; edlsActivated: number; edlsDeactivated: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}
export interface T631WorkerListResponse {
  success: boolean;
  data?: { workers?: unknown };
  [key: string]: unknown;
}
