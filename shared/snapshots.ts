/**
 * Snapshot export bundle contract.
 *
 * Every exported entity is wrapped in a versioned node: `{ version, data }`.
 * Exports are recursive for OWNED children (a sheet bundle contains crew
 * bundles, a crew bundle contains assignment bundles) and each nested node
 * carries its own version, so a newer parent bundle may legally contain
 * older child bundles. New root nodes may also carry the record-history
 * metadata that was current for the save. Stored snapshots are never migrated — decode
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
  /**
   * The target record's history at the save represented by this node.
   *
   * This is optional for backwards compatibility with bundles written before
   * snapshot metadata existed. New captures write either a value or `null`
   * when the target has no eligible/history row.
   */
  metadata?: SnapshotRecordMetadata | null;
}

/** A JSON-safe date/person pair from a record-history row. */
export interface SnapshotMetadataStamp {
  date: string | null;
  personName: string | null;
}

/**
 * JSON-safe record-history metadata captured alongside a snapshot's payload.
 * The dates are strings because stored JSON must not depend on Date revival.
 */
export interface SnapshotRecordMetadata {
  seq: number;
  rev: number;
  contextId: string;
  entityId: string;
  created: SnapshotMetadataStamp;
  modified: SnapshotMetadataStamp;
  subrecordModified: SnapshotMetadataStamp;
}

/** The stable sequence/revision identity displayed for a captured record. */
export interface SnapshotRevision {
  seq: number;
  rev: number;
}

/**
 * Validate and normalize the two JSON values used to identify a snapshot's
 * captured record revision. Older bundles and malformed metadata answer null.
 */
export function snapshotRevisionFromValues(
  seq: unknown,
  rev: unknown,
): SnapshotRevision | null {
  const parsedSeq = typeof seq === "number" ? seq : typeof seq === "string" ? Number(seq) : NaN;
  const parsedRev = typeof rev === "number" ? rev : typeof rev === "string" ? Number(rev) : NaN;
  if (
    !Number.isSafeInteger(parsedSeq) ||
    parsedSeq <= 0 ||
    !Number.isSafeInteger(parsedRev) ||
    parsedRev <= 0
  ) {
    return null;
  }
  return { seq: parsedSeq, rev: parsedRev };
}

/** Read the captured revision identity without exposing the snapshot payload. */
export function snapshotRevisionFromNode(node: unknown): SnapshotRevision | null {
  if (!node || typeof node !== "object") return null;
  const metadata = (node as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const values = metadata as { seq?: unknown; rev?: unknown };
  return snapshotRevisionFromValues(values.seq, values.rev);
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

/**
 * Snapshot row metadata as returned by the list API (no data payload).
 *
 * The revision comes from the snapshot bundle captured with the target record.
 * When the snapshot was captured, and by whom, comes from the snapshot row
 * and the current account record:
 *
 *  - `capturedAt` is null for a snapshot the framework holds no history for.
 *    That is not an error — history is written best effort, just after the
 *    save that captured the snapshot commits.
 *  - `capturedByName` is resolved from the person's account at READ time, so a
 *    renamed user's snapshots show the current name. It is null for a capture
 *    with no signed-in user behind it (a system path), which is a real and
 *    expected state, and for a snapshot whose history names nobody.
 */
export interface SnapshotMeta {
  id: string;
  entityType: string;
  entityId: string;
  revision: SnapshotRevision | null;
  capturedAt: string | null;
  capturedByName: string | null;
  label: string | null;
}
