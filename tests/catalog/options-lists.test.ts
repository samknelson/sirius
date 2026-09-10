import { beforeEach, describe, expect, it } from "vitest";
import {
  ANONYMOUS_VIEWER,
  clearCatalogComponentSource,
  readCatalog,
  readCatalogDeclaration,
  resetCatalogRegistry,
  setCatalogComponentSource,
  type CatalogViewer,
} from "@shared/catalog";
import { OPTIONS_LISTS_CATALOG } from "@shared/catalog-ids";
import { registerOptionsListsCatalog } from "../../server/storage/unified-options-catalog";
import { optionsMetadata } from "../../server/storage/unified-options";
import { getOptionsType, optionsTypeRegistry } from "../../server/modules/options-registry";

/**
 * The options lists catalog.
 *
 * Two things are worth a test here and the rest is not. The first is that the
 * type registry and the catalog still describe the same set of lists: they used
 * to be two hand-kept lists of the same 32 identifiers, and a list declared in
 * one but not the other is the failure this migration exists to make
 * impossible. The second is that filtering the catalog by component state did
 * not quietly turn a switched-off list into an unknown one — the options routes
 * refuse a disabled list with an explanation, and they can only do that while
 * something still admits it exists.
 */

const signedIn: CatalogViewer = { authenticated: true, hasPermission: () => false };

let revision = 0;

/** Wire (or re-wire) component state. The source refuses replacement, so clear first. */
function wireComponents(enabled: Record<string, boolean>): void {
  clearCatalogComponentSource();
  revision += 1;
  const stable = revision;
  setCatalogComponentSource({
    isEnabled: (component: string) => enabled[component] ?? false,
    getRevision: () => stable,
  });
}

/** Every component any list depends on, switched on. */
const allComponentsOn = (): Record<string, boolean> =>
  Object.fromEntries(
    Object.values(optionsMetadata)
      .map((metadata) => metadata.requiredComponent)
      .filter((component): component is string => component !== undefined)
      .map((component) => [component, true]),
  );

function offeredIds(): string[] {
  const result = readCatalog(OPTIONS_LISTS_CATALOG, signedIn);
  if (!result.ok) throw new Error(`expected a readable catalog: ${result.message}`);
  return result.catalog.entries.map((entry) => entry.id);
}

beforeEach(() => {
  resetCatalogRegistry();
  registerOptionsListsCatalog();
});

