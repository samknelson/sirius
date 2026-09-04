import { getClient } from './transaction-context';
import {
  entityNotes,
  users,
  optionsNoteType,
  sitespecificBaoNotesTags,
  type EntityNote,
  type InsertEntityNote,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";
import { noteContextTables, isNoteContextAvailable } from "./entity-notes-context-tables";
import { runInTransaction } from "./transaction-context";

/** A note plus the display fields the notes tab renders alongside it. */
export interface EntityNoteWithDetails extends EntityNote {
  typeName: string | null;
  authorName: string | null;
}

export interface EntityNotesStorage {
  /** Notes on one record, newest first. */
  listByEntity(contextId: string, entityId: string): Promise<EntityNoteWithDetails[]>;
  get(id: string): Promise<EntityNote | undefined>;
  create(note: InsertEntityNote): Promise<EntityNote>;
  update(id: string, note: Partial<InsertEntityNote>): Promise<EntityNote | undefined>;
  delete(id: string): Promise<boolean>;
  /** How many notes reference a note type (delete guard). */
  countByTypeId(typeId: string): Promise<number>;
  /**
   * Ids of notes in one context whose parent record no longer exists.
   * Drives the orphan sweep; one anti-join per registered context. Returns an
   * empty list for a context whose table is not currently present (component
   * off) — notes are kept, not swept, while their record type is unavailable.
   *
   * A per-record existence check does NOT live here: the routes ask the
   * context's own `entityExists` (see server/services/entity-notes/registry.ts),
   * the same way the files framework does. The table map below exists for this
   * bulk anti-join, which cannot be expressed record by record.
   */
  findOrphanIds(contextId: string, limit: number): Promise<string[]>;
  /** Migration-only atomic note + complete BAO tag-set reconciliation. */
  reconcileForMigration(input: {
    noteId?: string;
    note: InsertEntityNote & { timestamp: Date };
    tagIds: string[];
    loader: string;
  }): Promise<{ note: EntityNote; created: boolean } | null>;
  /** Delete only when the note provenance belongs to the named loader. */
  deleteForMigration(id: string, loader: string): Promise<"deleted" | "missing">;
  /**
   * Migration-only BULK note + BAO tag-set reconciliation (one bounded
   * transaction per call — callers chunk). Preserves `reconcileForMigration`
   * semantics set-based: loader-ownership check on updates, adoption by
   * `data->'s1'->>'nid'` provenance on creates (duplicate provenance is a
   * per-row failure, never a write), full-field overwrite, and exact tag-set
   * replacement. Per-row failures are returned (caller rejects/retries them);
   * an exception aborts the whole chunk, leaving every row retryable.
   */
  bulkReconcileForMigration(input: {
    loader: string;
    rows: Array<{ ref: number; noteId?: string; note: InsertEntityNote & { timestamp: Date }; tagIds: string[] }>;
  }): Promise<{
    saved: Map<number, { noteId: string; created: boolean }>;
    failed: Map<number, "missing" | "owner_mismatch" | "duplicate_provenance">;
  }>;
  /**
   * Migration-only bulk delete (batched orphan cleanup / deletion sweep).
   * Fail-closed like `deleteForMigration`: any candidate whose provenance is
   * NOT owned by the named loader throws before anything is deleted.
   */
  bulkDeleteForMigration(ids: string[], loader: string): Promise<{ deleted: number; missing: number }>;
}

/**
 * Author display name from the joined user row: "First Last", falling back to
 * whichever half exists, then the email.
 */
function authorNameFrom(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string | null {
  const full = [firstName, lastName].filter((p) => p && p.trim() !== "").join(" ");
  if (full) return full;
  return email ?? null;
}

/**
 * BOTH of a note's text fields are free-form staff commentary — the subject is
 * typed by hand just like the body, and on a call log it routinely names the
 * caller or the matter. Neither may be copied into `winston_logs`, so every
 * logging hook here (args, before-state, after-state) runs the row through
 * this, and the log descriptions below identify a note by its record and id
 * only. The trade-off is deliberate: an edit to either text field shows up in
 * the log as "a note changed", never as what it said.
 */
const REDACTED_NOTE_FIELDS = ["subject", "body"] as const;

function redactNote<T extends Record<string, any> | null | undefined>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const copy: Record<string, any> = { ...row };
  for (const field of REDACTED_NOTE_FIELDS) {
    if (!(field in copy)) continue;
    if (copy[field] === null || copy[field] === undefined) continue;
    copy[field] = "[redacted]";
  }
  return copy as T;
}

/**
 * Logging for entityNotes.
 *
 * Two things distinguish this config from the usual CRUD one:
 *   - The host entity is the note's PARENT record (the worker / employer /
 *     provider), resolved on create, update AND delete, so note activity shows
 *     up in that record's own log view. Update and delete read it off the
 *     before-state, since the request only carries the note id.
 *   - The note body is redacted everywhere it would otherwise be persisted:
 *     logged args, before-state and after-state.
 */
export const entityNotesLoggingConfig = defineLoggingConfig<EntityNotesStorage>({
  module: 'entityNotes',
  state: { key: 'note' },
  hostEntityId: (args, result, beforeState) =>
    result?.entityId ?? beforeState?.note?.entityId ?? args[0]?.entityId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new note',
      logArgs: (args) => [redactNote(args[0])],
      after: async (args, result) => ({ note: redactNote(result) }),
      getDescription: (args, result) =>
        `Created note on ${result?.contextId ?? args[0]?.contextId} ${result?.entityId ?? args[0]?.entityId}`,
    },
    update: {
      logArgs: (args) => [args[0], redactNote(args[1])],
      before: async (args, storage) => ({ note: redactNote(await storage.get(args[0])) }),
      after: async (args, result) => ({ note: redactNote(result) }),
      getDescription: (args, result, beforeState) =>
        `Updated note ${args[0]} on ${result?.contextId ?? beforeState?.note?.contextId} ${result?.entityId ?? beforeState?.note?.entityId}`,
    },
    delete: {
      before: async (args, storage) => ({ note: redactNote(await storage.get(args[0])) }),
      getDescription: (args, result, beforeState) =>
        `Deleted note ${args[0]} on ${beforeState?.note?.contextId} ${beforeState?.note?.entityId}`,
    },
  },
});

