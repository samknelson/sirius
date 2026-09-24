import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { normalizeFieldName, type TokenArgChoice } from "@shared/tokens";
import {
  buildTabHref,
  flattenTabTree,
  getTabTreeForEntity,
  type FlatTab,
} from "@shared/tabRegistry";
import { logger } from "../../logger";
import { tokenPluginRegistry, tokenRegistryVersion } from "./registry";
import { resolveRowKey } from "./row-key";
import type {
  TokenEntity,
  TokenEntityLocation,
  TokenEntityType,
  TokenPlugin,
} from "./types";

/**
 * WHERE A RECORD LIVES — ONE DECLARATION, ONE BUILDER.
 *
 * Every link in a template used to be written out by hand
 * (`{{system.base_url}}/grievance/{{grievance.field(name="id")}}`),
 * which made each author re-remember a route they cannot see from the
 * editor. The app already knows where everything lives: the shared tab
 * registry holds every entity's tabs and their href templates, and it is
 * what the app's own tabs navigate to.
 *
 * So a kind declares its location ONCE (see {@link TokenEntityLocation})
 * and everything derived from it — the `path` field, the `path` and
 * `url` leaves, their `tab` choices, the coverage report — comes through
 * this module. Nothing re-derives a route, so nothing can disagree about
 * one.
 *
 * The declarations are checked at boot rather than at first render: a
 * declaration that lies (an unknown tab, an id field that is not a
 * column, a table that already has a real `path` column) is a bug in the
 * plugin, and finding it at delivery means a 404 in someone's inbox.
 */

/** The field name a declaring kind advertises, normalized. */
export const ENTITY_PATH_FIELD = "path";

/** Segment names of the two derived leaves. */
export const ENTITY_PATH_SEGMENT = "path";
export const ENTITY_URL_SEGMENT = "url";

/**
 * The record id sample-mode previews render a link for. Static metadata
 * by design (never randomized — two renders of the same catalog must
 * agree), short enough to read, and obviously not a real id.
 */
export const SAMPLE_RECORD_ID = "12345678";

/** One kind's location, resolved against the live tab registry. */
export interface ResolvedEntityLocation {
  kind: TokenEntityType;
  /** Plugin that declared it, for diagnostics. */
  pluginId: string;
  /** Human label of the kind ("Grievance"), for token descriptions. */
  kindLabel: string;
  declaration: TokenEntityLocation;
  /** The declaring plugin's component gate, inherited by the leaves. */
  requiredComponent?: string;
  /** Tabs a token may name, in tree order. */
  tabs: FlatTab[];
  /** The declared default tab, resolved. */
  defaultTab: FlatTab;
  /**
   * True when the page belongs to a PARENT record and merely lists this
   * one (`idField` is a foreign key, not the record's own id). The
   * token's description has to say so, or someone later "fixes" it into
   * a 404.
   */
  borrowed: boolean;
}

/**
 * An href template must take exactly one `{id}` and nothing else: this
 * task deliberately does not add a second parameter, and a template
 * needing one would render a literal `{foo}` into a delivered link.
 */
function hrefTakesOnlyId(template: string): boolean {
  if (!template.includes("{id}")) return false;
  return !/\{[^}]*\}/.test(template.replace(/\{id\}/g, ""));
}

/** "Dispatch › Status" for a nested tab, "Notes" for a top-level one. */
function tabLabel(tab: FlatTab, all: FlatTab[]): string {
  if (!tab.parent) return tab.label;
  const parent = all.find((t) => t.id === tab.parent);
  return parent ? `${parent.label} › ${tab.label}` : tab.label;
}

/** Column names of a table, as both DB names and TS property names. */
function columnNamesOf(plugin: TokenPlugin): string[] {
  const table = plugin.metadata.entityTable;
  if (!table) return [];
  const out: string[] = [];
  for (const [prop, col] of Object.entries(getTableColumns(table))) {
    out.push(prop, (col as PgColumn).name);
  }
  return out;
}

