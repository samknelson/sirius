import type { IStorage } from "../../storage";
import type { BasePluginMetadata } from "../_core/types";
import type { TokenArgSpec } from "@shared/tokens";
import type { TabEntityType } from "@shared/tabRegistry";
import type { AnyPgTable } from "drizzle-orm/pg-core";

/**
 * Entity types flowing through a token chain. "root" is the implicit
 * type at the start of every chain; "value" terminates it. Every other
 * type names an entity kind produced by an entity/relation segment
 * (e.g. "contact", "worker", "bargaining_unit", "address").
 */
export type TokenEntityType = string;

/**
 * The object produced by every entity/relation segment. `row` holds the
 * full underlying record (all columns — template authors are trusted);
 * `table` is the Drizzle table it came from, when there is one, so the
 * generic `field` segment can resolve column names and follow foreign
 * keys to option display names.
 */
export interface TokenEntity {
  kind: TokenEntityType;
  row: Record<string, unknown>;
  table?: AnyPgTable;
}

export function tokenEntityOf(entity: unknown, kind: string): TokenEntity | null {
  const e = entity as TokenEntity | null;
  return e && typeof e === "object" && e.kind === kind && e.row ? e : null;
}

/**
 * One root of a render, seeded with a real record: the NAME a chain
 * starts with plus the record it stands for. Named, not kind-keyed, so
 * a render can seed two roots of the same kind.
 */
export interface TokenRootSeed {
  /** Root segment name as written in templates (`dispatch`, `contact`). */
  name: string;
  entity: TokenEntity;
}

/**
 * How reading ONE record of a token entity kind is authorized.
 *
 * There is no shared "may this user read an entity of kind K" resolver
 * in the codebase, and the two ways a read is gated today are genuinely
 * different shapes, so each kind says which one it is:
 *
 *  - `record` — an entity-scoped policy evaluated against a specific id
 *    (`worker.view`, `edls.sheet.view`). The id checked is the record's
 *    own id unless the kind names another subject (a dispatch status row
 *    is read as a read of its WORKER), which is why a search hit and a
 *    load both carry the subject id they were authorized on.
 *  - `route` — the broad gate the kind's own pages use, with no entity
 *    id at all (a grievance read is `staff` plus the grievance
 *    component; a dispatch job read is `admin` plus dispatch). Preview
 *    enforces the SAME gate: it is not preview's job to invent a
 *    per-record rule the rest of the app does not have.
 */
export type TokenPreviewGate =
  | { scope: "record"; policy: string }
  | { scope: "route"; policy: string };

/** One record a container supplied, as the picker shows it. */
export interface TokenPreviewRecordRef {
  /** Record id — what `load` is later called with. */
  id: string;
  /**
   * Readable label for the picker row ("Ada Lovelace").
   *
   * OMIT IT to have the kind name the record itself. A container that
   * knows only ids — a replay of recent events knows which record each
   * root would have been seeded with, not how that kind reads or what
   * it is called — then has nothing else to learn: the same `load` the
   * render uses returns both the label and the subject the gate is
   * asked about. A record that no longer loads is dropped rather than
   * offered, so the picker never lists something the render would
   * refuse.
   */
  label?: string;
  /** Secondary line: whatever tells two same-named records apart. */
  hint?: string;
  /**
   * The occurrence(s) this record came out of, when a container's
   * records come in coherent sets — one replayed event yields the
   * grievance AND the status entry AND the recipient it fired for.
   * Records sharing an occurrence belong together, and the picker moves
   * them together, so a preview cannot show one event's grievance
   * beside another event's status entry. Ids are the container's own
   * and mean nothing outside its list.
   *
   * Omit it when the records are unrelated to each other (a bulk
   * message's recipients), which leaves each root picked on its own.
   */
  occurrenceIds?: string[];
  /**
   * Id a `record`-scoped gate is evaluated against. Defaults to `id`;
   * set it where the read is authorized through another record (a
   * dispatch status row is gated as a read of its worker). Left out
   * alongside the label, the kind's own load supplies it.
   */
  gateEntityId?: string;
}

/** A record ref that has been named — by its container or by its kind. */
export interface TokenPreviewNamedRecordRef extends TokenPreviewRecordRef {
  label: string;
}

/** One record loaded by id, ready to seed a render. */
export interface TokenPreviewLoadedRecord {
  entity: TokenEntity;
  /** The label the picker showed, so the studio can name what it rendered. */
  label: string;
  /** Gate subject id — see {@link TokenPreviewRecordRef.gateEntityId}. */
  gateEntityId?: string;
}

