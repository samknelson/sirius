/**
 * Shared catalog framework — types.
 *
 * A *catalog* is a code-supplied list of things this deployment offers:
 * permissions, components, flood events, plugin types, the areas that can
 * carry files or notes, and so on. Its defining property is provenance —
 * everything in it comes from source, never from the database.
 *
 * Configured state is deliberately NOT here. Variable values, plugin config
 * rows, terminology substitutions, effective flood thresholds, component
 * enabled-state, environment-variable values and role assignments all stay on
 * the screens that already own them. A catalog answers "what does the code
 * offer", never "what is it set to".
 */

/**
 * A JSON-representable value.
 *
 * Detail payloads are constrained to this on purpose. Anything a catalog
 * carries has to survive being serialized to a client, so a live Zod schema, a
 * Drizzle table object or an async schema-producing function cannot be
 * embedded. Reference it instead — a path, an id, a name the reader can look
 * up — and let the owner of that thing serve it.
 */
export type CatalogValue =
  | string
  | number
  | boolean
  | null
  | CatalogValue[]
  | { [key: string]: CatalogValue };

/** A detail payload attached to a catalog entry. */
export type CatalogDetail = Record<string, CatalogValue>;

/**
 * Who a catalog is for.
 *
 * Each catalog declares its own, rather than inheriting one blanket rule.
 * `signed-out` exists because at least one list genuinely has to be readable
 * before sign-in: the login page needs the auth-provider list to render.
 */
export type CatalogAudience = "signed-out" | "signed-in" | "gated";

/**
 * Which slice of a catalog a given reader received.
 *
 * One catalog can answer two different ways depending on who is asking, so the
 * tier travels with the answer. A caller that caches a catalog read must key on
 * this, or a restricted answer can be replayed to a reader who should only see
 * the public one.
 */
export type CatalogTier = "public" | "restricted";

/**
 * One thing a catalog offers.
 */
export interface CatalogEntry {
  /** Stable identifier, unique within its catalog. */
  id: string;

  /** Human-readable name. */
  name: string;

  /** What this entry is, in a sentence. */
  description?: string;

  /**
   * The component that supplies this entry, when one does. Entries whose
   * component is switched off are absent from the catalog. Omit for anything
   * core supplies unconditionally.
   */
  component?: string;

  /** Detail every permitted reader of this catalog may see. */
  detail?: CatalogDetail;

  /**
   * Detail only a reader holding the catalog's `restrictedPermission` may see.
   *
   * These are code-supplied defaults, never values in effect. Name the keys so
   * that is impossible to misread — `defaultThreshold`, not `threshold` — or an
   * admin screen will confidently display a number the running system is not
   * using.
   */
  restricted?: CatalogDetail;
}

/**
 * A catalog declaration.
 */
export interface CatalogDefinition {
  /** Stable identifier, unique across all catalogs. */
  id: string;

  /** Human-readable name, for an index of catalogs. */
  label: string;

  /** What this catalog lists, in a sentence. */
  description?: string;

  /** Who may read it. */
  audience: CatalogAudience;

  /** Required, and only allowed, when `audience` is `gated`. */
  viewPermission?: string;

  /**
   * Permission required to receive entries' `restricted` detail.
   *
   * A catalog with nothing to hide declares none. Declaring none is also a
   * promise: an entry that produces `restricted` detail under a catalog that
   * declared no permission for it is a declaration error and is refused, rather
   * than being quietly published or quietly dropped.
   */
  restrictedPermission?: string;

  /**
   * Produce the entries.
   *
   * Called on every read, deliberately. Deriving rather than materializing at
   * startup is what makes component switching correct in both directions with
   * no restart, no synchronization step and no cache to bust.
   */
  entries: () => readonly CatalogEntry[];
}

/**
 * The reader a catalog is being resolved for.
 *
 * Permission checks are synchronous because a catalog read happens after the
 * caller has already resolved who is asking; supply a closure over the
 * permissions you have already loaded.
 */
export interface CatalogViewer {
  authenticated: boolean;
  hasPermission(permission: string): boolean;
}

/** An anonymous reader. Only `signed-out` catalogs resolve for this viewer. */
export const ANONYMOUS_VIEWER: CatalogViewer = {
  authenticated: false,
  hasPermission: () => false,
};

/** The access decision for one viewer against one catalog. */
export type CatalogAccess =
  | { allowed: true; tier: CatalogTier }
  | { allowed: false; reason: string };

/** An entry as delivered to a reader, projected down to their tier. */
export interface ResolvedCatalogEntry {
  id: string;
  name: string;
  description?: string;
  component?: string;
  detail?: CatalogDetail;
  restricted?: CatalogDetail;
}

/** One catalog as delivered to a reader. */
export interface ResolvedCatalog {
  id: string;
  label: string;
  description?: string;
  audience: CatalogAudience;
  tier: CatalogTier;
  entries: ResolvedCatalogEntry[];
}

/**
 * An entry as a vocabulary lookup sees it: identity, and nothing else.
 *
 * A vocabulary lookup answers "does this stored id still mean something, and
 * what is it called" while interpreting data that was saved earlier. It is
 * deliberately unfiltered by component state — a saved reference stays valid
 * when its component is switched off — which also means it is answered without
 * a reader, an audience check or a tier. So it carries no payload at all,
 * open or restricted.
 */
export interface CatalogVocabularyEntry {
  id: string;
  name: string;
  component?: string;
}

/** One catalog's full declared vocabulary. */
export interface CatalogVocabulary {
  id: string;
  label: string;
  audience: CatalogAudience;
  entries: CatalogVocabularyEntry[];
}

/** A catalog's headline, for an index. */
export interface CatalogSummary {
  id: string;
  label: string;
  description?: string;
  audience: CatalogAudience;
  tier: CatalogTier;
  entryCount: number;
}

/** The outcome of reading one catalog. */
export type CatalogReadResult =
  | { ok: true; catalog: ResolvedCatalog }
  | { ok: false; reason: "unknown" | "denied"; message: string };
