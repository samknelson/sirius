import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findSystemHelpsForPath, getAllSystemHelps, getSystemHelp } from "../../server/help/system";
import { likePatternMatches } from "../../server/help/path-match";
import { sanitizeHtml } from "../../shared/utils/html";
import { benefitsWorkflowHelp } from "../../server/help/system/benefits-workflows";
import { financeUploadHelp } from "../../server/help/system/finance-uploads";
import { messagingConfigurationHelp } from "../../server/help/system/messaging-configuration";
import { workerRecordHelp } from "../../server/help/system/worker-records";
import { organizationRecordHelp } from "../../server/help/system/organization-records";
import { conditionalDomainHelp } from "../../server/help/system/conditional-domains";
import { importsPensionReportsHelp } from "../../server/help/system/imports-pension-reports";
import { baoConfigurationHelp } from "../../server/help/system/bao-configuration";
import { administrationHelp } from "../../server/help/system/administration";
import { integrationsAppearanceHelp } from "../../server/help/system/integrations-appearance";
import { additionalPluginKindHelp } from "../../server/help/system/additional-plugin-kinds";
import { reportTypeHelp } from "../../server/help/system/report-types";

const authored = [
  ...benefitsWorkflowHelp, ...financeUploadHelp, ...messagingConfigurationHelp,
  ...workerRecordHelp, ...organizationRecordHelp, ...conditionalDomainHelp,
  ...importsPensionReportsHelp, ...baoConfigurationHelp, ...administrationHelp,
  ...integrationsAppearanceHelp, ...additionalPluginKindHelp, ...reportTypeHelp,
];
const coverage = readFileSync("docs/in-app-help-backfill-coverage.md", "utf8");
const rows = coverage.split("\n").filter(line => /^\| F\d\d \|/.test(line)).map(line => {
  const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
  return { family: cells[0], status: cells[1], positive: cells[2],
    ids: cells[3].split(", ").map(id => `system:${id}`), negative: cells[4], browser: cells[7] };
});
const byFamily = new Map(rows.map(row => [row.family, row]));
const idsFor = (path: string) => findSystemHelpsForPath(path).map(entry => entry.id);

// Expand finite audit notation only. These braces/colon templates are never
// registered as help patterns. Optional route parameters also cover omission.
function expandBraces(input: string): string[] {
  const match = /\{([^{}]*)\}/.exec(input);
  if (!match) return [input];
  return match[1].split(",").flatMap(value =>
    expandBraces(input.slice(0, match.index) + value + input.slice(match.index + match[0].length)));
}
const pluginKinds = [
  "trust-eligibility", "dispatch-eligibility", "charge", "event-notifier", "cron",
  "payment-gateway", "dashboard", "data-retention", "denorm", "quicksearch",
  "worker-list", "client-injection", "web-service", "trust-provider-edi",
];
const reportPaths = reportTypeHelp.flatMap(entry => entry.paths);
function concretePaths(template: string): string[] {
  if (template === "/admin/plugin-configs/:kind") {
    return pluginKinds.map(kind => `/admin/plugin-configs/${kind}`);
  }
  if (template === "/reports/:reportType") return reportPaths;
  const optional = /\/:\w+\?/.exec(template);
  if (optional) return [
    ...concretePaths(template.replace(optional[0], "")),
    ...concretePaths(template.replace("?", "")),
  ];
  return [template.replace(/:\w+/g, "example")];
}
const app = readFileSync("client/src/App.tsx", "utf8");
const browserPaths = [...app.matchAll(/<(?:ProtectedRoute|Route)\b[^>]*?path="([^"]+)"/gs)]
  .flatMap(match => concretePaths(match[1]));