/**
 * How a REAL record of one token entity kind may be used as the context
 * a template is previewed against.
 *
 * A preview that renders against a real record is a read of that
 * record, so it has to be gated like one. The declaration has exactly
 * two responsibilities: it says how a read of this kind is authorized,
 * and it loads one record by id. It never produces records — which
 * records exist here is the container's answer, not the kind's — and
 * the gate it declares is run on the SAME subject id whether a
 * container's record is being screened for the picker or a named one is
 * being loaded, so the two can never drift apart.
 *
 * FAIL CLOSED: a kind with no declaration cannot be used as a preview
 * context at all. Declaring one is a deliberate statement that "may
 * this user read this record?" has an answer here; without it the
 * preview endpoint refuses the kind rather than guessing.
 *
 * Declared ONCE per entity kind, on the token plugin that owns the kind.
 */
export interface TokenPreviewEntitySource {
  /** How a read of one record of this kind is authorized. */
  gate: TokenPreviewGate;
  /**
   * Component that must be enabled for this kind's data to be visible.
   * Defaults to the declaring plugin's `requiredComponent`: an optional
   * component's tables can be absent from the database entirely, so an
   * unguarded load errors instead of refusing.
   */
  requiredComponent?: string;
  /**
   * Load the record somebody NAMED, or null when there is no such
   * record.
   *
   * This is the only way token land reaches for a record, and it always
   * has an id in hand. A kind never lists or searches its table: which
   * record a template is previewed against is a question the container
   * opening the studio already answered, and a hook that answered
   * "what records of this kind exist here?" would be a record finder
   * bolted onto a template editor.
   */
  load(storage: IStorage, id: string): Promise<TokenPreviewLoadedRecord | null>;
  /**
   * This kind's records are ADDRESSED TO a contact: given one of its
   * rows, whose.
   *
   * Declare it when the record IS a send — a row that exists because a
   * message is going to somebody. Delivery renders such a record with
   * that person as the recipient, so a preview seeded with it must do
   * the same, or `{{contact…}}` and `{{worker…}}` would show sample
   * people beside a real send and the preview would disagree with the
   * message that arrives.
   *
   * A contact the caller named outright still wins: naming a recipient
   * is more specific than a record implying one.
   */
  recipientContactIdOf?(row: Record<string, unknown>): string | undefined;
}

/**
 * A named, wholly fictional persona for one token entity kind: the
 * values its fields render as when a template is previewed against
 * sample data instead of a real record.
 *
 * Declared on the plugin that owns the kind. Set ids are a SHARED
 * vocabulary across kinds: previewing with "martian" renders the
 * martian contact, the martian worker and the martian employer
 * together, so one pick yields a coherent story across every token in
 * the template. A kind that does not declare the chosen id falls back
 * to its own first set, and a field the set does not name falls back to
 * the token's own `example` / `sampleValue`.
 */
export interface TokenSampleSet {
  /** Shared across kinds — same id, same persona (e.g. "martian"). */
  id: string;
  /** Human label for the picker ("Martian"). Only the first kind's wins. */
  label: string;
  /**
   * Rendered value per field, keyed by the `field(name=…)` name
   * (snake_case or camelCase) or, for a leaf that is not a plain field,
   * by that leaf's segment name (e.g. "member_status").
   */
  values: Record<string, string>;
}

/**
 * WHERE a record of one token entity kind lives in the app.
 *
 * A kind names its PAGE, it never spells a URL: the shared tab registry
 * already holds every entity's tabs and their href templates, it is what
 * the app's own tabs navigate to, and it is readable from here. So a
 * kind says which tab-registry entity it corresponds to, which row field
 * carries that entity's id, and which tab a bare `{{kind.path}}` lands
 * on — and the paths are derived from that. Hardcoding a route into a
 * token plugin would be a second copy of the route table, free to rot
 * the first time someone restructures a page.
 *
 * A SUB-ENTITY borrows its parent's page: a grievance status-history row
 * has no page of its own, but the grievance's timeline tab lists it, so
 * it declares `tabEntity: "grievance"`, `idField: "grievanceId"`,
 * `defaultTab: "timeline"`. One mechanism, no special case — a
 * sub-entity is just a location whose id comes from a foreign key, which
 * is exactly what `idField !== "id"` says.
 *
 * Declared ONCE per kind, on the plugin that owns the kind. A kind that
 * declares nothing offers no `path`/`url` token at all: an advertised
 * token that renders blank is the failure this framework treats as a bug.
 */
