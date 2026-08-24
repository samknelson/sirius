import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import {
  createUnifiedOptionsStorage,
  optionsMetadata,
  type OptionsTypeName,
  type UnifiedOptionsStorage,
} from "../../../storage/unified-options";
import { registerTokenPlugin, tokenPluginRegistry } from "../registry";
import { createRelationSweep, type RelationOwner } from "../relation-sweep";
import { DEFAULT_SAMPLE_SET_ID } from "../sample-sets";
import { memo, tokenEntityOf, type TokenEntityType } from "../types";
import { resolveRowKey } from "./field";

/**
 * OPTIONS TOKENS — GENERATED, NOT HAND-WRITTEN.
 *
 * An options table (`options_grievance_status`, `options_department`, …)
 * is reference data every entity points at by id. The generic `field`
 * leaf already renders the referenced row's `name` instead of the raw id
 * (`{{grievance_status_history.field(name="status_id")}}` says "Filed"),
 * but the option ROW itself was unreachable: nothing could say "the
 * description of that status" or "its sequence".
 *
 * Both halves of what that needs are already declared elsewhere, so
 * nothing here is written per options type or per referencing column:
 *   - the unified-options framework knows every options type's table,
 *     display name and owning component;
 *   - Drizzle knows which entity column points at which options table.
 *
 * This module joins the two at boot: for every token entity kind whose
 * table has a single-column foreign key into an options table, it
 * registers a relation segment NAMED AFTER THE TARGET TABLE, plus a
 * descriptor for the options kind itself:
 *
 *   {{grievance_status_history.options_grievance_status}}
 *       → the status's name (its default leaf)
 *   {{grievance_status_history.options_grievance_status.field(name="description")}}
 *       → any other field of the same row
 *
 * Table-derived naming is deliberate. A segment called `status` would
 * mean a different table under every parent; `options_grievance_status`
 * names exactly one table wherever it appears.
 *
 * Deliberately NOT generated:
 *   - relations OFF an options kind (an options table's own foreign keys,
 *     including a self-referencing `parent`): one hop from real records
 *     into reference data keeps the graph finite and predictable, and
 *     `field(name="parent")` still renders the parent's name;
 *   - anything for array or convention-only references with no real
 *     foreign key — there is nothing to discover.
 */

/** One options table, as a token entity kind. */
interface OptionsTarget {
  type: OptionsTypeName;
  /** Token entity kind AND segment name: the DB table name. */
  kind: TokenEntityType;
  table: AnyPgTable;
}

/** An entity kind that can own a reference into an options table. */
type OwnerKind = RelationOwner;

let storage: UnifiedOptionsStorage | null = null;
function optionsStorage(): UnifiedOptionsStorage {
  if (!storage) storage = createUnifiedOptionsStorage();
  return storage;
}

/** Every options table, keyed by its DB table name. Built once. */
let targetCache: Map<string, OptionsTarget> | null = null;
function optionsTargets(): Map<string, OptionsTarget> {
  if (targetCache) return targetCache;
  const map = new Map<string, OptionsTarget>();
  for (const type of Object.keys(optionsMetadata) as OptionsTypeName[]) {
    const table = optionsMetadata[type].table as AnyPgTable;
    const name = getTableConfig(table).name;
    map.set(name, { type, kind: name, table });
  }
  targetCache = map;
  return map;
}

/**
 * The owner kind a plugin declares, if it can own a reference into an
 * options table: it must name a table, and it must not BE an options
 * kind (see the "deliberately not generated" note above).
 */
function ownerOf(metadata: {
  outputType: TokenEntityType;
  entityTable?: AnyPgTable;
  requiredComponent?: string;
}): OwnerKind | null {
  const { outputType, entityTable, requiredComponent } = metadata;
  if (!entityTable || outputType === "value" || outputType === "root") return null;
  if (optionsTargets().has(outputType)) return null;
  return { kind: outputType, table: entityTable, requiredComponent };
}

