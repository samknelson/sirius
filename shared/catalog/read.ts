/**
 * Shared catalog framework — deriving and reading.
 *
 * Everything that decides what a given reader receives lives here, in one
 * place: which catalogs they may know about, which entries are currently on
 * offer, and which tier of detail they get.
 */

import { assertCatalogComponentSource, isCatalogComponentEnabled } from "./component";
import { getCatalogDefinition, listCatalogDefinitions } from "./registry";
import type {
  CatalogAccess,
  CatalogDefinition,
  CatalogEntry,
  CatalogReadResult,
  CatalogSummary,
  CatalogTier,
  CatalogViewer,
  CatalogVocabulary,
  CatalogVocabularyEntry,
  ResolvedCatalog,
  ResolvedCatalogEntry,
} from "./types";

/**
 * Everything a catalog declares, validated but unfiltered.
 *
 * Both readers of a catalog start here: the offer (filtered by component state,
 * projected to a tier) and the vocabulary (unfiltered, stripped to identity).
 * Keeping the validation in one place means neither can drift into accepting a
 * declaration the other refuses.
 */
function declaredEntries(definition: CatalogDefinition): readonly CatalogEntry[] {
  const produced = definition.entries();
  const seen = new Set<string>();

  for (const entry of produced) {
    if (!entry.id || !entry.id.trim()) {
      throw new Error(`Catalog '${definition.id}' produced an entry with no id.`);
    }
    if (seen.has(entry.id)) {
      throw new Error(
        `Catalog '${definition.id}' produced entry id '${entry.id}' twice.`,
      );
    }
    seen.add(entry.id);

    if (entry.restricted !== undefined && !definition.restrictedPermission) {
      throw new Error(
        `Catalog '${definition.id}' entry '${entry.id}' carries restricted ` +
          "detail, but the catalog declares no restrictedPermission. Declare " +
          "the permission that guards it, or move the detail into `detail`.",
      );
    }
  }

  return produced;
}

/**
 * Produce a catalog's entries as they stand right now.
 *
 * Calls the declaration's `entries()` on every invocation and drops entries
 * whose component is switched off, so the result always describes the running
 * deployment.
 *
 * This is the offer, not the vocabulary. Interpreting something already stored
 * — a saved template naming a token, a stored config naming a plugin — must not
 * read this, or switching a component off retroactively invalidates data that
 * was legitimately saved. Read {@link getCatalogVocabulary} for that.
 *
 * Returns raw entries, restricted detail included. Deliberately not exported
 * from the package barrel: everything that leaves this framework for a reader
 * goes through {@link readCatalog} or {@link listCatalogsFor}, which decide a
 * tier first.
 */
export function deriveCatalogEntries(definition: CatalogDefinition): CatalogEntry[] {
  assertCatalogComponentSource();

  return declaredEntries(definition).filter(
    (entry) => !entry.component || isCatalogComponentEnabled(entry.component),
  );
}

/**
 * Strip a declaration down to its vocabulary: what ids exist and what they are
 * called.
 *
 * Every payload is dropped here, open and restricted alike. This is the one
 * path out of the framework that answers without a reader, so it must have
 * nothing to disclose.
 */
function toVocabulary(definition: CatalogDefinition): CatalogVocabulary {
  const entries: CatalogVocabularyEntry[] = declaredEntries(definition).map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.component !== undefined ? { component: entry.component } : {}),
  }));

  return {
    id: definition.id,
    label: definition.label,
    audience: definition.audience,
    entries,
  };
}

/**
 * One catalog's declared vocabulary, unfiltered by component state.
 *
 * For interpreting data that was already saved: a stored template naming a
 * token, a stored config naming a plugin. Switching a component off must not
 * retroactively invalidate a reference that was legitimately saved, so this
 * deliberately ignores component state — and, ignoring it, needs no component
 * source wired to answer.
 */
export function getCatalogVocabulary(id: string): CatalogVocabulary | undefined {
  const definition = getCatalogDefinition(id);
  return definition ? toVocabulary(definition) : undefined;
}

