import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultBlankHours } from "../../server/plugins/wizards/engine/blank-hours";

const mocks = vi.hoisted(() => ({
  hours: vi.fn(),
  options: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  workerHours: { upsertWorkerHours: mocks.hours },
  workers: { getWorker: async () => undefined },
} }));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({ list: mocks.options }),
}));
vi.mock("../../server/services/files", () => ({ fileSystemService: {} }));

import { gbhetLegalWorkersMonthly } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_monthly";
import { gbhetLegalWorkersCorrections } from "../../server/plugins/wizards/engine/types/gbhet_legal_workers_corrections";

const blankValues = [undefined, null, "", " ", " \t\r\n ", "-", "  - \t"];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockImplementation(async (type: string) =>
    type === "employment-status"
      ? [{ id: "active", name: "Active", code: "A", employed: true }] : []);
  mocks.hours.mockResolvedValue({});
});

describe("blank hours default", () => {
  it.each(blankValues)("treats a blank cell (%j) as zero", value => {
    expect(defaultBlankHours(value)).toBe(0);
  });
  it.each([0, 8, 7.5, -2, "0", " 8.5 ", "-2", "--", "abc", "N/A", false])("preserves nonblank data (%j) for ordinary validation", value => {
    expect(defaultBlankHours(value)).toBe(value);
  });
});

describe.each([
  { name: "Legal monthly", feed: gbhetLegalWorkersMonthly },
  { name: "Legal corrections", feed: gbhetLegalWorkersCorrections },
])("$name blank hours", ({ feed }) => {
  it.each(blankValues)("validates a blank hours cell (%j) as a numeric zero", async value => {
    // An omitted SSN deliberately avoids worker lookups; only hours-field
    // validation and normalization are under test.
    const row = { numberOfHours: value };
    const errors = await feed.validateRow(row, 0, "update");
    expect(errors.filter(error => error.field === "numberOfHours")).toEqual([]);
    expect(row.numberOfHours).toBe(0);
  });
  it.each(blankValues)("writes an actual zero-hour record for a blank cell (%j), even without prior validation", async value => {
    await (feed as any).processWorkerHours(
      "worker", { numberOfHours: value, employmentStatus: "Active" },
      { entityId: "employer", data: { launchArguments: { year: 2026, month: 10 } } },
    );
    expect(mocks.hours).toHaveBeenCalledWith(expect.objectContaining({
      workerId: "worker", employerId: "employer", hours: 0, year: 2026, month: 10,
    }));
  });
  it("continues rejecting a nonblank nonnumeric hours value", async () => {
    const errors = await feed.validateRow({ numberOfHours: "not a number" }, 0, "update");
    expect(errors.some(error => error.field === "numberOfHours")).toBe(true);
    await expect((feed as any).processWorkerHours(
      "worker", { numberOfHours: "not a number", employmentStatus: "Active" },
      { entityId: "employer", data: { launchArguments: { year: 2026, month: 10 } } },
    )).rejects.toThrow("Invalid hours value");
    expect(mocks.hours).not.toHaveBeenCalled();
  });
  it("does not change a reported nonzero number of hours", async () => {
    await (feed as any).processWorkerHours(
      "worker", { numberOfHours: " 8.5 ", employmentStatus: "Active" },
      { entityId: "employer", data: { launchArguments: { year: 2026, month: 10 } } },
    );
    expect(mocks.hours).toHaveBeenCalledWith(expect.objectContaining({ hours: 8.5 }));
  });
});
