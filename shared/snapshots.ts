/**
 * Snapshot export bundle contract.
 *
 * Every exported entity is wrapped in a versioned node: `{ version, data }`.
 * Exports are recursive for OWNED children (a sheet bundle contains crew
 * bundles, a crew bundle contains assignment bundles) and each nested node
 * carries its own version, so a newer parent bundle may legally contain
 * older child bundles. Stored snapshots are never migrated — decode
 * dispatches on the per-node version at read time.
 *
 * REFERENCED entities (worker, show status, employer, ...) are not recursed
 * into; they are captured as `{ id, name }` ref stubs via {@link snapshotRef}
 * so a snapshot stays readable after the referenced record is renamed or
 * deleted.
 */
export interface SnapshotNode<T = unknown> {
  version: number;
  data: T;
}

/** A `{ id, name }` stub for a referenced (not owned) entity. */
export interface SnapshotRef {
  id: string;
  name: string;
}

/**
 * Build a ref stub for a referenced entity. Returns undefined when the
 * reference is absent so optional relations serialize compactly.
 */
export function snapshotRef(
  id: string | null | undefined,
  name: string | null | undefined,
): SnapshotRef | undefined {
  if (!id) return undefined;
  return { id, name: name ?? "" };
}

/** Snapshot row metadata as returned by the list API (no data payload). */
export interface SnapshotMeta {
  id: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  authorId: string | null;
  authorName: string | null;
  label: string | null;
}
