import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANONYMOUS_VIEWER,
  clearCatalogComponentSource,
  closeCatalogRegistration,
  defineCatalog,
  getCatalogVersion,
  getCatalogVocabulary,
  listCatalogsFor,
  listCatalogVocabularies,
  readCatalog,
  registerCatalog,
  resetCatalogRegistry,
  setCatalogComponentSource,
} from "@shared/catalog";
import type { CatalogEntry, CatalogViewer } from "@shared/catalog";
// Not re-exported from the barrel: these hand back unprojected entries,
// restricted detail included. Reached directly here to test them.
import { decideCatalogAccess, deriveCatalogEntries } from "@shared/catalog/read";
import * as catalogBarrel from "@shared/catalog";

/**
 * A stand-in for the server's component state. Flipping a value here is what a
 * live component toggle looks like to the catalog framework.
 */
function componentSource(state: Record<string, boolean>) {
  let revision = 0;
  return {
    source: {
      isEnabled: (id: string) => state[id] === true,
      getRevision: () => revision,
    },
    set(id: string, enabled: boolean) {
      state[id] = enabled;
      revision++;
    },
  };
}

function viewer(permissions: string[] = []): CatalogViewer {
  return {
    authenticated: true,
    hasPermission: (permission: string) => permissions.includes(permission),
  };
}

let components: ReturnType<typeof componentSource>;

beforeEach(() => {
  resetCatalogRegistry();
  components = componentSource({ widgets: true, gadgets: false });
  setCatalogComponentSource(components.source);
});

afterEach(() => {
  resetCatalogRegistry();
  clearCatalogComponentSource();
});

describe("component source", () => {
  it("refuses to be replaced once wired", () => {
    expect(() => setCatalogComponentSource(components.source)).toThrow(
      /already wired/,
    );
  });

  it("can be wired again after being cleared, so tests stay isolated", () => {
    clearCatalogComponentSource();
    expect(() => setCatalogComponentSource(components.source)).not.toThrow();
  });
});

describe("catalog declaration", () => {
  it("refuses a gated catalog that names no permission", () => {
    expect(() =>
      defineCatalog({
        id: "secrets",
        label: "Secrets",
        audience: "gated",
        entries: () => [],
      }),
    ).toThrow(/must declare a viewPermission/);
  });

  it("refuses a permission that would never be checked", () => {
    expect(() =>
      defineCatalog({
        id: "open",
        label: "Open",
        audience: "signed-in",
        viewPermission: "admin",
        entries: () => [],
      }),
    ).toThrow(/would never be checked/);
  });

  it("refuses entries declared as anything but a function", () => {
    expect(() =>
      defineCatalog({
        id: "static",
        label: "Static",
        audience: "signed-in",
        entries: [] as unknown as () => CatalogEntry[],
      }),
    ).toThrow(/derived on every read/);
  });
});

describe("catalog registration", () => {
  const simple = {
    id: "things",
    label: "Things",
    audience: "signed-in" as const,
    entries: () => [{ id: "a", name: "A" }],
  };

  it("refuses a duplicate catalog id", () => {
    registerCatalog(simple);
    expect(() => registerCatalog({ ...simple })).toThrow(/already registered/);
  });

  it("refuses registration once startup has closed it", () => {
    closeCatalogRegistration();
    expect(() => registerCatalog(simple)).toThrow(/registration closed/);
  });

  it("changes its version when a component is switched", () => {
    registerCatalog(simple);
    const before = getCatalogVersion();

    components.set("gadgets", true);

    expect(getCatalogVersion()).not.toBe(before);
  });
});

