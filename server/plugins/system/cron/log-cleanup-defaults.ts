import { alterHooks } from "@shared/alter";

export interface LogCleanupPolicy {
  module: string | null;
  operation: string | null;
  retentionDays: number;
  enabled: boolean;
}
export const logCleanupDefaultsHook = alterHooks.declareSync<LogCleanupPolicy[], Record<string, never>>({
  id: "logs.cleanup.defaults",
  description: "Compose suggested log cleanup policies",
  semantics: "Suggestions only; explicit stored policies remain authoritative and cleanup remains independently opt-in.",
});
export function logCleanupDefaults() {
  return { policies: alterHooks.runSync(logCleanupDefaultsHook, [], {}) };
}
