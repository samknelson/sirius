import { AsyncLocalStorage } from "node:async_hooks";
import type { ChargePluginExecutionResult } from "./executor";

/** A caller may observe charge failures without changing the charge engine's
 * soft-fail behavior. The awaited WMB event keeps this within the upload run. */
const capture = new AsyncLocalStorage<{ failures: number }>();
export function captureChargeFailures<T>(state: { failures: number }, run: () => Promise<T>) {
  return capture.run(state, run);
}
export function reportChargeResult(result?: ChargePluginExecutionResult) {
  const state = capture.getStore();
  if (!state) return;
  state.failures += result
    ? result.executed.filter(item => !item.success).length + (result.entryCreationError ? 1 : 0)
    : 1;
}
