import { describe, expect, it } from "vitest";
import { getWmbResultCounts, isFailedContinuation } from "../../shared/wmb-scan-outcomes";

describe("WMB eligibility outcome counts", () => {
  it("counts failed continuations without deletion, not failed starts or execution errors", () => {
    expect(getWmbResultCounts({ actions: [
      { scanType: "continue", eligible: false, action: "none" },
      { scanType: "continue", eligible: false, action: "delete", executed: true },
      { scanType: "continue", action: "delete" }, // legacy summary
      { scanType: "start", eligible: false, action: "none" },
      { scanType: "start", eligible: false, action: "delete" },
      { scanType: "continue", eligible: false, action: "none", executionError: "Plugin error" },
      { scanType: "start", eligible: true, action: "create", executionError: "Write failed" },
      { scanType: "continue", eligible: true, action: "none" },
      { scanType: "start", eligible: true, action: "create" },
    ] })).toEqual({ started: 1, continued: 1, terminated: 3 });
  });
  it("does not claim deletion or infer continuation from a failed start", () => {
    expect(isFailedContinuation({ scanType: "start", eligible: false, action: "delete" })).toBe(false);
    expect(getWmbResultCounts(null)).toEqual({ started: 0, continued: 0, terminated: 0 });
    expect(getWmbResultCounts({ actions: {} } as any)).toEqual({ started: 0, continued: 0, terminated: 0 });
  });
});
