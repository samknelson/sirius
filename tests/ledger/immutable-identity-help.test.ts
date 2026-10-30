import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { financeUploadHelp } from "../../server/help/system/finance-uploads";
import { getSystemHelp, findSystemHelpsForPath } from "../../server/help/system";
import { sanitizeHtml } from "@shared/utils/html";

const accountId = "system:ledger-accounts";
const eaId = "system:entity-account-statements";
const ids = new Set([accountId, eaId]);
const matching = (path: string) => findSystemHelpsForPath(path).filter(help => ids.has(help.id)).map(help => help.id);
describe("permanent identity guidance", () => {
  it.each([
    ["/ledger/accounts", accountId], ["/ledger/accounts/new", accountId],
    ["/ledger/accounts/fictional/edit", accountId], ["/ledger/accounts/fictional/settings", accountId],
    ["/workers/fictional/ledger/accounts", accountId], ["/employers/fictional/ledger/accounts", accountId],
    ["/ea/fictional", eaId], ["/ea/fictional/payments", eaId], ["/ea/fictional/transactions", eaId],
    ["/ea/fictional/invoices/1/2026", eaId],
  ])("shows relevant built-in guidance on %s", (path, id) => expect(matching(path)).toEqual([id]));
  it.each([
    "/ledger", "/ledger/account", "/ledger/accounts-other", "/workers/fictional/ledger/accounts/",
    "/employers/fictional/ledger/accounts/extra", "/workers/fictional/ledger/pay",
    "/config/helps", "/ea-other/fictional", "/ea", "/dashboard", "/__mockup/",
  ])("does not leak to a near miss: %s", path => expect(matching(path)).toEqual([]));
  it("retains existing wildcard behavior, IDs, sanitizer, and full help-dialog content", () => {
    expect(matching("/ea/fictional/nested")).toEqual([eaId]);
    expect(matching("/ledger/accounts/fictional/")).toEqual([accountId]);
    expect(matching("/workers/fictional/nested/ledger/accounts")).toEqual([accountId]);
    for (const entry of financeUploadHelp.filter(help => ids.has(help.id))) {
      const registered = getSystemHelp(entry.id)!;
      expect(registered.source).toBe("system");
      expect(registered.details).toBe(sanitizeHtml(entry.details!, "rich-document"));
      expect(registered.details!.replace(/\s+/g, " ").trim()).toBe(entry.details!.replace(/\s+/g, " ").trim());
      expect(registered.details).toContain("permanent");
      expect(registered.details).toContain("review");
      expect(entry.summary).not.toMatch(/[<>\r\n]/);
    }
    const content = getSystemHelp(accountId)!.details!;
    expect(content.indexOf("permanent")).toBeLessThan(content.indexOf("<ol>"));
    expect(content).toContain("without saving the other changes");
    expect(content).toContain("Do not delete and recreate");
    expect(getSystemHelp(eaId)!.details).toContain("no automatic reversal or transfer");
  });
  it("documents the shipped controls rather than adding an ownership editor", () => {
    const worker = readFileSync("client/src/pages/worker-ledger-accounts.tsx", "utf8");
    const employer = readFileSync("client/src/pages/employer-ledger-accounts.tsx", "utf8");
    const edit = readFileSync("client/src/pages/config/ledger/account-edit.tsx", "utf8");
    for (const page of [worker, employer]) {
      expect(page).toContain("Create Entry");
      expect(page).toContain('apiRequest("POST", "/api/ledger/ea"');
      expect(page).not.toContain('apiRequest("PUT", "/api/ledger/ea');
    }
    expect(edit).toContain("{account.currencyCode}");
    expect(edit).not.toContain("setEditCurrency");
  });
});
