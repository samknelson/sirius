import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { logger } from "../../../logger";
import { optionsMetadata, type OptionsTypeName } from "../../../storage/unified-options";
import {
  registerTokenPlugin,
  tokenPluginRegistry,
  tokenRegistryVersion,
} from "../registry";
import { createRelationSweep, type RelationOwner } from "../relation-sweep";
import {
  memo,
  tokenEntityOf,
  type TokenEntity,
  type TokenEntityType,
  type TokenEvalContext,
  type TokenPluginMetadata,
  type TokenPreviewEntitySource,
} from "../types";
import { resolveRowKey } from "./field";

/**
 * ENTITY RELATION TOKENS — GENERATED, NOT HAND-WRITTEN.
 *
 * A record that points at another record could only be read THROUGH the
 * pointer: `{{dispatch_job.field(name="employer_id")}}`. That renders
 * the employer's name rather than a raw id only because the generic
 * field leaf follows a foreign key to a `name` column — which makes the
 * token both a lie about what it says and a dead end, because the
 * employer's every other field stays unreachable from the job.
 *
 * The relation itself is already declared, twice over: Drizzle knows
 * which column points at which table, and the token plugins know which
 * entity kind owns each table. This module joins the two at boot, the
 * way `./options` does for reference data, and registers a relation
 * segment NAMED AFTER THE TARGET KIND:
 *
 *   {{dispatch_job.employer}}
 *       → the employer's name (its default leaf)
 *   {{dispatch_job.employer.field(name="sirius_id")}}
 *       → any other field of the employer
 *
 * Naming differs from the options sweep deliberately. There a segment
 * is named after the target TABLE, because a segment called `status`
 * would mean a different table under every parent. Entity kinds have no
 * such ambiguity — one kind, one table — so these follow the convention
 * every hand-written relation already uses and are named after the kind.
 *
 * Deliberately NOT generated:
 *   - a relation whose name is already taken on that owner: a
 *     hand-written segment knows something this sweep does not (that
 *     `{{worker.home_employer}}` means the HOME one), and silently
 *     shadowing it would change what a stored template renders;
 *   - relations off reference data, and relations INTO it — those are
 *     the options sweep's, and generating both would give one column two
 *     differently-named segments;
 *   - self-references (`{{contact.contact}}` says nothing);
 *   - a target whose field catalog advertises derived fields this sweep
 *     cannot build (see `loadTargetEntity`): a relation that resolves to
 *     a bare table row would offer fields that silently render blank.
 */

/** A token entity kind this sweep can point a relation AT. */
interface EntityKindInfo {
  kind: TokenEntityType;
  table: AnyPgTable;
  tableName: string;
  /** Authority of the plugin the label and gate came from (lower wins). */
  rank: number;
  /** Human label, from the plugin that speaks for the kind. */
  label: string;
  /** The kind's OWN component gate (the descriptor's, not a relation's). */
  requiredComponent?: string;
  /** Field names the kind advertises beyond its table's columns. */
  entityFields: string[];
  entityFieldsOpen: boolean;
  /** How the kind loads one of its records by id, when it declares one. */
  load?: TokenPreviewEntitySource["load"];
}

/** Table names owned by the options sweep — neither owner nor target here. */
let optionsTableNames: Set<string> | null = null;
function isOptionsTable(tableName: string): boolean {
  if (!optionsTableNames) {
    optionsTableNames = new Set(
      (Object.keys(optionsMetadata) as OptionsTypeName[]).map((type) =>
        getTableConfig(optionsMetadata[type].table as AnyPgTable).name,
      ),
    );
  }
  return optionsTableNames.has(tableName);
}

/**
 * How well a plugin speaks for the kind it produces, lowest first.
 *
 * A kind is declared across several plugins, and they do not agree:
 * `{{sitespecific_t631_interview.worker}}` calls the worker kind
 * "Interview worker" and gates it behind the interviews component,
 * because that is what a worker is FROM AN INTERVIEW. Read as a
 * statement about the kind itself it is simply wrong, and a generated
 * relation that inherited it would gate the dispatch board's employer
 * behind a site-specific component.
 *
 * So the kind is described by the plugin that produces it as ITSELF —
 * its descriptor (matching no segment) or its top-level entry from the
 * root — and only falls back to a relation's view when there is none.
 */
function kindAuthorityRank(inputTypes: readonly string[]): number {
  if (inputTypes.length === 0) return 0;
  if (inputTypes.includes("root")) return 1;
  return 2;
}

