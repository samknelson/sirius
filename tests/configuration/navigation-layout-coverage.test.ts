import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  configSections,
  findConfigurationRouteOwner,
  findActiveItemPath,
  getAllNavItems,
  isConfigurationRoute,
  optionsCatalogNavItem,
} from "../../client/src/config/navigation-registry";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const registeredRoutePatterns = Array.from(
  appSource.matchAll(/<Route path="([^"]+)"/g),
  match => match[1],
);
const registeredRouteEntries = Array.from(
  appSource.matchAll(/<Route path="([^"]+)"/g),
  match => {
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = appSource.indexOf("</Route>", bodyStart);
    return {
      pattern: match[1],
      body: bodyEnd === -1 ? "" : appSource.slice(bodyStart, bodyEnd),
    };
  },
);

function concreteRoute(pattern: string): string {
  return pattern.replace(/:[^/]+/g, "audit-value");
}

function routePatternMatches(path: string, pattern: string): boolean {
  const pathParts = path.split("/");
  const patternParts = pattern.split("/");
  return pathParts.length === patternParts.length
    && patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

describe("configuration layout boundary", () => {
  it("has an App route for every static configuration navigation destination", () => {
    for (const item of getAllNavItems(configSections)) {
      expect(
        registeredRoutePatterns.some(pattern => routePatternMatches(item.path, pattern)),
        `No registered route serves ${item.path}`,
      ).toBe(true);
    }
  });

  it("covers every static configuration navigation destination and descendant", () => {
    for (const item of getAllNavItems(configSections)) {
      expect(isConfigurationRoute(item.path), item.path).toBe(true);
      expect(findConfigurationRouteOwner(item.path), item.path).toBe(item.path);
      expect(isConfigurationRoute(`${item.path}/example-drill-in`), item.path).toBe(true);
    }
  });

  it("routes every owned page through AuthenticatedLayout or an owned redirect", () => {
    for (const route of registeredRouteEntries) {
      if (!isConfigurationRoute(concreteRoute(route.pattern))) continue;
      expect(
        route.body.includes("<AuthenticatedLayout>")
          || route.body.includes("<Redirect"),
        `${route.pattern} bypasses the shared authenticated layout boundary`,
      ).toBe(true);
    }
  });

  it("classifies every otherwise-unowned /config route as a documented redirect", () => {
    const documentedRedirects = new Set([
      "/config/users",
      "/config/users/list",
      "/config/users/roles",
      "/config/users/permissions",
      "/config/users/policies",
      "/config/users/sessions",
      "/config/users/flood-events",
      "/config/users/:id",
      "/config/ledger/accounts",
      "/config/ledger/accounts/:id",
      "/config/ledger/accounts/:id/edit",
      "/config/ledger/accounts/:id/payments",
    ]);

    for (const route of registeredRouteEntries.filter(({ pattern }) => pattern.startsWith("/config"))) {
      if (isConfigurationRoute(concreteRoute(route.pattern))) continue;
      expect(documentedRedirects.has(route.pattern), `Undocumented /config route: ${route.pattern}`).toBe(true);
    }

    for (const pattern of documentedRedirects) {
      expect(
        registeredRouteEntries.some(route => route.pattern === pattern && route.body.includes("<Redirect")),
        `${pattern} is documented as a redirect but has no redirect declaration`,
      ).toBe(true);
    }
  });

  it("covers catalog-derived option list routes before the catalog loads", () => {
    const dynamicItem = optionsCatalogNavItem({
      type: "example",
      name: "Example",
      pluralName: "Examples",
    });

    expect(isConfigurationRoute(dynamicItem.path)).toBe(true);
    expect(isConfigurationRoute("/config/options/example/export")).toBe(true);
    expect(isConfigurationRoute("/config/options/example/import")).toBe(true);
    expect(findActiveItemPath("/config/options/example/export", [{
      id: "dropdown-lists",
      title: "Dropdown Lists",
      description: "",
      icon: dynamicItem.icon,
      items: [dynamicItem],
    }])).toBe(dynamicItem.path);
  });

  it.each([
    ["/admin/letter-templates/42", "/admin/letter-templates"],
    ["/admin/users/roles", "/admin/users/roles"],
    ["/admin/users/permissions", "/admin/users/permissions"],
    ["/admin/users/policies", "/admin/users/policies"],
    ["/admin/users/sessions", "/admin/users/sessions"],
    ["/admin/users/flood-events/config", "/admin/users/flood-events"],
    ["/trust-benefits/add", "/trust-benefits"],
    ["/trust-benefits/42/edit", "/trust-benefits"],
    ["/config/dispatch-job-type/42/edit", "/config/dispatch-job-types"],
    ["/config/sftp/client/42/logs", "/config/sftp/clients"],
    ["/grievance-timeline-template/42/items", "/grievance-timeline-templates"],
    ["/contract/42/articles/outline", "/contracts"],
    ["/sitespecific/btu/csg/42/edit", "/sitespecific/btu/csgs"],
    ["/cron-jobs/example/history", "/admin/cron-jobs"],
  ])("keeps %s in the configuration surface owned by %s", (path, owner) => {
    expect(findConfigurationRouteOwner(path)).toBe(owner);
    expect(findActiveItemPath(path)).toBe(owner);
  });

  it.each([
    "/admin/roles",
    "/admin/permissions",
    "/admin/wmb-scan-queue",
    "/admin/users/42",
    "/sitespecific/btu/worker-import",
    "/ledger/accounts",
    "/users/42",
  ])("does not pull unrelated operation %s into configuration", (path) => {
    expect(isConfigurationRoute(path)).toBe(false);
  });

  it.each([
    "/config/phone-numbers",
    "/config/bargaining-units",
  ])("retains configuration chrome for unlisted legacy page %s", (path) => {
    expect(isConfigurationRoute(path)).toBe(true);
    expect(findConfigurationRouteOwner(path)).toBeNull();
  });

  it("applies the boundary without weakening per-route ProtectedRoute gates", () => {
    expect(appSource).toContain("const content = isConfigurationRoute(location)");
    expect(appSource).toMatch(
      /path="\/admin\/users\/roles">[\s\S]*?<ProtectedRoute permission="admin">/,
    );
    expect(appSource).toMatch(
      /path="\/trust-benefits\/:id\/edit">[\s\S]*?<ProtectedRoute tabId="edit" entityType="trust_benefit">/,
    );
  });
});