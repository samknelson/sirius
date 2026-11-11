import { describe, expect, it } from "vitest";
import { getDisplayedWorkerEmployers } from "@/components/workers/employer-display";

const active = { id: "active", employmentStatusEmployed: true };
const terminated = { id: "terminated", employmentStatusEmployed: false };
const unknown = { id: "unknown" };

describe("worker directory employer indicators", () => {
  it("hides terminated employers but retains active and unknown-status employers", () => {
    expect(getDisplayedWorkerEmployers([active, terminated, unknown])).toEqual([active, unknown]);
  });

  it("returns no employer indicators when every employer is terminated", () => {
    expect(getDisplayedWorkerEmployers([terminated])).toEqual([]);
  });

  it("does not hide an employer with an explicitly null status", () => {
    expect(getDisplayedWorkerEmployers([{ id: "no-status", employmentStatusEmployed: null }])).toEqual([
      { id: "no-status", employmentStatusEmployed: null },
    ]);
  });
});
