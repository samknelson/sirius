import { getClient } from './transaction-context';
import {
  entityNotes,
  users,
  optionsNoteType,
  type EntityNote,
  type InsertEntityNote,
} from "@shared/schema";
import { and, desc, eq, getTableName, isNull, sql } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";
import { noteContextTables, isNoteContextAvailable } from "./entity-notes-context-tables";

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
/**
 * The table a note's host record lives in. A note's parent is polymorphic —
 * its context names the record type — so the binding comes from the context
 * registry, reached lazily because that registry sits above storage.
 */
async function noteHostTable(contextId: unknown): Promise<string | undefined> {
  if (typeof contextId !== "string") return undefined;
  const { noteContextTables } = await import("./entity-notes-context-tables");
  const table = noteContextTables[contextId];
  return table ? getTableName(table) : undefined;
}

export const entityNotesLoggingConfig = defineLoggingConfig<EntityNotesStorage>({
  module: 'entityNotes',
  table: 'entity_notes',
  hostTable: (args, result, beforeState) =>
    noteHostTable(result?.contextId ?? beforeState?.note?.contextId ?? args[0]?.contextId),
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
  };
}