describe("deriving entries", () => {
  const areas = {
    id: "areas",
    label: "Areas",
    audience: "signed-in" as const,
    entries: () => [
      { id: "core", name: "Core" },
      { id: "widget", name: "Widget", component: "widgets" },
      { id: "gadget", name: "Gadget", component: "gadgets" },
    ],
  };

  it("offers only entries whose component is switched on", () => {
    const ids = deriveCatalogEntries(areas).map((entry) => entry.id);
    expect(ids).toEqual(["core", "widget"]);
  });

  it("reflects a component being switched on and off again, with no restart", () => {
    components.set("gadgets", true);
    expect(deriveCatalogEntries(areas).map((e) => e.id)).toEqual([
      "core",
      "widget",
      "gadget",
    ]);

    components.set("widgets", false);
    expect(deriveCatalogEntries(areas).map((e) => e.id)).toEqual(["core", "gadget"]);
  });

  it("refuses a duplicate entry id", () => {
    expect(() =>
      deriveCatalogEntries({
        id: "dupes",
        label: "Dupes",
        audience: "signed-in",
        entries: () => [
          { id: "a", name: "First" },
          { id: "a", name: "Second" },
        ],
      }),
    ).toThrow(/produced entry id 'a' twice/);
  });

  it("refuses to answer at all when the component source is not wired", () => {
    clearCatalogComponentSource();
    expect(() => deriveCatalogEntries(areas)).toThrow(/not wired/);
  });

  it("refuses even a catalog of purely core entries when it is not wired", () => {
    // Nothing here needs the component check, so the read could plausibly
    // succeed. It must not: the same catalog would start refusing the day
    // someone adds the first component-owned entry to it.
    clearCatalogComponentSource();
    expect(() =>
      deriveCatalogEntries({
        id: "core-only",
        label: "Core only",
        audience: "signed-in",
        entries: () => [{ id: "a", name: "A" }],
      }),
    ).toThrow(/not wired/);
  });

  it("refuses restricted detail under a catalog that guards none, component off or on", () => {
    const undeclared = {
      id: "undeclared",
      label: "Undeclared",
      audience: "signed-in" as const,
      entries: () => [
        { id: "x", name: "X", component: "gadgets", restricted: { defaultLimit: 5 } },
      ],
    };

    // 'gadgets' is off, so the entry is not even on offer — the declaration
    // error must still surface rather than hiding until someone enables it.
    expect(() => deriveCatalogEntries(undeclared)).toThrow(/declares no restrictedPermission/);

    components.set("gadgets", true);
    expect(() => deriveCatalogEntries(undeclared)).toThrow(/declares no restrictedPermission/);
  });
});

describe("audience", () => {
  const signedOut = {
    id: "providers",
    label: "Sign-in providers",
    audience: "signed-out" as const,
    entries: () => [{ id: "local", name: "Local" }],
  };
  const signedIn = {
    id: "terms",
    label: "Terms",
    audience: "signed-in" as const,
    entries: () => [{ id: "worker", name: "Worker" }],
  };
  const gated = {
    id: "flood",
    label: "Flood events",
    audience: "gated" as const,
    viewPermission: "admin",
    entries: () => [{ id: "login", name: "Login attempts" }],
  };

  it("lets an anonymous reader read a signed-out catalog", () => {
    expect(decideCatalogAccess(signedOut, ANONYMOUS_VIEWER)).toEqual({
      allowed: true,
      tier: "public",
    });
  });

  it("refuses an anonymous reader a signed-in catalog", () => {
    const access = decideCatalogAccess(signedIn, ANONYMOUS_VIEWER);
    expect(access.allowed).toBe(false);
  });

  it("refuses a signed-in reader without the gating permission", () => {
    expect(decideCatalogAccess(gated, viewer()).allowed).toBe(false);
    expect(decideCatalogAccess(gated, viewer(["admin"])).allowed).toBe(true);
  });

  it("omits catalogs a reader may not read from the index", () => {
    registerCatalog(signedOut);
    registerCatalog(signedIn);
    registerCatalog(gated);

    expect(listCatalogsFor(ANONYMOUS_VIEWER).map((c) => c.id)).toEqual(["providers"]);
    expect(listCatalogsFor(viewer()).map((c) => c.id)).toEqual(["providers", "terms"]);
    expect(listCatalogsFor(viewer(["admin"])).map((c) => c.id)).toEqual([
      "providers",
      "terms",
      "flood",
    ]);
  });
});