/**
 * Every field name the kind's rows can be asked for: its table's columns
 * plus the extras it declares. A kind whose rows are assembled in code
 * rather than read from one table (a card check: a join, reshaped) has
 * no table at all, and its declared fields ARE the row it hands over —
 * so they are what an id field has to be one of. The check is the same
 * question either way: does the row carry the id the link is built from?
 */
function fieldNamesOf(plugin: TokenPlugin): string[] {
  return [...columnNamesOf(plugin), ...(plugin.metadata.entityFields ?? [])];
}

/**
 * Check one declaration against reality, returning the problems found.
 * Everything checked here is something that would otherwise surface as a
 * wrong or blank link in a delivered message.
 */
function problemsWith(
  plugin: TokenPlugin,
  declaration: TokenEntityLocation,
  tabs: FlatTab[],
  allTabs: FlatTab[],
): string[] {
  const problems: string[] = [];
  if (allTabs.length === 0) {
    problems.push(`tab entity "${declaration.tabEntity}" has no tabs`);
    return problems;
  }
  if (!tabs.some((t) => t.id === declaration.defaultTab)) {
    const known = allTabs.find((t) => t.id === declaration.defaultTab);
    problems.push(
      known
        ? `default tab "${declaration.defaultTab}" has an href template ` +
            `("${known.hrefTemplate}") that needs more than {id}`
        : `default tab "${declaration.defaultTab}" is not a tab of ` +
            `"${declaration.tabEntity}"`,
    );
  }
  const columns = columnNamesOf(plugin);
  const fields = fieldNamesOf(plugin);
  if (fields.length === 0) {
    problems.push(
      `the kind declares neither an entityTable nor any entityFields, so id ` +
        `field "${declaration.idField}" cannot be checked against anything ` +
        `its rows carry`,
    );
  } else {
    const wanted = normalizeFieldName(declaration.idField);
    if (!fields.some((c) => normalizeFieldName(c) === wanted)) {
      problems.push(
        `id field "${declaration.idField}" is neither a column of the kind's ` +
          `table nor one of its declared fields`,
      );
    }
  }
  // A stored column must always win over a derived one: a silent shadow
  // would change what an existing template renders.
  if (columns.some((c) => normalizeFieldName(c) === ENTITY_PATH_FIELD)) {
    problems.push(
      `the kind's table already has a real "path" column, which a derived ` +
        `path field would shadow`,
    );
  }
  if (
    (plugin.metadata.entityFields ?? []).some(
      (f) => normalizeFieldName(f) === ENTITY_PATH_FIELD,
    )
  ) {
    problems.push(`the kind already advertises a "path" field of its own`);
  }
  return problems;
}

let locationsCache: Map<TokenEntityType, ResolvedEntityLocation> | null = null;
let locationsVersion = -1;

/**
 * Every declared location, keyed by kind. Rebuilt when the registry
 * changes: registration is not a boot-only event, so a kind declared by
 * a module imported after the first render is picked up too.
 */
export function entityLocations(): Map<TokenEntityType, ResolvedEntityLocation> {
  const version = tokenRegistryVersion();
  if (!locationsCache || locationsVersion !== version) {
    locationsCache = collectEntityLocations();
    locationsVersion = version;
  }
  return locationsCache;
}

