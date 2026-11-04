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
    expect(help.details).toContain("<strong>Account balance</strong>");
    expect(help.details).toContain("<strong>Pay Balance</strong>");
    expect(help.details).toContain("never had a nonzero balance");
    expect(help.details).toContain("including charges paid in the same month");
    expect(help.details).toContain("work-hours accounts do not count");
    expect(help.details).toContain("unavailable balance history keeps the block visible");
    expect(help.details).toContain("Coverage unavailable");
    expect(help.details).toContain("<strong>Unreported</strong>");
    expect(help.details).toContain("no employer hours records exist for that work month");
    expect(help.details).toContain("<strong>0 hours</strong> means reports were recorded and their total is zero");
    expect(help.details).toContain("<strong>Unavailable</strong> means hours evidence is missing, unreadable, or could not be loaded");
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
