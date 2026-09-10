import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ANONYMOUS_VIEWER,
  clearCatalogComponentSource,
  getCatalogVocabulary,
  readCatalog,
  readCatalogDeclaration,
  resetCatalogRegistry,
  setCatalogComponentSource,
  type CatalogViewer,
} from "@shared/catalog";
import { registerEntityFileContext } from "../../server/services/entity-files/registry";
import {
  ENTITY_FILE_AREAS_CATALOG,
  registerEntityFileAreasCatalog,
} from "../../server/services/entity-files/catalog";
import { registerEntityNoteContext } from "../../server/services/entity-notes/registry";
import {
  ENTITY_NOTE_AREAS_CATALOG,
  registerEntityNoteAreasCatalog,
} from "../../server/services/entity-notes/catalog";
import {
  RECORD_HISTORY_AREAS_CATALOG,
  registerRecordHistoryAreasCatalog,
} from "../../server/storage/entity-metadata-record-catalog";
import { EXCLUDED_METADATA_TABLES } from "../../server/storage/system/entity-metadata-policy";

/**
 * The three entity-area catalogs.
 *
 * The behaviour that cannot be serialized — does this record exist, may this
 * request see it, which physical table is it — stays in the registries these
 * catalogs project. What is checked here is the projection: that it tracks
 * component state in both directions, that the areas' own rules survive the
 * move, and that nothing server-only comes along for the ride.
 */

const admin: CatalogViewer = {
  authenticated: true,
  hasPermission: (permission) => permission === "admin",
};

const signedInNonAdmin: CatalogViewer = {
  authenticated: true,
  hasPermission: () => false,
};

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

function offeredIds(catalogId: string): string[] {
  const result = readCatalog(catalogId, admin);
  if (!result.ok) throw new Error(`expected a readable catalog: ${result.message}`);
  return result.catalog.entries.map((entry) => entry.id);
}

function declaredIds(catalogId: string): string[] {
  const result = readCatalogDeclaration(catalogId, admin);
  if (!result.ok) throw new Error(`expected a readable catalog: ${result.message}`);
  return result.catalog.entries.map((entry) => entry.id);
}

const area = (id: string, label: string, recordLabel: string, component?: string) => ({
  id,
  label,
  recordLabel,
  ...(component ? { component } : {}),
  entityExists: async () => true,
  checkAccess: async () => true,
});

beforeAll(() => {
  // The context registries have no reset, so register once. `pool: "forks"`
  // gives this file its own process, so these cannot reach another test.
  registerEntityFileContext({ ...area("worker", "Workers", "Worker"), checkPolicyAccess: async () => true });
  registerEntityFileContext({
    ...area("grievance", "Grievances", "Grievance", "grievance"),
    checkPolicyAccess: async () => true,
  });
  registerEntityNoteContext(area("worker", "Workers", "Worker"));
  registerEntityNoteContext(area("trust_provider", "Trust Providers", "Trust Provider", "trust.providers"));
});

beforeEach(() => {
  resetCatalogRegistry();
  registerEntityFileAreasCatalog();
  registerEntityNoteAreasCatalog();
  registerRecordHistoryAreasCatalog();
});

describe.each([
  {
    what: "file areas",
    catalogId: ENTITY_FILE_AREAS_CATALOG,
    gatedArea: "grievance",
    component: "grievance",
    coreArea: "worker",
    recordLabel: "Grievance",
  },
  {
    what: "note areas",
    catalogId: ENTITY_NOTE_AREAS_CATALOG,
    gatedArea: "trust_provider",
    component: "trust.providers",
    coreArea: "worker",
    recordLabel: "Trust Provider",
  },
])("$what", ({ catalogId, gatedArea, component, coreArea, recordLabel }) => {
  it("offers a component's area while it is on, and drops it the moment it goes off", () => {
    wireComponents({ [component]: true });
    expect(offeredIds(catalogId)).toContain(gatedArea);

    wireComponents({ [component]: false });
    expect(offeredIds(catalogId)).not.toContain(gatedArea);
    expect(offeredIds(catalogId)).toContain(coreArea);

    // And back, without a restart — the entries are derived on every read.
    wireComponents({ [component]: true });
    expect(offeredIds(catalogId)).toContain(gatedArea);
  });

  it("still declares a switched-off area, because a config page has to show it", () => {
    wireComponents({ [component]: false });

    expect(declaredIds(catalogId)).toContain(gatedArea);
    expect(getCatalogVocabulary(catalogId)?.entries.map((e) => e.id)).toContain(gatedArea);
  });

  it("names the component that supplies an area, so a config page can explain itself", () => {
    wireComponents({ [component]: false });

    const entry = readCatalogDeclaration(catalogId, admin);
    if (!entry.ok) throw new Error(entry.message);
    expect(entry.catalog.entries.find((e) => e.id === gatedArea)?.component).toBe(component);
    expect(entry.catalog.entries.find((e) => e.id === coreArea)?.component).toBeUndefined();
  });

  it("carries the singular record label, which is what names one record", () => {
    wireComponents({ [component]: true });

    const result = readCatalog(catalogId, admin);
    if (!result.ok) throw new Error(result.message);
    expect(result.catalog.entries.find((e) => e.id === gatedArea)?.detail).toEqual({
      recordLabel,
    });
  });

  it("is refused for a reader without the admin permission", () => {
    wireComponents({ [component]: true });

    expect(readCatalog(catalogId, signedInNonAdmin)).toMatchObject({ ok: false, reason: "denied" });
    expect(readCatalog(catalogId, ANONYMOUS_VIEWER)).toMatchObject({ ok: false, reason: "denied" });
    expect(readCatalogDeclaration(catalogId, signedInNonAdmin)).toMatchObject({
      ok: false,
      reason: "denied",
    });
  });
});

describe("record history areas", () => {
  beforeEach(() => wireComponents({}));

  it("offers the areas that carry record history", () => {
    const ids = offeredIds(RECORD_HISTORY_AREAS_CATALOG);

    expect(ids).toContain("workers");
    expect(ids).toContain("employers");
  });

  it("keeps refusing process-owned tables, which is this area's own rule", () => {
    const ids = new Set(offeredIds(RECORD_HISTORY_AREAS_CATALOG));

    for (const excluded of EXCLUDED_METADATA_TABLES) {
      expect(ids.has(excluded)).toBe(false);
    }
  });

  it("carries the destination template, including the honest absence of one", () => {
    const result = readCatalog(RECORD_HISTORY_AREAS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);

    expect(result.catalog.entries.find((e) => e.id === "workers")?.detail).toEqual({
      hrefTemplate: "/workers/{id}",
    });
    // No page of its own is a real answer, not a missing one.
    expect(result.catalog.entries.find((e) => e.id === "contact_phone")?.detail).toEqual({
      hrefTemplate: null,
    });
  });

  it("never carries the physical table, in any form, at either tier", () => {
    const everythingItCanSay = JSON.stringify([
      readCatalog(RECORD_HISTORY_AREAS_CATALOG, admin),
      readCatalogDeclaration(RECORD_HISTORY_AREAS_CATALOG, admin),
      getCatalogVocabulary(RECORD_HISTORY_AREAS_CATALOG),
    ]);

    expect(everythingItCanSay).not.toContain("tableName");
    expect(everythingItCanSay).not.toContain('"table"');

    const result = readCatalogDeclaration(RECORD_HISTORY_AREAS_CATALOG, admin);
    if (!result.ok) throw new Error(result.message);
    for (const entry of result.catalog.entries) {
      expect(Object.keys(entry.detail ?? {})).toEqual(["hrefTemplate"]);
    }
  });
});
