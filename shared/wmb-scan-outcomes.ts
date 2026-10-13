/** Eligibility decisions are not execution failures or proof of a row deletion. */
export interface WmbScanOutcome {
  scanType?: string;
  eligible?: boolean;
  action?: string;
  executed?: boolean;
  executionError?: string;
}

export function isFailedContinuation(action: WmbScanOutcome): boolean {
  return !action.executionError && action.scanType === "continue" &&
    (action.eligible === false || action.action === "delete");
}

export function getWmbResultCounts(summary: { actions?: WmbScanOutcome[] } | null | undefined) {
  let started = 0, continued = 0, terminated = 0;
  for (const action of Array.isArray(summary?.actions) ? summary.actions : []) {
    if (action.executionError) continue;
    if (isFailedContinuation(action)) terminated++;
    else if (action.scanType === "start" && action.eligible) started++;
    else if (action.scanType === "continue" && action.eligible) continued++;
  }
  return { started, continued, terminated };
}
