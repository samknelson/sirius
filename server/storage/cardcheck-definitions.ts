import { getClient } from './transaction-context';
import { cardcheckDefinitions, type CardcheckDefinition, type InsertCardcheckDefinition } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export interface CardcheckDefinitionStorage {
  getAllCardcheckDefinitions(): Promise<CardcheckDefinition[]>;
  getCardcheckDefinitionById(id: string): Promise<CardcheckDefinition | undefined>;
  getCardcheckDefinitionBySiriusId(siriusId: string): Promise<CardcheckDefinition | undefined>;
  createCardcheckDefinition(data: InsertCardcheckDefinition): Promise<CardcheckDefinition>;
  updateCardcheckDefinition(id: string, data: Partial<InsertCardcheckDefinition>): Promise<CardcheckDefinition | undefined>;
  deleteCardcheckDefinition(id: string): Promise<boolean>;
}

export function createCardcheckDefinitionStorage(): CardcheckDefinitionStorage {
  const storage: CardcheckDefinitionStorage = {
    async getAllCardcheckDefinitions(): Promise<CardcheckDefinition[]> {
      const client = getClient();
      return await client.select().from(cardcheckDefinitions);
    },

    async getCardcheckDefinitionById(id: string): Promise<CardcheckDefinition | undefined> {
      const client = getClient();
      const [definition] = await client
        .select()
        .from(cardcheckDefinitions)
        .where(eq(cardcheckDefinitions.id, id));
      return definition || undefined;
    },

    async getCardcheckDefinitionBySiriusId(siriusId: string): Promise<CardcheckDefinition | undefined> {
      const client = getClient();
      const [definition] = await client
        .select()
        .from(cardcheckDefinitions)
        .where(eq(cardcheckDefinitions.siriusId, siriusId));
      return definition || undefined;
    },

    async createCardcheckDefinition(data: InsertCardcheckDefinition): Promise<CardcheckDefinition> {
      const client = getClient();
      const [definition] = await client
        .insert(cardcheckDefinitions)
        .values(data)
        .returning();
      return definition;
    },

    async updateCardcheckDefinition(id: string, data: Partial<InsertCardcheckDefinition>): Promise<CardcheckDefinition | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(cardcheckDefinitions)
        .set(data)
        .where(eq(cardcheckDefinitions.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteCardcheckDefinition(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(cardcheckDefinitions)
        .where(eq(cardcheckDefinitions.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const cardcheckDefinitionLoggingConfig: StorageLoggingConfig<CardcheckDefinitionStorage> = {
  module: 'cardcheck-definitions',
  methods: {
    createCardcheckDefinition: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new cardcheck definition',
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        const siriusId = result?.siriusId || args[0]?.siriusId || '';
        return `Created Cardcheck Definition [${siriusId}] ${name}`;
      },
      after: async (args, result) => {
        return {
          cardcheckDefinition: result,
          metadata: {
            cardcheckDefinitionId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    updateCardcheckDefinition: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.cardcheckDefinition?.name || 'Unknown';
        const newName = result?.name || oldName;
        const siriusId = result?.siriusId || beforeState?.cardcheckDefinition?.siriusId || '';
        if (oldName !== newName) {
          return `Updated Cardcheck Definition [${siriusId}] ${oldName} → ${newName}`;
        }
        return `Updated Cardcheck Definition [${siriusId}] ${newName}`;
      },
      before: async (args, storage) => {
        const cardcheckDefinition = await storage.getCardcheckDefinitionById(args[0]);
        return { cardcheckDefinition };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          cardcheckDefinition: result,
          previousState: beforeState?.cardcheckDefinition,
          metadata: {
            cardcheckDefinitionId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    deleteCardcheckDefinition: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.cardcheckDefinition?.name || 'Unknown';
        const siriusId = beforeState?.cardcheckDefinition?.siriusId || '';
        return `Deleted Cardcheck Definition [${siriusId}] ${name}`;
      },
      before: async (args, storage) => {
        const cardcheckDefinition = await storage.getCardcheckDefinitionById(args[0]);
        return { cardcheckDefinition };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          cardcheckDefinition: beforeState?.cardcheckDefinition,
          metadata: {
            cardcheckDefinitionId: args[0],
            siriusId: beforeState?.cardcheckDefinition?.siriusId,
            name: beforeState?.cardcheckDefinition?.name,
          }
        };
      }
    },
  },
};