export interface TokenEntityLocation {
  /** Tab-registry entity whose page shows (or lists) the record. */
  tabEntity: TabEntityType;
  /**
   * Row field carrying that entity's id: the record's own `id` for a
   * top-level kind, a foreign key for a sub-entity borrowing a parent's
   * page. Must be a column of the kind's declared table, or — for a kind
   * whose rows are assembled in code — one of its declared
   * {@link TokenPluginMetadata.entityFields}.
   */
  idField: string;
  /**
   * Tab a bare `{{kind.path}}` lands on. Named explicitly rather than
   * assumed to be the first tab or one called "details" — the
   * bargaining-unit tree calls its detail tab `view`.
   */
  defaultTab: string;
}
export interface TokenPluginMetadata extends BasePluginMetadata {
  /**
   * Segment name as written in templates (e.g. "field"). Not
   * necessarily unique — the same name may exist for different input
   * types — which is why `id` (unique) is a separate field.
   */
  segmentName: string;
  /**
   * Entity types this segment can be applied to; "root" starts chains.
   * "*" means any entity type except root (used by the generic field
   * segment).
   */
  inputTypes: TokenEntityType[];
  /** Entity type produced; "value" means a final string. */
  outputType: TokenEntityType;
  /** Argument schema. Defaults are applied before `resolve` runs. */
  args?: Record<string, TokenArgSpec>;
  /** Fallback rendered when the chain resolves to null/empty. */
  defaultValue?: string;
  /**
   * Example value used for sample previews (leaf segments).
   *
   * REQUIRED of every value-producing token (`outputType: "value"`)
   * unless the plugin declares `sampleValue` or a non-empty
   * `defaultValue`: in sample mode a leaf renders
   * `sampleValue(args) ?? example ?? defaultValue ?? ""`, so a token
   * with none of them renders an empty string and the preview shows an
   * invisible hole. Write a realistic, obviously-fake value ("Apr 17,
   * 2026", "https://example.com") — static metadata, never randomized.
   */
  example?: string;
  /** Short label fragment used to build catalog labels. */
  shortLabel?: string;
  /**
   * When true, the resolved value is trusted HTML and is NOT escaped in
   * HTML media (it must be sanitized by the plugin itself). Everything
   * else is escaped. Explicit declaration only — never inferred.
   */
  emitsHtml?: boolean;
  /**
   * For entity-producing segments: the Drizzle table whose columns are
   * the valid `field(name=…)` names for the produced entity. Field
   * lists ship to the client for author-time validation and are always
   * derived from the live schema — never hardcoded.
   */
  entityTable?: AnyPgTable;
  /** Extra field names beyond the table's columns (derived/denorm). */
  entityFields?: string[];
  /** The produced entity's field set can't be enumerated; accept any name. */
  entityFieldsOpen?: boolean;
  /**
   * For entity-producing segments: when a chain ends at the produced
   * entity kind (no explicit leaf), implicitly append
   * `field(name=<defaultLeaf>)` so authors can write e.g.
   * `{{event.worker.contact}}` instead of
   * `{{event.worker.contact.field(name="display_name")}}`.
   * Declare on any ONE plugin that produces the kind; evaluation and
   * validation look up the first match by outputType.
   */
  defaultLeaf?: string;
  /** Hide from the generated picker catalog (still evaluatable). */
  hiddenFromCatalog?: boolean;
  /**
   * Set by the relation sweeps on a segment they DERIVED from a foreign
   * key, rather than one someone wrote. A sweep refuses to generate a
   * relation a hand-written plugin already declares, but it can only
   * refuse what is registered by the time it runs: registration is not a
   * boot-only event. So the flag also settles the reverse order —
   * `findSegmentPlugin` prefers the hand-written plugin, which knows
   * something the sweep does not.
   */
  generated?: boolean;
  /**
   * Root segments only: this root exists ONLY in renders whose surface
   * declares it by name — the records a notifier seeds
   * (`{{dispatch.…}}`, `{{sitespecific_t631_interview.…}}`) and the
   * `event` envelope. Context roots are left out of the default segment
   * graph and catalog (bulk messaging has no notifier records, so
   * `{{dispatch.…}}` is an unknown token there); a surface that knows
   * its roots uses `buildSegmentSpecsForRoots` / the tree API with the
   * root names it seeds.
   */
  contextRoot?: boolean;
  /**
   * Root segments only: the root resolves from the render's recipient
   * contact when its own kind has no seeded record (`{{worker…}}` in a
   * delivered message means "the recipient's worker"). Such a root
   * counts as real — not sample — whenever a recipient is present.
   */
  recipientRooted?: boolean;
  /**
   * Root segments only: the root resolves from the render context alone
   * (`{{system…}}` — dates, site origin), so there is no record to pick
   * for it and nothing personal behind it. A seedless root therefore
   * ALWAYS resolves for real, sample mode included: its values are the
   * same in a preview as at delivery, and showing them fake would only
   * hide the link and date mistakes a preview exists to catch. Its
   * `example`/`sampleValue` declarations still drive the picker's
   * example column.
   */
  seedless?: boolean;
  /**
   * How a real record of the kind this plugin produces may be named as
   * a preview context, and how reading it is gated (see
   * {@link TokenPreviewEntitySource}). Declare on exactly ONE plugin
   * per entity kind (the one that owns the kind — its root or its
   * entity descriptor); the projection is built at boot and refuses two
   * declarations for one kind. Absent means the kind cannot be
   * previewed against.
   */
  previewEntity?: TokenPreviewEntitySource;
  /**
   * Named sample personas for the kind this plugin produces (see
   * {@link TokenSampleSet}). Declare on the plugin that owns the kind.
   * Optional: a kind with no declared set still previews, rendering
   * each token's own `example` / `sampleValue`.
   */
  sampleSets?: TokenSampleSet[];
  /**
   * Where a record of the kind this plugin produces lives in the app
   * (see {@link TokenEntityLocation}). Declare on exactly ONE plugin per
   * entity kind — the one that owns the kind. Declaring it is what gives
   * the kind its `path` / `url` tokens and its `path` field; absent
   * means the kind has no page and offers neither.
   */
  entityLocation?: TokenEntityLocation;
}

