import { getClient } from './transaction-context';
import {
  notes,
  users,
  optionsNoteType,
  sitespecificBaoNotesTags,
  optionsSitespecificBaoNotesTags,
  type Note,
  type InsertNote,
} from "@shared/schema";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";
import { noteEntityTables, isNoteEntityTypeAvailable } from "./notes-entity-types";
import { runInTransaction } from "./transaction-context";

/** A note plus the display fields the notes tab renders alongside it. */
export interface NoteWithDetails extends Note {
  typeName: string | null;
  authorName: string | null;
}

export interface NotesStorage {
  /** Notes on one record, newest first. */
  listByEntity(entityType: string, entityId: string): Promise<NoteWithDetails[]>;
  get(id: string): Promise<Note | undefined>;
  create(note: InsertNote): Promise<Note>;
  update(id: string, note: Partial<InsertNote>): Promise<Note | undefined>;
  delete(id: string): Promise<boolean>;
  /**
   * Does the parent record exist? `entityType` must be a registered note-able
   * type whose owning component is enabled (see `notes-entity-types.ts`);
   * anything else returns false so an unregistered — or currently table-less —
   * type can never be persisted.
   */
  entityExists(entityType: string, entityId: string): Promise<boolean>;
  /** How many notes reference a note type (delete guard). */
  countByTypeId(typeId: string): Promise<number>;
  /**
   * Ids of notes of one entity type whose parent record no longer exists.
   * Drives the orphan sweep; one anti-join per registered type. Returns an
   * empty list for a type whose table is not currently present (component off)
   * — notes are kept, not swept, while their record type is unavailable.
   */
  findOrphanIds(entityType: string, limit: number): Promise<string[]>;
  /** Hard-delete notes by id (orphan sweep). Returns the number removed. */
  deleteByIds(ids: string[]): Promise<number>;
  /** Migration-only atomic note + complete BAO tag-set reconciliation. */
  reconcileForMigration(input: {
    noteId?: string;
    note: InsertNote & { timestamp: Date };
    tagIds: string[];
    loader: string;
  }): Promise<{ note: Note; created: boolean } | null>;
  /** Delete only when the note provenance belongs to the named loader. */
  deleteForMigration(id: string, loader: string): Promise<"deleted" | "missing">;
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
 * Logging for notes.
 *
 * Two things distinguish this config from the usual CRUD one:
 *   - The host entity is the note's PARENT record (the worker / employer /
 *     provider), resolved on create, update AND delete, so note activity shows
 *     up in that record's own log view. Update and delete read it off the
 *     before-state, since the request only carries the note id.
 *   - The note body is redacted everywhere it would otherwise be persisted:
 *     logged args, before-state and after-state.
 */
export const notesLoggingConfig = defineLoggingConfig<NotesStorage>({
  module: 'notes',
  state: { key: 'note' },
  hostEntityId: (args, result, beforeState) =>
    result?.entityId ?? beforeState?.note?.entityId ?? args[0]?.entityId,
  methods: {
    create: {
      getEntityId: (args, result) => result?.id || 'new note',
      logArgs: (args) => [redactNote(args[0])],
      after: async (args, result) => ({ note: redactNote(result) }),
      getDescription: (args, result) =>
        `Created note on ${result?.entityType ?? args[0]?.entityType} ${result?.entityId ?? args[0]?.entityId}`,
    },
    update: {
      logArgs: (args) => [args[0], redactNote(args[1])],
      before: async (args, storage) => ({ note: redactNote(await storage.get(args[0])) }),
      after: async (args, result) => ({ note: redactNote(result) }),
      getDescription: (args, result, beforeState) =>
        `Updated note ${args[0]} on ${result?.entityType ?? beforeState?.note?.entityType} ${result?.entityId ?? beforeState?.note?.entityId}`,
    },
    delete: {
      before: async (args, storage) => ({ note: redactNote(await storage.get(args[0])) }),
      getDescription: (args, result, beforeState) =>
        `Deleted note ${args[0]} on ${beforeState?.note?.entityType} ${beforeState?.note?.entityId}`,
    },
  },
});