/**
 * Every entity kind, indexed by the table it is stored in.
 *
 * A kind is declared across several plugins (a descriptor plus the
 * relations that produce it), so the index merges them: the plugin that
 * speaks for the kind (see `kindAuthorityRank`) names and gates it,
 * while the advertised field list is the union of what they all
 * declare, because validation accepts a name any of them names.
 *
 * Keyed on the registry version: a kind registered after the index was
 * built (a notifier imported late) must not be invisible to a sweep
 * that runs after it.
 */
let kindIndex: { version: number; byTable: Map<string, EntityKindInfo> } | null = null;

function entityKindsByTable(): Map<string, EntityKindInfo> {
  const version = tokenRegistryVersion();
  if (kindIndex && kindIndex.version === version) return kindIndex.byTable;

  const byKind = new Map<TokenEntityType, EntityKindInfo>();
  /** Kinds seen on a table another kind already claims — ambiguous, dropped. */
  const contested = new Set<string>();
  const claimedBy = new Map<string, TokenEntityType>();

  // list() (not listEnabledSync): a disabled component's kind is still
  // declared, and the relation's own gate decides whether it resolves.
  for (const plugin of tokenPluginRegistry.list()) {
    const m = plugin.metadata;
    if (!m.entityTable) continue;
    if (m.outputType === "value" || m.outputType === "root") continue;
    const tableName = getTableConfig(m.entityTable).name;
    if (isOptionsTable(tableName)) continue;

    const claimant = claimedBy.get(tableName);
    if (claimant === undefined) claimedBy.set(tableName, m.outputType);
    else if (claimant !== m.outputType) contested.add(tableName);

    const existing = byKind.get(m.outputType);
    const rank = kindAuthorityRank(m.inputTypes);
    if (!existing) {
      byKind.set(m.outputType, {
        kind: m.outputType,
        table: m.entityTable,
        tableName,
        rank,
        label: m.name,
        requiredComponent: m.requiredComponent,
        entityFields: [...(m.entityFields ?? [])],
        entityFieldsOpen: m.entityFieldsOpen === true,
        load: m.previewEntity?.load,
      });
      continue;
    }
    if (rank < existing.rank) {
      existing.rank = rank;
      existing.label = m.name;
      existing.requiredComponent = m.requiredComponent;
      existing.table = m.entityTable;
      existing.tableName = tableName;
    }
    for (const f of m.entityFields ?? []) {
      if (!existing.entityFields.includes(f)) existing.entityFields.push(f);
    }
    if (m.entityFieldsOpen) existing.entityFieldsOpen = true;
    if (m.previewEntity?.load) existing.load = m.previewEntity.load;
  }

  const byTable = new Map<string, EntityKindInfo>();
  for (const info of byKind.values()) {
    if (contested.has(info.tableName)) continue;
    byTable.set(info.tableName, info);
  }
  if (contested.size > 0) {
    logger.warn(
      `Token tables claimed by more than one entity kind (${[...contested].join(", ")}); ` +
        `no entity relations generated into them — a segment named after its ` +
        `target kind cannot say which kind is meant.`,
      { service: "tokens" },
    );
  }

  kindIndex = { version, byTable };
  return byTable;
}

/**
 * The owner kind a plugin declares, if it can own a reference into
 * another entity kind: it must name a table, and that table must not be
 * reference data (see the "deliberately not generated" note above).
 */
function ownerOf(metadata: TokenPluginMetadata): RelationOwner | null {
  const { outputType, entityTable, requiredComponent } = metadata;
  if (!entityTable || outputType === "value" || outputType === "root") return null;
  const tableName = getTableConfig(entityTable).name;
  if (isOptionsTable(tableName)) return null;
  // The gate is the KIND's, not this plugin's: the sweep walks an owner
  // once, and which of the kind's plugins happened to trigger that walk
  // must not decide what the generated relations are gated on.
  const info = entityKindsByTable().get(tableName);
  return {
    kind: outputType,
    table: entityTable,
    requiredComponent:
      info?.kind === outputType ? info.requiredComponent : requiredComponent,
  };
}

/**
 * Is this relation already declared by hand?
 *
 * Two ways it can be, and both must win over the sweep: the segment
 * NAME is already handled for this owner, or the target kind is already
 * reachable from this owner under a name someone chose deliberately
 * (`{{worker.home_employer}}` says WHICH employer; `{{worker.employer}}`
 * would be a second, vaguer name for the same walk).
 */
function relationDeclared(
  targetKind: TokenEntityType,
  ownerKind: TokenEntityType,
): boolean {
  return tokenPluginRegistry.list().some((p) => {
    const m = p.metadata;
    if (!m.inputTypes.includes(ownerKind) && !m.inputTypes.includes("*")) {
      return false;
    }
    return m.segmentName === targetKind || m.outputType === targetKind;
  });
}

