import { getClient } from '../../transaction-context';
import { and, asc, eq, inArray, notInArray, getTableName } from "drizzle-orm";
import { tableExists as tableExistsUtil } from "../../utils";
import {
  sitespecificBaoNotesTags,
  optionsSitespecificBaoNotesTags,
  optionsSitespecificBaoNotesTagTypes,
} from "@shared/schema";
import { defineLoggingConfig } from "../../middleware/logging";

/** A tag assigned to a note, enriched for display (grouped by tag type). */
export interface BaoNoteTagRow {
  /** Join-row note id. */
  noteId: string;
  /** Tag option id. */
  tagId: string;
  tagName: string;
  tagSequence: number;
  tagTypeId: string;
  tagTypeName: string | null;
  tagTypeSequence: number | null;
}

export interface BaoNoteTagsStorage {
  /** Tags on one note, ordered by tag type sequence then tag sequence/name. */
  listByNote(noteId: string): Promise<BaoNoteTagRow[]>;
  /** Tags on many notes at once (the notes-list enrichment). Same ordering. */
  listByNotes(noteIds: string[]): Promise<BaoNoteTagRow[]>;
  /**
   * Replace a note's tag set with exactly `tagIds`: removes assignments not
   * in the list, adds missing ones (idempotent on the note+tag unique).
   * Caller validates that every id is a real tag.
   */
  setForNote(noteId: string, tagIds: string[]): Promise<BaoNoteTagRow[]>;
  tableExists(): Promise<boolean>;
}

const join = sitespecificBaoNotesTags;
const tags = optionsSitespecificBaoNotesTags;
const tagTypes = optionsSitespecificBaoNotesTagTypes;

const selection = {
  noteId: join.noteId,
  tagId: tags.id,
  tagName: tags.name,
  tagSequence: tags.sequence,
  tagTypeId: tags.tagTypeId,
  tagTypeName: tagTypes.name,
  tagTypeSequence: tagTypes.sequence,
};

const ordering = [
  asc(tagTypes.sequence),
  asc(tagTypes.name),
  asc(tags.sequence),
  asc(tags.name),
];

export function createBaoNoteTagsStorage(): BaoNoteTagsStorage {
  return {
    async tableExists(): Promise<boolean> {
      return tableExistsUtil(getTableName(join));
    },

    async listByNote(noteId: string): Promise<BaoNoteTagRow[]> {
      const client = getClient();
      return client
        .select(selection)
        .from(join)
        .innerJoin(tags, eq(tags.id, join.tagId))
        .leftJoin(tagTypes, eq(tagTypes.id, tags.tagTypeId))
        .where(eq(join.noteId, noteId))
        .orderBy(...ordering);
    },

    async listByNotes(noteIds: string[]): Promise<BaoNoteTagRow[]> {
      if (noteIds.length === 0) return [];
      const client = getClient();
      return client
        .select(selection)
        .from(join)
        .innerJoin(tags, eq(tags.id, join.tagId))
        .leftJoin(tagTypes, eq(tagTypes.id, tags.tagTypeId))
        .where(inArray(join.noteId, noteIds))
        .orderBy(...ordering);
    },

    async setForNote(noteId: string, tagIds: string[]): Promise<BaoNoteTagRow[]> {
      const client = getClient();
      const unique = Array.from(new Set(tagIds));
      if (unique.length === 0) {
        await client.delete(join).where(eq(join.noteId, noteId));
      } else {
        await client
          .delete(join)
          .where(and(eq(join.noteId, noteId), notInArray(join.tagId, unique)));
        await client
          .insert(join)
          .values(unique.map((tagId) => ({ noteId, tagId })))
          .onConflictDoNothing();
      }
      return this.listByNote(noteId);
    },
  };
}

/**
 * Logging: tag-set changes show up on the note's parent record log the same
 * way note edits do — identified by note id only, never note content.
 */
export const baoNoteTagsLoggingConfig = defineLoggingConfig<BaoNoteTagsStorage>({
  module: 'bao.noteTags',
  methods: {
    setForNote: {
      getEntityId: (args) => args[0],
      logArgs: (args) => [args[0], args[1]],
      getDescription: (args) => `Set ${Array.isArray(args[1]) ? args[1].length : 0} tag(s) on note ${args[0]}`,
    },
  },
});
