import type {} from "../../../server/services/worker-sync-types";
declare module "../../../server/services/worker-sync-types" {
  interface WorkerSyncProviderResultFields {
    edlsActivated: number;
    edlsDeactivated: number;
  }
}
export {};
