import { describe, expect, it } from "vitest";
import { matchesCardcheckReportSearch } from "../../client/src/lib/cardcheck-report-search";

describe("cardcheck report search", () => {
  it("searches a report row with no Sirius ID without throwing or matching null text", () => {
    const item = { workerName: "Example Worker", workerSiriusId: null };

    expect(matchesCardcheckReportSearch(item, "example")).toBe(true);
    expect(matchesCardcheckReportSearch(item, "123")).toBe(false);
    expect(matchesCardcheckReportSearch(item, "null")).toBe(false);
  });
});