export function createNotesStorage(): NotesStorage {
  return {
    async listByEntity(entityType: string, entityId: string): Promise<NoteWithDetails[]> {
      const client = getClient();
      const rows = await client
        .select({
          note: notes,
          typeName: optionsNoteType.name,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(notes)
        .leftJoin(optionsNoteType, eq(optionsNoteType.id, notes.typeId))
        .leftJoin(users, eq(users.id, notes.userId))
        .where(and(eq(notes.entityType, entityType), eq(notes.entityId, entityId)))
        .orderBy(desc(notes.timestamp));

      return rows.map((row) => ({
        ...row.note,
        typeName: row.typeName ?? null,
        authorName: authorNameFrom(row.firstName, row.lastName, row.email),
      }));
    },

    async get(id: string): Promise<Note | undefined> {
      const client = getClient();
      const [note] = await client.select().from(notes).where(eq(notes.id, id));
      return note;
    },

    async create(note: InsertNote): Promise<Note> {
      const client = getClient();
      const [created] = await client.insert(notes).values(note as any).returning();
      return created;
    },

    async update(id: string, note: Partial<InsertNote>): Promise<Note | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(notes)
        .set(note as any)
        .where(eq(notes.id, id))
        .returning();
      return updated;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(notes).where(eq(notes.id, id)).returning();
      return result.length > 0;
    },

    async entityExists(entityType: string, entityId: string): Promise<boolean> {
      const table = noteEntityTables[entityType];
      // No table binding, or the component that owns the table is off (its
      // tables do not exist) — the record cannot be confirmed, so refuse.
      if (!table || !isNoteEntityTypeAvailable(entityType)) return false;
      const client = getClient();
      const idColumn = (table as any).id;
      const rows = await client.select({ id: idColumn }).from(table).where(eq(idColumn, entityId)).limit(1);
      return rows.length > 0;
    },

    async countByTypeId(typeId: string): Promise<number> {
      const client = getClient();
      const [row] = await client
        .select({ count: sql<number>`count(*)::int` })
        .from(notes)
        .where(eq(notes.typeId, typeId));
      return Number(row?.count ?? 0);
    },

    async findOrphanIds(entityType: string, limit: number): Promise<string[]> {
      const table = noteEntityTables[entityType];
      // Never anti-join against a table that may not exist: a disabled
      // component's notes are left alone rather than treated as orphans.
      if (!table || !isNoteEntityTypeAvailable(entityType)) return [];
      const client = getClient();
      const idColumn = (table as any).id;
      const rows = await client
        .select({ id: notes.id })
        .from(notes)
        .leftJoin(table, eq(idColumn, notes.entityId))
        .where(and(eq(notes.entityType, entityType), isNull(idColumn)))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async deleteByIds(ids: string[]): Promise<number> {
      if (ids.length === 0) return 0;
      const client = getClient();
      const deleted = await client.delete(notes).where(inArray(notes.id, ids)).returning({ id: notes.id });
      return deleted.length;
    },

    async reconcileForMigration(input): Promise<{ note: Note; created: boolean } | null> {
      return runInTransaction(async () => {
        const client = getClient();
        let current: Note | undefined;
        if (input.noteId) {
          [current] = await client.select().from(notes).where(eq(notes.id, input.noteId));
          if (!current) return null;
          const owner = (current.data as Record<string, unknown> | null)?.s1Loader;
          if (owner !== input.loader) throw new Error("migration note provenance owner mismatch");
        } else {
          const sourceNid = (input.note.data as Record<string, any> | null)?.s1?.nid;
          if (sourceNid != null) {
            const adopted = await client
              .select()
              .from(notes)
              .where(and(
                eq(notes.entityType, "worker"),
                sql`data->>'s1Loader' = ${input.loader}`,
                sql`data->'s1'->>'nid' = ${String(sourceNid)}`,
              ))
              .limit(2);
            if (adopted.length > 1) throw new Error("duplicate migration note provenance");
            current = adopted[0];
          }
        }
        const [saved] = current
          ? await client.update(notes).set(input.note as any).where(eq(notes.id, current.id)).returning()
          : await client.insert(notes).values(input.note as any).returning();
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

    async deleteForMigration(id: string, loader: string): Promise<"deleted" | "missing"> {
      const client = getClient();
      const [row] = await client.select({ id: notes.id, data: notes.data }).from(notes).where(eq(notes.id, id));
      if (!row) return "missing";
      if ((row.data as Record<string, unknown> | null)?.s1Loader !== loader) {
        throw new Error("migration note ownership verification failed");
      }
      const deleted = await client.delete(notes).where(eq(notes.id, id)).returning({ id: notes.id });
      return deleted.length > 0 ? "deleted" : "missing";
    },
  };
}
