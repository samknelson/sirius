import { describe, expect, it } from "vitest";
import {
  buildSheetsQueryString,
  EDLS_SHEETS_PAGE_SIZE,
  getNextSheetsPage,
  getPreviousSheetsPage,
  getSheetsPaginationSummary,
  getValidSheetsPage,
} from "../client/src/pages/edls/sheets-pagination";

describe("EDLS sheets pagination", () => {
  it("requests a fixed-size zero-based page with its filters", () => {
    const params = new URLSearchParams(buildSheetsQueryString(2, {
      status: "draft",
      departmentId: undefined,
      title: "123",
    }));

    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBe(String(EDLS_SHEETS_PAGE_SIZE));
    expect(params.get("status")).toBe("draft");
    expect(params.get("title")).toBe("123");
    expect(params.has("departmentId")).toBe(false);
  });

  it("reports the range and page for a full page", () => {
    expect(getSheetsPaginationSummary(1, 100, 245, 100)).toEqual({
      rangeStart: 101,
      rangeEnd: 200,
      totalPages: 3,
      currentPage: 2,
    });
  });

  it("reports the final partial range and navigation boundary", () => {
    const summary = getSheetsPaginationSummary(2, 100, 245, 45);
    expect(summary).toEqual({
      rangeStart: 201,
      rangeEnd: 245,
      totalPages: 3,
      currentPage: 3,
    });
    expect(summary.currentPage < summary.totalPages).toBe(false);
  });

  it("uses valid zero values for an empty result", () => {
    expect(getSheetsPaginationSummary(0, 100, 0, 0)).toEqual({
      rangeStart: 0,
      rangeEnd: 0,
      totalPages: 1,
      currentPage: 1,
    });
  });

  it("keeps previous and next navigation within the available pages", () => {
    expect(getPreviousSheetsPage(0)).toBe(0);
    expect(getPreviousSheetsPage(2)).toBe(1);
    expect(getNextSheetsPage(0, 3)).toBe(1);
    expect(getNextSheetsPage(2, 3)).toBe(2);
  });

  it("returns to a valid page when filters or totals reduce the results", () => {
    expect(getValidSheetsPage(3, 25)).toBe(0);
    expect(getValidSheetsPage(3, 225)).toBe(2);
    expect(getValidSheetsPage(0, 0)).toBe(0);
  });
});