function collectEntityLocations(): Map<TokenEntityType, ResolvedEntityLocation> {
  const map = new Map<TokenEntityType, ResolvedEntityLocation>();
  const failures: string[] = [];
  // list() (not listEnabledSync) — component state gates ACCESS to the
  // kind's tokens, not whether its one declaration exists.
  for (const plugin of tokenPluginRegistry.list()) {
    const declaration = plugin.metadata.entityLocation;
    if (!declaration) continue;
    const kind = plugin.metadata.outputType;
    const existing = map.get(kind);
    if (existing) {
      failures.push(
        `Two token plugins declare where records of kind "${kind}" live ` +
          `(${existing.pluginId} and ${plugin.metadata.id}) — declare it once, ` +
          `on the plugin that owns the kind.`,
      );
      continue;
    }
    const allTabs = flattenTabTree(getTabTreeForEntity(declaration.tabEntity));
    const tabs = allTabs.filter((t) => hrefTakesOnlyId(t.hrefTemplate));
    const dropped = allTabs.filter((t) => !hrefTakesOnlyId(t.hrefTemplate));
    if (dropped.length > 0) {
      // Not fatal on its own — the tab is simply not offered — but it is
      // a route this mechanism cannot express, so say it out loud.
      logger.warn(
        `Token entity "${kind}" cannot offer ${dropped.length} tab(s) of ` +
          `"${declaration.tabEntity}": their href templates need more than {id}.`,
        { service: "tokens", tabs: dropped.map((t) => t.id) },
      );
    }
    const problems = problemsWith(plugin, declaration, tabs, allTabs);
    if (problems.length > 0) {
      failures.push(
        `Token plugin ${plugin.metadata.id} declares a location for kind ` +
          `"${kind}" that cannot be honoured: ${problems.join("; ")}.`,
      );
      continue;
    }
    map.set(kind, {
      kind,
      pluginId: plugin.metadata.id,
      kindLabel: plugin.metadata.name,
      declaration,
      requiredComponent: plugin.metadata.requiredComponent,
      tabs,
      defaultTab: tabs.find((t) => t.id === declaration.defaultTab)!,
      borrowed: normalizeFieldName(declaration.idField) !== "id",
    });
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  return map;
}

/**
 * Build the projection once at boot so a lying declaration fails loudly
 * at startup instead of as a 404 in a delivered message.
 */
export function validateTokenEntityLocations(): number {
  return entityLocations().size;
}

/** Does this kind declare where its records live? */
export function entityDeclaresLocation(kind: TokenEntityType): boolean {
  return entityLocations().has(kind);
}

/** Kinds that declare a location, for diagnostics. */
export function listEntityLocationKinds(): TokenEntityType[] {
  return [...entityLocations().keys()].sort();
}

/**
 * THE builder. Turns an entity plus an optional tab id into a relative
 * path, and returns null when there is no usable one — a snapshot row
 * carrying no id, a shaped entity that never had one. Every surface goes
 * through this rather than re-deriving anything.
 *
 * A tab the kind no longer has (one retired after a template was stored)
 * falls back to the kind's default tab: the reader gets the record's
 * page rather than a wrong link, and the editor is where the stale tab
 * is refused.
 */
export function resolveEntityPath(
  entity: TokenEntity,
  tabId?: string,
): string | null {
  const location = entityLocations().get(entity.kind);
  if (!location) return null;
  const key = resolveRowKey(entity, location.declaration.idField);
  if (!key) return null;
  const raw = entity.row[key];
  const id =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "number"
        ? String(raw)
        : "";
  if (!id) return null;
  const tab =
    (tabId ? location.tabs.find((t) => t.id === tabId) : undefined) ??
    location.defaultTab;
  return buildTabHref(tab.hrefTemplate, encodeURIComponent(id));
}

/** The path a sample-mode preview shows for a kind. */
export function sampleEntityPath(
  kind: TokenEntityType,
  tabId?: string,
): string | null {
  const location = entityLocations().get(kind);
  if (!location) return null;
  const tab =
    (tabId ? location.tabs.find((t) => t.id === tabId) : undefined) ??
    location.defaultTab;
  return buildTabHref(tab.hrefTemplate, SAMPLE_RECORD_ID);
}

/**
 * The `tab` argument's choices for a kind: every tab the kind's page
 * has, each carrying its component gate so a picker can offer only the
 * ones that are switched on while validation keeps accepting them all.
 */
export function tabChoicesForKind(kind: TokenEntityType): TokenArgChoice[] {
  const location = entityLocations().get(kind);
  if (!location) return [];
  return location.tabs.map((tab) => ({
    value: tab.id,
    label: tabLabel(tab, location.tabs),
    ...(tab.component ? { component: tab.component } : {}),
  }));
}