describe("options lists catalog", () => {
  it("describes exactly the lists the type registry serves", () => {
    wireComponents(allComponentsOn());

    const declared = readCatalogDeclaration(OPTIONS_LISTS_CATALOG, signedIn);
    if (!declared.ok) throw new Error(declared.message);

    const catalogIds = declared.catalog.entries.map((entry) => entry.id).sort();
    expect(catalogIds).toEqual(Object.keys(optionsTypeRegistry).sort());
    expect(catalogIds).toEqual(Object.keys(optionsMetadata).sort());
    // Not a tautology worth skipping: it is the count that made the old
    // hand-written registry literal easy to fall behind by exactly one.
    expect(catalogIds.length).toBe(Object.keys(optionsMetadata).length);
  });

  it("stops offering a list when its component goes off, and offers it again when it comes back", () => {
    wireComponents({ ...allComponentsOn(), grievance: true });
    expect(offeredIds()).toContain("grievance-status");

    wireComponents({ ...allComponentsOn(), grievance: false });
    expect(offeredIds()).not.toContain("grievance-status");
    // A list with no component of its own is unaffected.
    expect(offeredIds()).toContain("gender");

    // And back, without a restart — the entries are derived on every read.
    wireComponents({ ...allComponentsOn(), grievance: true });
    expect(offeredIds()).toContain("grievance-status");
  });

  it("leaves a switched-off list refusable as disabled rather than unknown", () => {
    wireComponents({ ...allComponentsOn(), grievance: false });

    // What the options routes' component gate reads. If this ever started
    // tracking the filtered catalog, a request for a switched-off list would
    // fall through to the handler's 404 and tell the caller the list does not
    // exist, instead of naming the feature that has to be turned on.
    const config = getOptionsType("grievance-status");
    expect(config).toBeDefined();
    expect(config?.requiredComponent).toBe("grievance");

    const declared = readCatalogDeclaration(OPTIONS_LISTS_CATALOG, signedIn);
    if (!declared.ok) throw new Error(declared.message);
    expect(declared.catalog.entries.map((entry) => entry.id)).toContain("grievance-status");
  });

  it("carries the plural name and where the list is really administered", () => {
    wireComponents(allComponentsOn());

    const result = readCatalog(OPTIONS_LISTS_CATALOG, signedIn);
    if (!result.ok) throw new Error(result.message);
    const entry = (id: string) => result.catalog.entries.find((e) => e.id === id);

    expect(entry("event-type")?.detail).toEqual({
      pluralName: "Event Types",
      bespokePath: "/config/event-types",
    });
    // No page of its own is a real answer, not a missing one: the navigation
    // and the options index both branch on it.
    expect(entry("gender")?.detail).toEqual({
      pluralName: "Genders",
      bespokePath: null,
    });
  });

  it("carries nothing beyond what a caller needs to name and gate a list", () => {
    wireComponents(allComponentsOn());

    const declared = readCatalogDeclaration(OPTIONS_LISTS_CATALOG, signedIn);
    if (!declared.ok) throw new Error(declared.message);

    for (const entry of declared.catalog.entries) {
      expect(Object.keys(entry.detail ?? {}).sort()).toEqual(["bespokePath", "pluralName"]);
      expect(entry.restricted).toBeUndefined();
    }

    // The declaration also holds the Drizzle table, the field definitions and
    // the schema/uiSchema payloads for every list. None of it is a client's
    // business and none of it should have come along.
    const everythingItCanSay = JSON.stringify(declared);
    for (const serverOnly of ["loggingModule", "requiredFields", "optionalFields", "uiSchema", "orderByColumn"]) {
      expect(everythingItCanSay).not.toContain(serverOnly);
    }
  });

  it("says what the config navigation reads, in the words it reads them by", async () => {
    wireComponents(allComponentsOn());

    // The one seam a type cannot hold: `detail` is an open bag of code-supplied
    // values, so the client reads `pluralName` and `bespokePath` out of it by
    // name. Renaming either on the server compiles fine on both sides and shows
    // up as a sidebar of undefined labels.
    const { toOptionsCatalogEntries } = await import(
      "../../client/src/config/navigation-registry"
    );

    const result = readCatalog(OPTIONS_LISTS_CATALOG, signedIn);
    if (!result.ok) throw new Error(result.message);
    const entries = toOptionsCatalogEntries(result.catalog.entries);

    expect(entries).toContainEqual({
      type: "event-type",
      name: "Event Type",
      pluralName: "Event Types",
      description: optionsMetadata["event-type"].description,
      bespokePath: "/config/event-types",
    });
    // No list arrives without the name a screen puts at the top of it.
    for (const entry of entries) {
      expect(entry.pluralName).toBeTruthy();
      expect(entry.name).toBeTruthy();
    }
  });

  it("leaves a config section ready when the catalog withholds one of its lists", async () => {
    wireComponents(allComponentsOn());

    const { configSections, resolveConfigSections, toOptionsCatalogEntries } = await import(
      "../../client/src/config/navigation-registry"
    );

    const result = readCatalog(OPTIONS_LISTS_CATALOG, signedIn);
    if (!result.ok) throw new Error(result.message);
    const entries = toOptionsCatalogEntries(result.catalog.entries);

    // A section that names a specific list — one of the four administered on
    // their own page. The catalog used to be unfiltered, so such an item always
    // found its list; now a switched-off feature's list is simply absent, and
    // absence must read as "this list is not offered", not as "still loading".
    const named = configSections
      .flatMap((section) => [section, ...(section.subsections ?? [])])
      .find((section) => section.items.some((item) => item.optionsType));
    if (!named) throw new Error("expected a config section naming an options list");
    const withheld = named.items.find((item) => item.optionsType)!.optionsType!;

    const resolved = resolveConfigSections(
      { entries: entries.filter((entry) => entry.type !== withheld), status: "ready" },
      [named],
    );

    expect(resolved[0].itemsStatus).toBe("ready");
    expect(resolved[0].items.some((item) => item.optionsType === withheld)).toBe(false);
    // The section's other items are untouched — the list going away takes one
    // link with it, not the section around it.
    expect(resolved[0].items.length).toBe(named.items.length - 1);
  });

  it("answers any signed-in reader and refuses an anonymous one", () => {
    wireComponents(allComponentsOn());

    // The names of the dropdown lists are not sensitive, and the screens built
    // on this stay admin-only through their own route gates.
    expect(readCatalog(OPTIONS_LISTS_CATALOG, signedIn)).toMatchObject({ ok: true });
    expect(readCatalog(OPTIONS_LISTS_CATALOG, ANONYMOUS_VIEWER)).toMatchObject({
      ok: false,
      reason: "denied",
    });
  });
});