describe("restricted detail", () => {
  const flood = {
    id: "flood",
    label: "Flood events",
    audience: "signed-in" as const,
    restrictedPermission: "admin",
    entries: () => [
      {
        id: "login",
        name: "Login attempts",
        detail: { message: "Too many sign-in attempts. Try again later." },
        restricted: { defaultThreshold: 5, defaultWindowSeconds: 300 },
      },
    ],
  };

  beforeEach(() => registerCatalog(flood));

  it("omits it entirely from a reader without the permission", () => {
    const result = readCatalog("flood", viewer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.catalog.tier).toBe("public");
    const [entry] = result.catalog.entries;
    expect(entry.detail).toEqual({
      message: "Too many sign-in attempts. Try again later.",
    });
    expect("restricted" in entry).toBe(false);
  });

  it("includes it for a reader holding the permission", () => {
    const result = readCatalog("flood", viewer(["admin"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.catalog.tier).toBe("restricted");
    expect(result.catalog.entries[0].restricted).toEqual({
      defaultThreshold: 5,
      defaultWindowSeconds: 300,
    });
  });

  it("reports the tier it served, so a cache can key on it", () => {
    const asStaff = readCatalog("flood", viewer());
    const asAdmin = readCatalog("flood", viewer(["admin"]));

    expect(asStaff.ok && asStaff.catalog.tier).toBe("public");
    expect(asAdmin.ok && asAdmin.catalog.tier).toBe("restricted");
  });
});

describe("vocabulary lookups", () => {
  const areas = {
    id: "areas",
    label: "Areas",
    audience: "gated" as const,
    viewPermission: "admin",
    restrictedPermission: "admin",
    entries: () => [
      { id: "core", name: "Core", detail: { table: "workers" } },
      {
        id: "gadget",
        name: "Gadget",
        component: "gadgets",
        restricted: { defaultLimit: 5 },
      },
    ],
  };

  beforeEach(() => registerCatalog(areas));

  it("lists entries from switched-off components, so saved references stay readable", () => {
    // 'gadgets' is off. The offer excludes it; the vocabulary must not, or a
    // template saved against it stops resolving the moment someone toggles a
    // component.
    expect(getCatalogVocabulary("areas")?.entries.map((e) => e.id)).toEqual([
      "core",
      "gadget",
    ]);
  });

  it("answers without a component source, because it never consults one", () => {
    clearCatalogComponentSource();
    expect(() => getCatalogVocabulary("areas")).not.toThrow();
  });

  it("carries no payload at all, open or restricted", () => {
    expect(getCatalogVocabulary("areas")?.entries).toEqual([
      { id: "core", name: "Core" },
      { id: "gadget", name: "Gadget", component: "gadgets" },
    ]);
  });

  it("is undefined for an unknown catalog", () => {
    expect(getCatalogVocabulary("nope")).toBeUndefined();
  });
});

describe("the public surface", () => {
  const flood = {
    id: "flood",
    label: "Flood events",
    audience: "signed-in" as const,
    restrictedPermission: "admin",
    entries: () => [
      {
        id: "login",
        name: "Login attempts",
        restricted: { defaultThreshold: 5 },
      },
    ],
  };

  it("hands out nothing that yields restricted detail without a permitted reader", () => {
    registerCatalog(flood);

    // A catalog declaration carries its own entries() producer, so handing one
    // out is handing out the raw entries. The barrel must not.
    for (const withheld of [
      "getCatalogDefinition",
      "listCatalogDefinitions",
      "deriveCatalogEntries",
      "resolveCatalog",
    ]) {
      expect(withheld in catalogBarrel).toBe(false);
    }

    // And nothing it does export leaks the payload to a reader without the
    // permission.
    const everythingAnUnpermittedReaderCanSee = JSON.stringify({
      vocabulary: listCatalogVocabularies(),
      index: listCatalogsFor(viewer()),
      read: readCatalog("flood", viewer()),
    });
    expect(everythingAnUnpermittedReaderCanSee).not.toContain("defaultThreshold");

    // Sanity: the permitted reader really can see it, so the assertion above is
    // testing the gate rather than a typo.
    expect(JSON.stringify(readCatalog("flood", viewer(["admin"])))).toContain(
      "defaultThreshold",
    );
  });
});

describe("reading an unknown catalog", () => {
  it("refuses it as unknown rather than answering with an empty catalog", () => {
    const result = readCatalog("nope", viewer(["admin"]));
    expect(result).toEqual({
      ok: false,
      reason: "unknown",
      message: "Unknown catalog 'nope'.",
    });
  });
});
