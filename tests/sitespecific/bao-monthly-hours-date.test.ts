import { describe, expect, it } from "vitest";

import { FeedWizard } from "../../server/plugins/wizards/engine/feed";
import {
  BaoMonthlyHoursWizard,
  baoMonthlyHours,
} from "../../server/plugins/wizards/engine/types/bao_monthly_hours";

function parseBaoDate(value: unknown): string | null {
  return (baoMonthlyHours as any).parseDate(value);
}

class SharedParserHarness extends FeedWizard {
  name = "shared-parser-harness";
  displayName = "Shared parser harness";
  description = "Tests the non-BAO parser";

  parse(value: unknown): string | null {
    return this.parseDate(value);
  }
}

describe("BAO monthly-hours birth dates", () => {
  it.each([
    ["11/24/90", "1990-11-24"],
    ["1/24/88", "1988-01-24"],
    ["1/15/89", "1989-01-15"],
    ["6/10/90", "1990-06-10"],
    ["6/23/71", "1971-06-23"],
    ["12/31/29", "2029-12-31"],
    ["1/1/30", "1930-01-01"],
    ["1/1/00", "2000-01-01"],
    ["1/1/99", "1999-01-01"],
  ])("normalizes %s with the fixed pivot", (input, expected) => {
    expect(parseBaoDate(input)).toBe(expected);
  });

  it.each([
    ["6/8/1955", "1955-06-08"],
    ["01/02/2015", "2015-01-02"],
    ["1990-11-24", "1990-11-24"],
    [33202, "1990-11-24"],
  ])("preserves existing format support for %s", (input, expected) => {
    expect(parseBaoDate(input)).toBe(expected);
  });

  it.each(["2/29/23", "2/30/90", "13/1/90"])(
    "rejects impossible short-year calendar date %s during validation",
    async (input) => {
      const wizard = new BaoMonthlyHoursWizard();
      const errors = await wizard.validateRow({ dateOfBirth: input }, 0, "update");
      expect(errors.some((error) =>
        error.field === "dateOfBirth" && error.message.includes("Invalid calendar date"),
      )).toBe(true);
    },
  );

  it("shows BAO-specific short-year format guidance", async () => {
    const wizard = new BaoMonthlyHoursWizard();
    const errors = await wizard.validateRow({ dateOfBirth: "1/2/3" }, 0, "update");
    const dobError = errors.find((error) => error.field === "dateOfBirth");
    expect(dobError?.message).toContain("M/D/YY");
    expect(dobError?.message).toContain("MM/DD/YY");
    expect(wizard.getFields().find((field) => field.id === "dateOfBirth")?.description)
      .toContain("M/D/YY");
  });

  it("does not add two-digit years to the shared feed parser", () => {
    const shared = new SharedParserHarness();
    expect(() => shared.parse("11/24/90")).toThrow(/Invalid date format/);
    expect(shared.parse("11/24/1990")).toBe("1990-11-24");
  });
});