/**
 * Per-render evaluation context. One per recipient per delivery; the
 * `cache` may be shared across recipients within one run (memo keys
 * must therefore be fully qualified, e.g. include the contact id).
 */
export interface TokenEvalContext {
  storage: IStorage;
  /**
   * Recipient contact. The one seed the delivery pipeline always has:
   * recipient-rooted roots (`recipientRooted`) resolve from it when
   * their own kind is not seeded in `roots`.
   */

  contactId?: string;

  now: Date;
  /**
   * Sample fallback (preview only): a chain whose ROOT has no seed
   * renders sample values instead of hitting the DB. A seeded root
   * still resolves for real, so one render can mix real and sample
   * roots. Never set on delivery — there every root resolves for real
   * and a missing record renders the chain's default.
   */

  sample?: boolean;
  /**
   * Which named sample persona a sample-mode chain renders, keyed by the
   * ROOT NAME the chain starts at (see {@link TokenSampleSet}). The
   * persona is chosen per root, so two sample roots in one render can
   * be two different people. A root with no entry here — or a kind that
   * does not declare the chosen id — renders that kind's first declared
   * set, and then the token's own `example`.
   */

  sampleSetIds?: Record<string, string>;
  /**
   * Seeded root entities keyed by ROOT NAME — the segment a chain
   * starts with (`dispatch`, `contact`, `event`), not the entity kind:
   * one render can seed two roots of the same kind (a worker and a
   * steward). A chain whose root is present here resolves against that
   * real record; anything else falls back to the recipient
   * (recipient-rooted roots) or to samples.
   */

  roots: Record<string, TokenEntity>;
  /** Cross-segment memo cache. */

  cache: Map<string, unknown>;
  /**
   * Free-form context bag updated as the chain advances. `entity`
   * always holds the current object.
   */

  vars: Record<string, unknown>;
}

/** Memoize an async lookup in the context cache. */
export async function memo<T>(
  ctx: TokenEvalContext,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T;
  const v = await fn();
  ctx.cache.set(key, v);
  return v;
}

export interface TokenPlugin {
  metadata: TokenPluginMetadata;
  /**
   * Resolve this segment. `entity` is the object produced by the
   * previous segment (null at chain start). `args` has defaults already
   * applied. Return the next entity object, or the final value (string
   * / number / null) for "value" segments. Null/undefined/"" values
   * render the chain's default.
   */
  resolve(
    entity: unknown,
    args: Record<string, string>,
    ctx: TokenEvalContext,
  ): Promise<unknown>;
  /**
   * Sample-mode value for leaf segments whose example depends on args
   * (e.g. the generic field segment, or a date with a custom format).
   * Falls back to metadata.example. Must never return an empty string
   * for the segment's default arguments — see `example`.
   */
  sampleValue?(args: Record<string, string>): string;
}
