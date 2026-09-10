import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  wizardFeedMappings,
  entityMetadata,
  type WizardFeedMapping,
  type InsertWizardFeedMapping,
} from "@shared/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface WizardFeedMappingStorage {
  create(mapping: InsertWizardFeedMapping): Promise<WizardFeedMapping>;
  update(id: string, updates: Partial<Omit<InsertWizardFeedMapping, 'id'>>): Promise<WizardFeedMapping | undefined>;
  delete(id: string): Promise<boolean>;
  listByUser(userId: string, type?: string): Promise<WizardFeedMapping[]>;
}

/**
 * A saved feed mapping is operator-editable configuration — which column of
 * an imported file feeds which field — so who changed one is worth recording.
 * The table joined the storage logging framework when its own `created_at` /
 * `updated_at` columns were retired; `entity_metadata` is the single answer to
 * when a mapping was made and by whom, and the log entries are what the admin
 * log viewer shows.
 *
 * The record has no page of its own (see `entity-metadata-record-tables.ts`),
 * and the owning user is named as the host so a mapping's history reads on the
 * user it belongs to.
 */
export const wizardFeedMappingLoggingConfig = defineLoggingConfig<WizardFeedMappingStorage>({
  module: 'wizardFeedMappings',
  table: 'wizard_feed_mappings',
  hostTable: 'users',
  state: { key: 'mapping' },
  methods: {
    create: {
      state: { fallbackId: 'new feed mapping' },
      metadataEntityId: (_args, result) => result?.id,
      getHostEntityId: (args, result) => result?.userId ?? args[0]?.userId,
      getDescription: async (args, result) => {
        const type = result?.type ?? args[0]?.type ?? 'unknown';
        return `Created Feed Mapping [${type}]`;
      },
    },
    update: {
      getHostEntityId: (_args, result, beforeState) =>
        result?.userId ?? beforeState?.mapping?.userId,
      before: async (args) => {
        const client = getClient();
        const [mapping] = await client
          .select()
          .from(wizardFeedMappings)
          .where(eq(wizardFeedMappings.id, args[0]));
        return mapping ? { mapping } : null;
      },
      state: { previousKey: 'previousState' },
      getDescription: async (_args, result, beforeState) => {
        const type = result?.type ?? beforeState?.mapping?.type ?? 'unknown';
        return `Updated Feed Mapping [${type}]`;
      },
    },
    delete: {
      getHostEntityId: (_args, _result, beforeState) => beforeState?.mapping?.userId,
      before: async (args) => {
        const client = getClient();
        const [mapping] = await client
          .select()
          .from(wizardFeedMappings)
          .where(eq(wizardFeedMappings.id, args[0]));
        return mapping ? { mapping } : null;
      },
      getDescription: async (_args, _result, beforeState) => {
        const type = beforeState?.mapping?.type ?? 'unknown';
        return `Deleted Feed Mapping [${type}]`;
      },
    },
  },
});

export function createWizardFeedMappingStorage(): WizardFeedMappingStorage {
  return {
    async create(insertMapping: InsertWizardFeedMapping): Promise<WizardFeedMapping> {
      validate.validateOrThrow(insertMapping);
      const client = getClient();
      const [mapping] = await client
        .insert(wizardFeedMappings)
        .values(insertMapping)
        .returning();
      return mapping;
    },

    async update(
      id: string, 
      updates: Partial<Omit<InsertWizardFeedMapping, 'id'>>
    ): Promise<WizardFeedMapping | undefined> {
      validate.validateOrThrow(id);
      const client = getClient();
      const [mapping] = await client
        .update(wizardFeedMappings)
        .set(updates)
        .where(eq(wizardFeedMappings.id, id))
        .returning();
      return mapping || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardFeedMappings)
        .where(eq(wizardFeedMappings.id, id))
        .returning();
      return result.length > 0;
    },

    async listByUser(userId: string, type?: string): Promise<WizardFeedMapping[]> {
      const client = getClient();
      const conditions = [eq(wizardFeedMappings.userId, userId)];
      
      if (type) {
        conditions.push(eq(wizardFeedMappings.type, type));
      }

      // Most recently changed first — the same ordering the retired
      // `updated_at` column gave, read from provenance instead. Provenance is
      // written best effort, so a mapping the framework has no row for sorts
      // last rather than first (a missing stamp is not a recent one), with the
      // id as a tiebreak so the order is total.
      const rows = await client
        .select({ mapping: wizardFeedMappings })
        .from(wizardFeedMappings)
        .leftJoin(
          entityMetadata,
          and(
            eq(entityMetadata.entityId, wizardFeedMappings.id),
            eq(entityMetadata.contextId, 'wizard_feed_mappings'),
          ),
        )
        .where(and(...conditions))
        .orderBy(sql`${entityMetadata.modifiedDate} DESC NULLS LAST`, asc(wizardFeedMappings.id));
      return rows.map((r) => r.mapping);
    },
  };
}