/**
 * Register the options table as a token entity kind: its columns are its
 * field catalog, `name` is what the bare segment renders, and it is
 * gated by the component that owns the options type (an optional
 * component's table can be absent from the database entirely).
 */
function ensureOptionsEntityKind(target: OptionsTarget): void {
  const id = `token.options.${target.type}`;
  if (tokenPluginRegistry.has(id)) return;
  const meta = optionsMetadata[target.type];
  registerTokenPlugin({
    metadata: {
      id,
      name: meta.displayName,
      description: `Descriptor for the ${meta.singularName.toLowerCase()} options entity kind`,
      // Never matches as a segment (`inputTypes: []`) — it exists so the
      // kind has a field catalog, a default leaf and sample data.
      segmentName: `__${target.kind}`,
      inputTypes: [],
      outputType: target.kind,
      entityTable: target.table,
      defaultLeaf: "name",
      hiddenFromCatalog: true,
      requiredComponent: meta.requiredComponent,
      // Reference data is not personal data, but a preview with no record
      // has no option to show either: render an obviously-fake label, the
      // way every other sampled entity does.
      sampleSets: [
        {
          id: DEFAULT_SAMPLE_SET_ID,
          label: "Sample data",
          values: {
            name: `Sample ${meta.singularName}`,
            description: `Sample ${meta.singularName.toLowerCase()} description`,
          },
        },
      ],
    },
    async resolve() {
      return null;
    },
  });
}

/** Register one owner-kind → options-table relation segment. */
function registerOptionsRelation(
  owner: OwnerKind,
  target: OptionsTarget,
  column: string,
): string | null {
  const id = `token.options_relation.${owner.kind}.${target.kind}`;
  if (tokenPluginRegistry.has(id)) return null;
  const meta = optionsMetadata[target.type];
  ensureOptionsEntityKind(target);
  registerTokenPlugin({
    metadata: {
      id,
      name: meta.singularName,
      description: `The ${meta.singularName.toLowerCase()} this record references (${column})`,
      segmentName: target.kind,
      inputTypes: [owner.kind],
      outputType: target.kind,
      entityTable: target.table,
      defaultLeaf: "name",
      generated: true,
      // Kept out of the flat bulk-messaging catalog (one entry per
      // options table per entity would bury it); the token browser walks
      // hidden relations, so an author who navigated here still sees it.
      hiddenFromCatalog: true,
      // The options type's own component decides whether its data exists
      // at all; where it has none, the owner's gate is the honest one.
      requiredComponent: meta.requiredComponent ?? owner.requiredComponent,
    },
    async resolve(entity, _args, ctx) {
      const e = tokenEntityOf(entity, owner.kind);
      if (!e) return null;
      const key = resolveRowKey(e, column);
      if (!key) return null;
      const value = e.row[key];
      // A null or empty reference is a record that simply has no option
      // set: the chain resolves to nothing and renders its default.
      if (typeof value !== "string" || value === "") return null;
      const row = await memo(ctx, `options-row:${target.kind}:${value}`, async () => {
        const found = await optionsStorage().get(target.type, value);
        return (found ?? null) as Record<string, unknown> | null;
      });
      if (!row) return null;
      return { kind: target.kind, row, table: target.table };
    },
  });
  return id;
}

/**
 * The walk itself — which owners, which foreign keys, and keeping up
 * with kinds registered after boot — is the shared relation sweep; this
 * module supplies only the options-specific half.
 */
const sweep = createRelationSweep<OptionsTarget>({
  label: "options",
  ownerOf,
  targetFor(tableName) {
    const target = optionsTargets().get(tableName);
    if (!target) return null;
    return { kind: target.kind, table: target.table, meta: target };
  },
  register(owner, target, column) {
    return registerOptionsRelation(owner, target.meta, column);
  },
});

/**
 * Generate the options side of the token graph, and keep generating it.
 * Returns the ids generated by the initial sweep, for the boot log.
 */
export function registerOptionsTokens(): string[] {
  return sweep();
}
