import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { logger } from "../../logger";
import { onTokenPluginRegistered, tokenPluginRegistry } from "./registry";
import type { TokenEntityType, TokenPluginMetadata } from "./types";

/**
 * GENERATING RELATION SEGMENTS FROM FOREIGN KEYS.
 *
 * Two parts of the token graph are derived rather than written: the
 * relations into reference data (`./plugins/options`) and the relations
 * between entity kinds (`./plugins/entity-relations`). Both answer the
 * same question of every entity kind — "which single-column foreign
 * keys does this table have, and does the table they point at belong to
 * a kind I own?" — and both have to answer it under the same three
 * awkward facts:
 *
 *   - registration is not a boot-only event (a notifier module imported
 *     after the first render registers entity kinds too), so a sweep
 *     cannot run once and be assumed complete;
 *   - a sweep registers plugins itself, which re-enters the listener it
 *     just subscribed with;
 *   - a segment named after its target cannot say WHICH column is meant
 *     when a table references the same target twice, so that pair has to
 *     be skipped out loud rather than resolved by a coin flip.
 *
 * This module owns that walk. A caller supplies only what is specific to
 * its half of the graph: which kinds it treats as owners, which tables
 * it recognizes as targets, and how one relation is registered.
 */

/** An entity kind that can own a reference into a target table. */
export interface RelationOwner {
  kind: TokenEntityType;
  table: AnyPgTable;
  requiredComponent?: string;
}

/** A table a generated relation can point AT, plus the sweep's own data. */
export interface RelationTarget<TMeta> {
  /** Token entity kind produced by the generated segment. */
  kind: TokenEntityType;
  table: AnyPgTable;
  meta: TMeta;
}

export interface RelationSweepSpec<TMeta> {
  /** Names this sweep in log messages ("options", "entity"). */
  label: string;
  /**
   * The owner kind a plugin declares, or null when the plugin cannot
   * own a relation of this sweep's kind.
   */
  ownerOf(metadata: TokenPluginMetadata): RelationOwner | null;
  /**
   * The target this sweep recognizes for a referenced table, or null
   * when the table is not its business.
   */
  targetFor(tableName: string, table: AnyPgTable): RelationTarget<TMeta> | null;
  /**
   * Register one owner → target relation. Returns the registered plugin
   * id, or null when the sweep should leave this relation alone (one is
   * already registered, or a hand-written segment owns the name).
   *
   * `column` is the owner's referencing column; `foreignColumn` is the
   * column it points at on the target table.
   */
  register(
    owner: RelationOwner,
    target: RelationTarget<TMeta>,
    column: string,
    foreignColumn: string,
  ): string | null;
  /**
   * What the sweep's set of TARGETS currently is, as a value that
   * changes when the set does. Optional: a sweep whose targets are
   * static (reference data, known from schema metadata) has nothing to
   * report.
   *
   * A sweep whose targets are themselves registered plugins does: an
   * owner walked before its target existed found nothing to point at,
   * and would never be reconsidered on the strength of having been
   * walked once.
   */
  targetsSignature?(): string;
}

/**
 * Build the sweep. Calling the returned function runs the initial pass
 * over everything registered so far and — once — subscribes to later
 * registrations so a late entity kind gets its relations too.
 *
 * Idempotent in both directions: an owner kind is walked once, and the
 * caller's `register` decides what to do about a relation that already
 * exists.
 */
export function createRelationSweep<TMeta>(
  spec: RelationSweepSpec<TMeta>,
): () => string[] {
  /** Owner kinds already walked, so a rescan is free and repeat-safe. */
  const walkedOwners = new Set<TokenEntityType>();
  /** Guards the re-entrant registrations the sweep makes itself. */
  let generating = false;
  let listening = false;
  /** The target set the walked owners were walked against. */
  let targetsSignature = "";

  /** Every relation reachable from one owner kind. */
  function generateForOwner(owner: RelationOwner): string[] {
    if (walkedOwners.has(owner.kind)) return [];
    walkedOwners.add(owner.kind);
    const generated: string[] = [];

    // Group this table's references by TARGET: the segment is named
    // after the target, so two columns pointing at the same one cannot
    // both have it.
    const byTarget = new Map<
      string,
      { target: RelationTarget<TMeta>; columns: string[]; foreignColumn: string }
    >();
    for (const fk of getTableConfig(owner.table).foreignKeys) {
      const ref = fk.reference();
      if (ref.columns.length !== 1 || ref.foreignColumns.length !== 1) continue;
      const targetTable = ref.foreignColumns[0].table as AnyPgTable;
      const target = spec.targetFor(getTableConfig(targetTable).name, targetTable);
      if (!target) continue;
      const entry = byTarget.get(target.kind) ?? {
        target,
        columns: [],
        foreignColumn: ref.foreignColumns[0].name,
      };
      entry.columns.push(ref.columns[0].name);
      byTarget.set(target.kind, entry);
    }

    generating = true;
    try {
      for (const { target, columns, foreignColumn } of byTarget.values()) {
        if (columns.length > 1) {
          // Naming the segment after the target cannot say WHICH column
          // is meant. Registering either one would be a coin flip an
          // author could not see, so the pair is skipped and said out
          // loud.
          logger.warn(
            `Token entity "${owner.kind}" references ${target.kind} through ` +
              `${columns.length} columns (${columns.join(", ")}); no ${spec.label} ` +
              `segment generated — a segment named after its target cannot say ` +
              `which column is meant.`,
            { service: "tokens" },
          );
          continue;
        }
        const id = spec.register(owner, target, columns[0], foreignColumn);
        if (id) generated.push(id);
      }
    } finally {
      generating = false;
    }
    return generated;
  }

  /** Walk every owner currently registered. */
  function sweepAllOwners(): string[] {
    const generated: string[] = [];
    for (const plugin of tokenPluginRegistry.list()) {
      const owner = spec.ownerOf(plugin.metadata);
      if (owner) generated.push(...generateForOwner(owner));
    }
    return generated;
  }

  return function sweep(): string[] {
    const generated = sweepAllOwners();
    targetsSignature = spec.targetsSignature?.() ?? "";

    if (!listening) {
      listening = true;
      onTokenPluginRegistered((plugin) => {
        // The sweep's own registrations are relations into kinds it has
        // already walked; the flag makes that explicit rather than
        // incidental.
        if (generating) return;

        // A new TARGET reopens owners already walked: they were walked
        // against a graph that did not have it yet.
        const signature = spec.targetsSignature?.() ?? "";
        if (signature !== targetsSignature) {
          targetsSignature = signature;
          walkedOwners.clear();
          const late = sweepAllOwners();
          if (late.length) {
            logger.info(
              `Token ${spec.label} relations generated after a late target kind arrived`,
              { service: "tokens", plugins: late },
            );
          }
          return;
        }

        const owner = spec.ownerOf(plugin.metadata);
        if (!owner) return;
        const late = generateForOwner(owner);
        if (late.length) {
          logger.info(
            `Token ${spec.label} relations generated for late entity kind "${owner.kind}"`,
            { service: "tokens", plugins: late },
          );
        }
      });
    }

    return generated;
  };
}