describe("audited authenticated workflow help", () => {
  it("accounts for 47 missing families, with 45 backfill families and separate shipped payment ownership", () => {
    const expected = Array.from({ length: 48 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`)
      .filter(id => id !== "F32");
    expect(rows.map(row => row.family)).toEqual(expected);
    expect(new Set(rows.map(row => row.family)).size).toBe(47);
    expect(rows.filter(row => row.status.startsWith("Source complete"))).toHaveLength(45);
    for (const id of ["F08", "F09"]) expect(byFamily.get(id)?.status).toMatch(/^Separate owner/);
    for (const row of rows) expect(row.browser).toBe("B0");
  });

  it.each(rows)("$family independently matches its focus entry, not its near-miss", row => {
    expect(idsFor(row.positive)).toContain(row.ids[0]);
    expect(idsFor(row.negative)).not.toContain(row.ids[0]);
    for (const id of row.ids) expect(getSystemHelp(id), `${row.family}: ${id}`).toBeDefined();
  });

  it("covers every scoped audit route with that family's named entries, not an unrelated broad match", () => {
    const audit = readFileSync("docs/in-app-help-coverage-audit.md", "utf8");
    let checked = 0;
    for (const line of audit.split("\n").filter(value => /^\| F\d\d /.test(value))) {
      const family = line.split(" ")[1];
      if (["F08", "F09", "F32", "F49", "F50"].includes(family)) continue;
      const ids = byFamily.get(family)!.ids;
      const templates = [...line.split("|")[2].split(";")[0].matchAll(/`(\/[^`]+)`/g)].map(match => match[1]);
      for (const path of templates.flatMap(expandBraces).flatMap(concretePaths)) {
        // A worker profile root cannot be expressed with one-segment specificity
        // in this matcher. Do not leak identity-editor guidance onto checkout,
        // benefits, or dispatch to manufacture a passing root match.
        if (family === "F22" && path === "/workers/example") {
          expect(idsFor(path)).not.toContain("system:worker-identity");
          continue;
        }
        expect(idsFor(path).some(id => ids.includes(id)), `${family}: ${path}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(350);
  });

  it("registers all authored IDs exactly once, records them in the inventory, and preserves HTML sections", () => {
    const registered = getAllSystemHelps();
    expect(new Set(registered.map(entry => entry.id)).size).toBe(registered.length);
    const inventoried = new Set(rows.flatMap(row => row.ids));
    const headings = ["Purpose", "Before you start", "How to use this page",
      "Results and status meanings", "Limitations and common problems"];
    for (const entry of authored) {
      expect(inventoried.has(entry.id), entry.id).toBe(true);
      const help = getSystemHelp(entry.id)!;
      expect(registered.filter(item => item.id === entry.id)).toHaveLength(1);
      expect(help.source).toBe("system");
      expect(help.summary).not.toMatch(/<|>|[\r\n]|^\s*#/);
      expect(help.summary.split(/\s+/).length).toBeGreaterThanOrEqual(10);
      expect(help.summary.split(/\s+/).length).toBeLessThanOrEqual(40);
      expect(help.details).toBe(sanitizeHtml(entry.details!, "rich-document"));
      expect(sanitizeHtml(help.details!, "rich-document")).toBe(help.details);
      const sections = [...help.details!.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]);
      expect(sections[0]).toBe("Purpose");
      expect(sections).toContain("How to use this page");
      const ordered = sections.map(section => headings.indexOf(section));
      expect(ordered.every(index => index >= 0), entry.id).toBe(true);
      expect(ordered).toEqual([...new Set(ordered)].sort((a, b) => a - b));
      expect(help.details).not.toMatch(/<(?:script|iframe|img|style|form)\b|\son\w+=|javascript:/i);
      expect(help.details).not.toMatch(/<(?:p|h3|ol|ul|li|strong)\s+[^>]/i);
    }
  });

  it("uses real browser launch hosts and rejects URL placeholders, global catchalls, and broad kind fallback", () => {
    for (const entry of authored) {
      expect(entry.paths.length).toBeGreaterThan(0);
      for (const pattern of entry.paths) {
        expect(pattern.startsWith("/"), `${entry.id}: ${pattern}`).toBe(true);
        expect(pattern).not.toMatch(/:|\{|\}|\?|\*|\/api\//);
        expect(["%", "/%", "/config/%", "/admin/%", "/admin/plugin-configs/%"]).not.toContain(pattern);
        expect(browserPaths.some(path => likePatternMatches(pattern, path)),
          `${entry.id}: no browser host for ${pattern}`).toBe(true);
      }
    }
    for (const kind of pluginKinds) {
      const path = `/admin/plugin-configs/${kind}`;
      const focused = authored.filter(entry => entry.paths.includes(path));
      expect(focused.length, kind).toBeGreaterThan(0);
      expect(focused.every(entry => entry.id !== "system:plugin-configuration-list")).toBe(true);
    }
    for (const path of reportPaths) {
      expect(byFamily.get("F41")!.ids.some(id => getSystemHelp(id)?.paths.includes(path)), path).toBe(true);
    }
  });

  it("keeps exact suffixes narrow while acknowledging percent spans empty text and nested segments", () => {
    const id = "system:benefits-scan";
    for (const path of ["/workers", "/workers/example/benefits/current", "/workers/example/benefits/scan/",
      "/workers/example/benefits/scan/extra", "/workers/example/benefits/scan-other",
      "/Workers/example/benefits/scan", "/config/helps", "/__mockup/"]) {
      expect(idsFor(path)).not.toContain(id);
    }
    expect(idsFor("/workers/example/nested/benefits/scan")).toContain(id);
    expect(likePatternMatches("/workers/%/benefits/scan", "/workers//benefits/scan")).toBe(true);
    expect(idsFor("/ledger/payment/example/logs/nested")).toContain("system:staff-payment-entry");
    expect(idsFor("/ledger/payment/example/")).toContain("system:staff-payment-entry");
    expect(idsFor("/ledger/payments/example")).not.toContain("system:staff-payment-entry");
    expect(idsFor("/employers/example/ledger/payment-methods")).not.toContain("system:employer-payment-methods");
    expect(idsFor("/employers/example/ledger/payment_methods")).toContain("system:employer-payment-methods");
    expect(idsFor("/ledger/accounts")).not.toContain("system:staff-payment-entry");
  });

  it("retains critical distinctions without snapshotting all prose", () => {
    const details = (id: string) => getSystemHelp(`system:${id}`)!.details!;
    expect(details("benefits-scan")).toMatch(/Run Test Scan/);
    expect(details("benefits-scan")).toMatch(/Run Live Scan/);
    expect(details("benefits-scan")).toMatch(/delet/i);
    expect(details("event-center-hours-purchase")).toMatch(/records.*hours/i);
    expect(details("event-center-hours-purchase")).toMatch(/does not.*(?:collect|charg)/i);
    expect(details("bao-premium-files")).toMatch(/offsetting.*entries/i);
    expect(details("btu-worker-import")).toContain("Terminate workers not present in this file");
    expect(details("btu-dues-import")).toMatch(/creates payment and ledger records/i);
    expect(details("worker-ratings")).toMatch(/0.*4/);
    expect(details("worker-access-tokens")).toMatch(/previously handed-out links stop working/i);
    expect(details("denorm-maintenance")).toMatch(/later/);
    expect(details("ledger-authorization-settings")).toMatch(/not retroactively/);
    expect(details("quicksearch-plugin-configuration")).toMatch(/no.*(?:per-record|additional)|not assume an additional per-record/i);
  });
});
