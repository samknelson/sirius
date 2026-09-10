import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * The admin catalog browser.
 *
 * What is checked here is what a rendering test would not catch: that the two
 * screens stay read-only, that the navigation entry and the route guard keep
 * agreeing about who may see them, and that a catalog answer is cached against
 * the viewer it was served to.
 */

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const { catalogQueryKey } = await import("../../client/src/hooks/useCatalogQuery");

const appSource = readFileSync("client/src/App.tsx", "utf8");
const navSource = readFileSync("client/src/config/navigation-registry.ts", "utf8");
const indexPage = readFileSync("client/src/pages/config/catalogs.tsx", "utf8");
const detailPage = readFileSync("client/src/pages/config/catalog-detail.tsx", "utf8");

describe("catalog browser cache key", () => {
  it("keys a catalog answer to the viewer it was served to", () => {
    // The same address gives an administrator with the restricted permission
    // detail that another administrator must not see, so two viewers must never
    // share one cache entry.
    expect(catalogQueryKey("user-1", "/api/catalogs")).not.toEqual(
      catalogQueryKey("user-2", "/api/catalogs"),
    );
    expect(catalogQueryKey("anonymous", "/api/catalogs")).not.toEqual(
      catalogQueryKey("user-1", "/api/catalogs"),
    );
  });

  it("still separates the catalogs a viewer reads from one another", () => {
    expect(catalogQueryKey("user-1", "/api/catalogs/entity-file-areas")).not.toEqual(
      catalogQueryKey("user-1", "/api/catalogs/entity-note-areas"),
    );
  });
});

describe("catalog browser gating", () => {
  it("gates the navigation entry and both routes on the same permission", () => {
    expect(navSource).toMatch(
      /path: "\/config\/catalogs", label: "Catalogs",[^}]*permission: "admin"/,
    );
    expect(appSource).toMatch(
      /path="\/config\/catalogs">\s*<ProtectedRoute permission="admin">/,
    );
    expect(appSource).toMatch(
      /path="\/config\/catalogs\/:catalogId">\s*<ProtectedRoute permission="admin">/,
    );
  });

  it("registers the index before the drill-in, so the literal path cannot be captured", () => {
    expect(appSource.indexOf('path="/config/catalogs"')).toBeGreaterThan(-1);
    expect(appSource.indexOf('path="/config/catalogs"')).toBeLessThan(
      appSource.indexOf('path="/config/catalogs/:catalogId"'),
    );
  });
});

describe("catalog browser is read-only", () => {
  it("has nothing on either screen that writes", () => {
    for (const source of [indexPage, detailPage]) {
      expect(source).not.toContain("useMutation");
      expect(source).not.toContain("apiRequest");
      expect(source).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    }
  });

  it("reads only through the viewer-keyed hook, never the shared default fetcher", () => {
    for (const source of [indexPage, detailPage]) {
      expect(source).toContain("useCatalogQuery");
      expect(source).not.toContain("useQuery(");
    }
  });
});