/** Every catalog's declared vocabulary, in registration order. */
export function listCatalogVocabularies(): CatalogVocabulary[] {
  return listCatalogDefinitions().map(toVocabulary);
}

/**
 * The one place that decides whether a reader may read a catalog, and which
 * tier of detail they get.
 */
export function decideCatalogAccess(
  definition: CatalogDefinition,
  viewer: CatalogViewer,
): CatalogAccess {
  switch (definition.audience) {
    case "signed-out":
      break;

    case "signed-in":
      if (!viewer.authenticated) {
        return { allowed: false, reason: "This catalog requires signing in." };
      }
      break;

    case "gated": {
      if (!viewer.authenticated) {
        return { allowed: false, reason: "This catalog requires signing in." };
      }
      // `defineCatalog` guarantees a gated catalog names a permission; belt and
      // braces here so a hand-built definition cannot slip past unchecked.
      const permission = definition.viewPermission;
      if (!permission) {
        return {
          allowed: false,
          reason: "This catalog is gated but names no permission.",
        };
      }
      if (!viewer.hasPermission(permission)) {
        return {
          allowed: false,
          reason: `This catalog requires the '${permission}' permission.`,
        };
      }
      break;
    }

    default:
      return { allowed: false, reason: "This catalog declares no audience." };
  }

  const tier: CatalogTier =
    definition.restrictedPermission &&
    viewer.authenticated &&
    viewer.hasPermission(definition.restrictedPermission)
      ? "restricted"
      : "public";

  return { allowed: true, tier };
}

/**
 * Project an entry down to a tier.
 *
 * At the public tier `restricted` is absent from the result rather than
 * present-and-empty, so it cannot be sent and then hidden by whoever renders it.
 */
function projectEntry(entry: CatalogEntry, tier: CatalogTier): ResolvedCatalogEntry {
  return {
    id: entry.id,
    name: entry.name,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.component !== undefined ? { component: entry.component } : {}),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    ...(tier === "restricted" && entry.restricted !== undefined
      ? { restricted: entry.restricted }
      : {}),
  };
}

/**
 * Resolve a whole catalog at a tier.
 *
 * Private on purpose. Taking a tier as an argument, it will hand out restricted
 * detail to whoever asks for it — the tier has to be *decided*, and
 * {@link decideCatalogAccess} is the only thing that decides it.
 */
function resolveCatalog(
  definition: CatalogDefinition,
  tier: CatalogTier,
): ResolvedCatalog {
  return {
    id: definition.id,
    label: definition.label,
    ...(definition.description !== undefined
      ? { description: definition.description }
      : {}),
    audience: definition.audience,
    tier,
    entries: deriveCatalogEntries(definition).map((entry) => projectEntry(entry, tier)),
  };
}

/**
 * Read one catalog as a given reader.
 *
 * An unknown id is refused as unknown, not answered with an empty catalog — the
 * two mean very different things to whoever is looking.
 */
export function readCatalog(id: string, viewer: CatalogViewer): CatalogReadResult {
  const definition = getCatalogDefinition(id);
  if (!definition) {
    return { ok: false, reason: "unknown", message: `Unknown catalog '${id}'.` };
  }

  const access = decideCatalogAccess(definition, viewer);
  if (!access.allowed) {
    return { ok: false, reason: "denied", message: access.reason };
  }

  return { ok: true, catalog: resolveCatalog(definition, access.tier) };
}

/**
 * Summarize every catalog this reader may read. Catalogs they may not read are
 * absent entirely, so the index does not advertise what it will then refuse.
 */
export function listCatalogsFor(viewer: CatalogViewer): CatalogSummary[] {
  const summaries: CatalogSummary[] = [];

  for (const definition of listCatalogDefinitions()) {
    const access = decideCatalogAccess(definition, viewer);
    if (!access.allowed) continue;

    summaries.push({
      id: definition.id,
      label: definition.label,
      ...(definition.description !== undefined
        ? { description: definition.description }
        : {}),
      audience: definition.audience,
      tier: access.tier,
      entryCount: deriveCatalogEntries(definition).length,
    });
  }

  return summaries;
}
