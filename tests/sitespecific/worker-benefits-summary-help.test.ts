import { describe, expect, it } from "vitest";
import { findSystemHelpsForPath, getAllSystemHelps, getSystemHelp } from "../../server/help/system";
import { sanitizeHtml } from "../../shared/utils/html";

describe("Benefits Summary built-in help", () => {
  const id = "system:worker-benefits-summary";
  it("registers sanitized, focused guidance without local help writes", () => {
    const help = getSystemHelp(id)!;
    expect(help.source).toBe("system");
    expect(getAllSystemHelps().filter(item => item.id === id)).toHaveLength(1);
    expect(help.details).toBe(sanitizeHtml(help.details!, "rich-document"));
    expect(help.details).toContain("<h3>Results and status meanings</h3>");
    expect(help.details).toContain("Each dependent appears once");
    expect(help.details).toContain("scanned in the previous system");
    expect(help.details).toContain("Scan pending");
    expect(help.details).toContain("Coverage unavailable");
    expect(help.details).not.toContain("<script");
  });
  it("matches the summary route but not sibling screens, suffixes or unrelated pages", () => {
    expect(findSystemHelpsForPath("/workers/fictional/benefits/summary").some(h => h.id === id)).toBe(true);
    for (const path of ["/workers", "/workers/fictional/benefits/history", "/workers/fictional/benefits/current",
      "/workers/fictional/benefits/summary/", "/workers/fictional/benefits/summary/extra",
      "/workers/fictional/benefits/summary-other", "/dashboard", "/config/helps", "/__mockup/"]) {
      expect(findSystemHelpsForPath(path).some(h => h.id === id), path).toBe(false);
    }
  });
});