export function createEntityNotesStorage(): EntityNotesStorage {
  return {
    async listByEntity(contextId: string, entityId: string): Promise<EntityNoteWithDetails[]> {
      const client = getClient();
      const rows = await client
        .select({
          note: entityNotes,
          typeName: optionsNoteType.name,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(entityNotes)
        .leftJoin(optionsNoteType, eq(optionsNoteType.id, entityNotes.typeId))
        .leftJoin(users, eq(users.id, entityNotes.userId))
        .where(and(eq(entityNotes.contextId, contextId), eq(entityNotes.entityId, entityId)))
        .orderBy(desc(entityNotes.timestamp));

      return rows.map((row) => ({
        ...row.note,
        typeName: row.typeName ?? null,
        authorName: authorNameFrom(row.firstName, row.lastName, row.email),
      }));
    },

    async get(id: string): Promise<EntityNote | undefined> {
      const client = getClient();
      const [note] = await client.select().from(entityNotes).where(eq(entityNotes.id, id));
      return note;
    },

    async create(note: InsertEntityNote): Promise<EntityNote> {
      const client = getClient();
      const [created] = await client.insert(entityNotes).values(note as any).returning();
      return created;
    },

    async update(id: string, note: Partial<InsertEntityNote>): Promise<EntityNote | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(entityNotes)
        .set(note as any)
        .where(eq(entityNotes.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(entityNotes).where(eq(entityNotes.id, id)).returning();
      return result.length > 0;
    },

    async countByTypeId(typeId: string): Promise<number> {
      const client = getClient();
      const [row] = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(entityNotes)
        .where(eq(entityNotes.typeId, typeId));
      return Number(row?.count ?? 0);
    },

    async findOrphanIds(contextId: string, limit: number): Promise<string[]> {
      const table = noteContextTables[contextId];
      // Never anti-join against a table that may not exist: a disabled
      // component's notes are left alone rather than treated as orphans.
      if (!table || !isNoteContextAvailable(contextId)) return [];
      const client = getClient();
      const idColumn = (table as any).id;
      const rows = await client
        .select({ id: entityNotes.id })
        .from(entityNotes)
        .leftJoin(table, eq(idColumn, entityNotes.entityId))
        .where(and(eq(entityNotes.contextId, contextId), isNull(idColumn)))
        .limit(limit);
      return rows.map((r) => r.id);
    },


    async reconcileForMigration(input): Promise<{ note: EntityNote; created: boolean } | null> {
      return runInTransaction(async () => {
        const client = getClient();
        let current: EntityNote | undefined;
        if (input.noteId) {
          [current] = await client.select().from(entityNotes).where(eq(entityNotes.id, input.noteId));
          if (!current) return null;
          const owner = (current.data as Record<string, unknown> | null)?.s1Loader;
          if (owner !== input.loader) throw new Error("migration note provenance owner mismatch");
        } else {
          const sourceNid = (input.note.data as Record<string, any> | null)?.s1?.nid;
          if (sourceNid != null) {
            const adopted = await client
              .select()
              .from(entityNotes)
              .where(and(
                eq(entityNotes.contextId, "worker"),
                sql`data->>'s1Loader' = ${input.loader}`,
                sql`data->'s1'->>'nid' = ${String(sourceNid)}`,
              ))
              .limit(2);
            if (adopted.length > 1) throw new Error("duplicate migration note provenance");
            current = adopted[0];
          }
        }
        const [saved] = current
          ? await client.update(entityNotes).set(input.note as any).where(eq(entityNotes.id, current.id)).returning()
          : await client.insert(entityNotes).values(input.note as any).returning();
        const uniqueTagIds = [...new Set(input.tagIds)];
        if (uniqueTagIds.length === 0) {
          await client.delete(sitespecificBaoNotesTags).where(eq(sitespecificBaoNotesTags.noteId, saved.id));
        } else {
          await client
            .delete(sitespecificBaoNotesTags)
            .where(and(eq(sitespecificBaoNotesTags.noteId, saved.id), notInArray(sitespecificBaoNotesTags.tagId, uniqueTagIds)));
          await client
            .insert(sitespecificBaoNotesTags)
            .values(uniqueTagIds.map((tagId) => ({ noteId: saved.id, tagId })))
            .onConflictDoNothing();
        }
        return { note: saved, created: !current };
      });
    },

    async bulkReconcileForMigration(input) {
      return runInTransaction(async () => {
        const client = getClient();
        const saved = new Map<number, { noteId: string; created: boolean }>();
        const failed = new Map<number, "missing" | "owner_mismatch" | "duplicate_provenance">();
        type Row = (typeof input.rows)[number];
        const updates: Array<{ row: Row; noteId: string }> = [];
        const inserts: Row[] = [];

        // Updates: verify existence + loader ownership set-based.
        const updateRows = input.rows.filter((r) => r.noteId);
        const owners = new Map<string, string | null>();
        if (updateRows.length > 0) {
          const existing = await client
            .select({ id: entityNotes.id, owner: sql<string | null>`data->>'s1Loader'` })
            .from(entityNotes)
            .where(inArray(entityNotes.id, updateRows.map((r) => r.noteId!)));
          for (const row of existing) owners.set(row.id, row.owner);
        }
        for (const row of updateRows) {
          const owner = owners.get(row.noteId!);
          if (owner === undefined) failed.set(row.ref, "missing");
          else if (owner !== input.loader) failed.set(row.ref, "owner_mismatch");
          else updates.push({ row, noteId: row.noteId! });
        }

        // Creates: adopt by s1 nid provenance (duplicate provenance fails the row).
        const createRows = input.rows.filter((r) => !r.noteId);
        if (createRows.length > 0) {
          const nids = createRows
            .map((r) => (r.note.data as Record<string, any> | null)?.s1?.nid)
            .filter((n) => n != null)
            .map((n) => String(n));
          const adoptable = new Map<string, string[]>();
          if (nids.length > 0) {
            const candidates = await client
              .select({ id: entityNotes.id, nid: sql<string | null>`data->'s1'->>'nid'` })
              .from(entityNotes)
              .where(and(
                eq(entityNotes.contextId, "worker"),
                sql`data->>'s1Loader' = ${input.loader}`,
                sql`data->'s1'->>'nid' IN (${sql.join(nids.map((n) => sql`${n}`), sql`, `)})`,
              ));
            for (const c of candidates) {
              if (c.nid == null) continue;
              (adoptable.get(c.nid) ?? (adoptable.set(c.nid, []), adoptable.get(c.nid)!)).push(c.id);
            }
          }
          for (const row of createRows) {
            const sourceNid = (row.note.data as Record<string, any> | null)?.s1?.nid;
            const matches = sourceNid == null ? [] : adoptable.get(String(sourceNid)) ?? [];
            if (matches.length > 1) failed.set(row.ref, "duplicate_provenance");
            else if (matches.length === 1) updates.push({ row, noteId: matches[0] });
            else inserts.push(row);
          }
        }

        // Bulk UPDATE via a VALUES join (full-field overwrite, reconcile parity).
        if (updates.length > 0) {
          const values = updates.map(({ row, noteId }) => sql`(
            ${noteId}, ${row.note.contextId}, ${row.note.entityId}, ${row.note.typeId},
            ${row.note.subject}, ${row.note.body ?? null},
            ${JSON.stringify(row.note.data ?? null)}::jsonb,
            ${row.note.timestamp.toISOString()}::timestamptz, ${row.note.userId ?? null}
          )`);
          await client.execute(sql`
            UPDATE entity_notes n SET
              context_id = v.context_id, entity_id = v.entity_id, type_id = v.type_id,
              subject = v.subject, body = v.body, data = v.data,
              timestamp = v.ts, user_id = v.user_id
            FROM (VALUES ${sql.join(values, sql`, `)})
              AS v(id, context_id, entity_id, type_id, subject, body, data, ts, user_id)
            WHERE n.id = v.id
          `);
          for (const { row, noteId } of updates) saved.set(row.ref, { noteId, created: false });
        }

        // Bulk INSERT with client-generated ids (deterministic ref → id mapping).
        if (inserts.length > 0) {
          const withIds = inserts.map((row) => ({ row, id: crypto.randomUUID() }));
          await client.insert(entityNotes).values(withIds.map(({ row, id }) => ({ ...(row.note as any), id })));
          for (const { row, id } of withIds) saved.set(row.ref, { noteId: id, created: true });
        }

        // Exact tag-set replacement for every saved note, set-based.
        const tagTargets = input.rows
          .filter((r) => saved.has(r.ref))
          .map((r) => ({ noteId: saved.get(r.ref)!.noteId, tagIds: [...new Set(r.tagIds)] }));
        if (tagTargets.length > 0) {
          // Empty desired sets MUST be a true empty typed array: with
          // ARRAY[NULL], `NOT (tag_id = ANY(...))` evaluates to NULL (not
          // true) and the delete would silently keep stale tags.
          const desired = tagTargets.map((t) => t.tagIds.length > 0
            ? sql`(${t.noteId}, ARRAY[${sql.join(t.tagIds.map((id) => sql`${id}`), sql`, `)}]::varchar[])`
            : sql`(${t.noteId}, ARRAY[]::varchar[])`);
          await client.execute(sql`
            DELETE FROM sitespecific_bao_notes_tags t
             USING (VALUES ${sql.join(desired, sql`, `)}) AS v(note_id, tag_ids)
             WHERE t.note_id = v.note_id
               AND NOT (t.tag_id = ANY(v.tag_ids))
          `);
          const pairs = tagTargets.flatMap((t) => t.tagIds.map((tagId) => ({ noteId: t.noteId, tagId })));
          if (pairs.length > 0) {
            await client.insert(sitespecificBaoNotesTags).values(pairs).onConflictDoNothing();
          }
        }
        return { saved, failed };
      });
    },

    async bulkDeleteForMigration(ids: string[], loader: string): Promise<{ deleted: number; missing: number }> {
      if (ids.length === 0) return { deleted: 0, missing: 0 };
      const client = getClient();
      const existing = await client
        .select({ id: entityNotes.id, owner: sql<string | null>`data->>'s1Loader'` })
        .from(entityNotes)
        .where(inArray(entityNotes.id, ids));
      const mismatched = existing.filter((row) => row.owner !== loader);
      if (mismatched.length > 0) {
        throw new Error(`migration note ownership verification failed for ${mismatched.length} row(s)`);
      }
      const missing = new Set(ids).size - existing.length;
      const owned = existing.map((row) => row.id);
      if (owned.length === 0) return { deleted: 0, missing };
      const deleted = await client.delete(entityNotes).where(inArray(entityNotes.id, owned)).returning({ id: entityNotes.id });
      return { deleted: deleted.length, missing };
    },

    async deleteForMigration(id: string, loader: string): Promise<"deleted" | "missing"> {
      const client = getClient();
      const [row] = await client.select({ id: entityNotes.id, data: entityNotes.data }).from(entityNotes).where(eq(entityNotes.id, id));
      if (!row) return "missing";
      if ((row.data as Record<string, unknown> | null)?.s1Loader !== loader) {
        throw new Error("migration note ownership verification failed");
      }
      const deleted = await client.delete(entityNotes).where(eq(entityNotes.id, id)).returning({ id: entityNotes.id });
      return deleted.length > 0 ? "deleted" : "missing";
    },
  };
}
