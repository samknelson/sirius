import { getClient } from './transaction-context';
import { commTags, optionsCommTags, type CommTagLink, type OptionsCommTag } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { runInTransaction } from './transaction-context';
import type { StorageLoggingConfig } from './middleware/logging';
import { storageLogger } from '../logger';

type CommTagsStorageRef = CommTagsStorage;

export interface CommTagsStorage {
  listForComm(commId: string): Promise<OptionsCommTag[]>;
  listForComms(commIds: string[]): Promise<Map<string, OptionsCommTag[]>>;
  addTag(commId: string, tagId: string): Promise<CommTagLink>;
  removeTag(commId: string, tagId: string): Promise<boolean>;
  setTags(commId: string, tagIds: string[]): Promise<OptionsCommTag[]>;
  findMissingTagIds(tagIds: string[]): Promise<string[]>;
}

export const commTagsLoggingConfig: StorageLoggingConfig<CommTagsStorageRef> = {
  module: 'comm-tags',
  methods: {
    addTag: { enabled: true, getHostEntityId: (args) => args[0], getEntityId: (args) => args[1] },
    removeTag: { enabled: true, getHostEntityId: (args) => args[0], getEntityId: (args) => args[1] },
    setTags: { enabled: true, getHostEntityId: (args) => args[0] },
  },
};

export function createCommTagsStorage(): CommTagsStorage {
  return {
    async listForComm(commId: string): Promise<OptionsCommTag[]> {
      const client = getClient();
      const rows = await client
        .select({ tag: optionsCommTags })
        .from(commTags)
        .innerJoin(optionsCommTags, eq(commTags.commTagId, optionsCommTags.id))
        .where(eq(commTags.commId, commId));
      return rows.map((r) => r.tag);
    },

    async listForComms(commIds: string[]): Promise<Map<string, OptionsCommTag[]>> {
      const result = new Map<string, OptionsCommTag[]>();
      if (commIds.length === 0) return result;
      const client = getClient();
      const rows = await client
        .select({ commId: commTags.commId, tag: optionsCommTags })
        .from(commTags)
        .innerJoin(optionsCommTags, eq(commTags.commTagId, optionsCommTags.id))
        .where(inArray(commTags.commId, commIds));
      for (const row of rows) {
        const list = result.get(row.commId) ?? [];
        list.push(row.tag);
        result.set(row.commId, list);
      }
      return result;
    },

    async addTag(commId: string, tagId: string): Promise<CommTagLink> {
      const client = getClient();
      const [link] = await client
        .insert(commTags)
        .values({ commId, commTagId: tagId })
        .onConflictDoNothing()
        .returning();
      if (link) return link;
      const [existing] = await client
        .select()
        .from(commTags)
        .where(and(eq(commTags.commId, commId), eq(commTags.commTagId, tagId)));
      return existing;
    },

    async removeTag(commId: string, tagId: string): Promise<boolean> {
      const client = getClient();
      const deleted = await client
        .delete(commTags)
        .where(and(eq(commTags.commId, commId), eq(commTags.commTagId, tagId)))
        .returning();
      return deleted.length > 0;
    },

    async findMissingTagIds(tagIds: string[]): Promise<string[]> {
      const unique = Array.from(new Set(tagIds));
      if (unique.length === 0) return [];
      const client = getClient();
      const rows = await client
        .select({ id: optionsCommTags.id })
        .from(optionsCommTags)
        .where(inArray(optionsCommTags.id, unique));
      const found = new Set(rows.map((r) => r.id));
      return unique.filter((id) => !found.has(id));
    },

    async setTags(commId: string, tagIds: string[]): Promise<OptionsCommTag[]> {
      const unique = Array.from(new Set(tagIds));
      return runInTransaction(async () => {
        const client = getClient();
        const existingRows = await client
          .select({ commTagId: commTags.commTagId })
          .from(commTags)
          .where(eq(commTags.commId, commId));
        const existing = new Set(existingRows.map((r) => r.commTagId));
        const desired = new Set(unique);

        const toRemove = [...existing].filter((id) => !desired.has(id));
        const toAdd = unique.filter((id) => !existing.has(id));

        for (const tagId of toRemove) {
          await client
            .delete(commTags)
            .where(and(eq(commTags.commId, commId), eq(commTags.commTagId, tagId)));
          storageLogger.info('Storage operation: comm-tags.removeTag', {
            module: 'comm-tags',
            operation: 'removeTag',
            entity_id: tagId,
            host_entity_id: commId,
            description: `setTags diff: unlinked tag "${tagId}" from comm "${commId}"`,
            meta: { commId, tagId, source: 'setTags' },
          });
        }

        for (const tagId of toAdd) {
          await client
            .insert(commTags)
            .values({ commId, commTagId: tagId })
            .onConflictDoNothing();
          storageLogger.info('Storage operation: comm-tags.addTag', {
            module: 'comm-tags',
            operation: 'addTag',
            entity_id: tagId,
            host_entity_id: commId,
            description: `setTags diff: linked tag "${tagId}" to comm "${commId}"`,
            meta: { commId, tagId, source: 'setTags' },
          });
        }

        if (unique.length === 0) return [];
        const tags = await client
          .select()
          .from(optionsCommTags)
          .where(inArray(optionsCommTags.id, unique));
        return tags;
      });
    },
  };
}