/**
 * Load the record a foreign key points at.
 *
 * A kind that declares how to load one of its records by id is loaded
 * THAT way, so a relation and a preview of the same kind produce the
 * same row — including the derived fields the kind's catalog advertises
 * but its table does not have (a worker's employment denorm). A kind
 * whose catalog is exactly its table has nothing to derive, so a plain
 * row read is the whole truth for it.
 */
async function loadTargetEntity(
  info: EntityKindInfo,
  foreignColumn: string,
  value: string,
  ctx: TokenEvalContext,
): Promise<TokenEntity | null> {
  const load = info.load;
  if (load && foreignColumn === "id") {
    const loaded = await memo(ctx, `entity-load:${info.kind}:${value}`, async () => {
      return (await load(ctx.storage, value)) ?? null;
    });
    return loaded?.entity ?? null;
  }
  const row = await memo(
    ctx,
    `entity-row:${info.tableName}:${foreignColumn}:${value}`,
    async () => {
      return await ctx.storage.bulkTokens.getRowByReference(
        info.tableName,
        foreignColumn,
        value,
      );
    },
  );
  if (!row) return null;
  return { kind: info.kind, row, table: info.table };
}

/** Register one owner-kind → entity-kind relation segment. */
function registerEntityRelation(
  owner: RelationOwner,
  info: EntityKindInfo,
  column: string,
  foreignColumn: string,
): string | null {
  if (owner.kind === info.kind) return null;
  const id = `token.entity_relation.${owner.kind}.${info.kind}`;
  if (tokenPluginRegistry.has(id)) return null;
  // A hand-written relation knows something this sweep does not;
  // shadowing or doubling it would change what stored templates render.
  if (relationDeclared(info.kind, owner.kind)) return null;

  // Without the kind's own loader the relation can only produce a bare
  // table row, which would advertise derived fields that render blank.
  const viaLoader = Boolean(info.load) && foreignColumn === "id";
  const advertisesDerived = info.entityFields.length > 0 || info.entityFieldsOpen;
  if (!viaLoader && advertisesDerived) {
    logger.debug(
      `No entity relation generated for "${owner.kind}.${info.kind}" (${column}): ` +
        `the kind advertises derived fields but declares no way to load one of ` +
        `its records by id.`,
      { service: "tokens" },
    );
    return null;
  }

  const label = info.label.toLowerCase();
  registerTokenPlugin({
    metadata: {
      id,
      name: info.label,
      description: `The ${label} this record references (${column})`,
      segmentName: info.kind,
      inputTypes: [owner.kind],
      outputType: info.kind,
      entityTable: info.table,
      generated: true,
      ...(viaLoader && info.entityFields.length > 0
        ? { entityFields: [...info.entityFields] }
        : {}),
      ...(viaLoader && info.entityFieldsOpen ? { entityFieldsOpen: true } : {}),
      // Kept out of the flat bulk-messaging catalog (one entry per
      // relation per entity would bury it); a surface that seeds real
      // records walks the full registry, and the token browser walks
      // hidden relations, so an author still finds it.
      hiddenFromCatalog: true,
      // The target kind's own component decides whether its data exists
      // at all; where it has none, the owner's gate is the honest one.
      requiredComponent: info.requiredComponent ?? owner.requiredComponent,
    },
    async resolve(entity, _args, ctx) {
      const e = tokenEntityOf(entity, owner.kind);
      if (!e) return null;
      const key = resolveRowKey(e, column);
      if (!key) return null;
      const value = e.row[key];
      // A null or empty reference is a record that simply does not point
      // anywhere: the chain resolves to nothing and renders its default.
      if (typeof value !== "string" || value === "") return null;
      return await loadTargetEntity(info, foreignColumn, value, ctx);
    },
  });
  return id;
}

const sweep = createRelationSweep<EntityKindInfo>({
  label: "entity",
  ownerOf,
  targetFor(tableName) {
    const info = entityKindsByTable().get(tableName);
    if (!info) return null;
    return { kind: info.kind, table: info.table, meta: info };
  },
  register(owner, target, column, foreignColumn) {
    return registerEntityRelation(owner, target.meta, column, foreignColumn);
  },
  // Unlike reference data, these targets ARE plugins: a kind registered
  // by a late-imported module is a table the already-walked owners were
  // walked without.
  targetsSignature() {
    return [...entityKindsByTable().keys()].sort().join(",");
  },
});

/**
 * Generate the entity side of the token graph, and keep generating it.
 * Returns the ids generated by the initial sweep, for the boot log.
 */
export function registerEntityRelationTokens(): string[] {
  return sweep();
}
