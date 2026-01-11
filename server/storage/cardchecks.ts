import { db } from './db';
import { cardchecks, cardcheckDefinitions, workers, contacts, type Cardcheck, type InsertCardcheck } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export interface CardcheckStatusSummary {
  workerId: string;
  definitionId: string;
  definitionName: string;
  definitionIcon: string;
  status: 'signed' | 'pending' | 'revoked' | 'none';
}

export interface CardcheckStorage {
  getAllCardchecks(): Promise<Cardcheck[]>;
  getCardcheckById(id: string): Promise<Cardcheck | undefined>;
  getCardcheckByEsigId(esigId: string): Promise<Cardcheck | undefined>;
  getCardchecksByWorkerId(workerId: string): Promise<Cardcheck[]>;
  getCardchecksByDefinitionId(definitionId: string): Promise<Cardcheck[]>;
  getCardcheckStatusSummary(): Promise<CardcheckStatusSummary[]>;
  createCardcheck(data: InsertCardcheck): Promise<Cardcheck>;
  updateCardcheck(id: string, data: Partial<InsertCardcheck>): Promise<Cardcheck | undefined>;
  deleteCardcheck(id: string): Promise<boolean>;
}

export function createCardcheckStorage(): CardcheckStorage {
  const storage: CardcheckStorage = {
    async getAllCardchecks(): Promise<Cardcheck[]> {
      return await db.select().from(cardchecks);
    },

    async getCardcheckById(id: string): Promise<Cardcheck | undefined> {
      const [cardcheck] = await db
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.id, id));
      return cardcheck || undefined;
    },

    async getCardcheckByEsigId(esigId: string): Promise<Cardcheck | undefined> {
      const [cardcheck] = await db
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.esigId, esigId));
      return cardcheck || undefined;
    },

    async getCardchecksByWorkerId(workerId: string): Promise<Cardcheck[]> {
      return await db
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.workerId, workerId));
    },

    async getCardchecksByDefinitionId(definitionId: string): Promise<Cardcheck[]> {
      return await db
        .select()
        .from(cardchecks)
        .where(eq(cardchecks.cardcheckDefinitionId, definitionId));
    },

    async getCardcheckStatusSummary(): Promise<CardcheckStatusSummary[]> {
      const definitions = await db.select().from(cardcheckDefinitions);
      const definitionsWithIcons = definitions.filter(d => {
        const data = d.data as any;
        return data?.icon;
      });
      
      if (definitionsWithIcons.length === 0) {
        return [];
      }
      
      const allWorkers = await db.select({ id: workers.id }).from(workers);
      const allCardchecks = await db.select().from(cardchecks);
      
      const cardcheckMap = new Map<string, Map<string, string>>();
      for (const cc of allCardchecks) {
        if (!cardcheckMap.has(cc.workerId)) {
          cardcheckMap.set(cc.workerId, new Map());
        }
        const workerMap = cardcheckMap.get(cc.workerId)!;
        const existingStatus = workerMap.get(cc.cardcheckDefinitionId);
        if (!existingStatus || cc.status === 'signed' || (cc.status === 'revoked' && existingStatus !== 'signed')) {
          workerMap.set(cc.cardcheckDefinitionId, cc.status);
        }
      }
      
      const summaries: CardcheckStatusSummary[] = [];
      for (const worker of allWorkers) {
        for (const def of definitionsWithIcons) {
          const workerCardchecks = cardcheckMap.get(worker.id);
          const status = workerCardchecks?.get(def.id) || 'none';
          summaries.push({
            workerId: worker.id,
            definitionId: def.id,
            definitionName: def.name,
            definitionIcon: (def.data as any).icon,
            status: status as 'signed' | 'pending' | 'revoked' | 'none',
          });
        }
      }
      
      return summaries;
    },

    async createCardcheck(data: InsertCardcheck): Promise<Cardcheck> {
      if (data.status === "signed") {
        const existing = await db
          .select()
          .from(cardchecks)
          .where(and(
            eq(cardchecks.workerId, data.workerId),
            eq(cardchecks.cardcheckDefinitionId, data.cardcheckDefinitionId),
            eq(cardchecks.status, "signed")
          ));
        if (existing.length > 0) {
          throw new Error("A signed cardcheck of this type already exists for this worker");
        }
      }
      
      const [cardcheck] = await db
        .insert(cardchecks)
        .values(data)
        .returning();
      return cardcheck;
    },

    async updateCardcheck(id: string, data: Partial<InsertCardcheck>): Promise<Cardcheck | undefined> {
      if (data.status === "signed") {
        const current = await storage.getCardcheckById(id);
        if (current && current.status !== "signed") {
          const existing = await db
            .select()
            .from(cardchecks)
            .where(and(
              eq(cardchecks.workerId, current.workerId),
              eq(cardchecks.cardcheckDefinitionId, current.cardcheckDefinitionId),
              eq(cardchecks.status, "signed")
            ));
          if (existing.length > 0) {
            throw new Error("A signed cardcheck of this type already exists for this worker");
          }
        }
      }
      
      const [updated] = await db
        .update(cardchecks)
        .set(data)
        .where(eq(cardchecks.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteCardcheck(id: string): Promise<boolean> {
      const result = await db
        .delete(cardchecks)
        .where(eq(cardchecks.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

async function getWorkerName(workerId: string): Promise<string> {
  const [worker] = await db
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await db
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
}

async function getDefinitionName(definitionId: string): Promise<string> {
  const [definition] = await db
    .select({ name: cardcheckDefinitions.name, siriusId: cardcheckDefinitions.siriusId })
    .from(cardcheckDefinitions)
    .where(eq(cardcheckDefinitions.id, definitionId));
  return definition ? `[${definition.siriusId}] ${definition.name}` : 'Unknown Definition';
}

export const cardcheckLoggingConfig: StorageLoggingConfig<CardcheckStorage> = {
  module: 'cardchecks',
  methods: {
    createCardcheck: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new cardcheck',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const definitionName = await getDefinitionName(result?.cardcheckDefinitionId || args[0]?.cardcheckDefinitionId);
        return `Created Cardcheck for ${workerName} - ${definitionName}`;
      },
      after: async (args, result) => {
        return {
          cardcheck: result,
          metadata: {
            cardcheckId: result?.id,
            workerId: result?.workerId,
            cardcheckDefinitionId: result?.cardcheckDefinitionId,
            status: result?.status,
          }
        };
      }
    },
    updateCardcheck: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.cardcheck?.workerId) {
          return beforeState.cardcheck.workerId;
        }
        const [cardcheck] = await db.select().from(cardchecks).where(eq(cardchecks.id, args[0]));
        return cardcheck?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerId = result?.workerId || beforeState?.cardcheck?.workerId;
        const workerName = workerId ? await getWorkerName(workerId) : 'Unknown Worker';
        const definitionId = result?.cardcheckDefinitionId || beforeState?.cardcheck?.cardcheckDefinitionId;
        const definitionName = definitionId ? await getDefinitionName(definitionId) : 'Unknown Definition';
        
        const oldStatus = beforeState?.cardcheck?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated Cardcheck for ${workerName} - ${definitionName}: ${oldStatus} → ${newStatus}`;
        }
        return `Updated Cardcheck for ${workerName} - ${definitionName}`;
      },
      before: async (args, storage) => {
        const cardcheck = await storage.getCardcheckById(args[0]);
        return { cardcheck };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          cardcheck: result,
          previousState: beforeState?.cardcheck,
          metadata: {
            cardcheckId: result?.id,
            workerId: result?.workerId,
            cardcheckDefinitionId: result?.cardcheckDefinitionId,
            status: result?.status,
            previousStatus: beforeState?.cardcheck?.status,
          }
        };
      }
    },
    deleteCardcheck: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.cardcheck?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerId = beforeState?.cardcheck?.workerId;
        const workerName = workerId ? await getWorkerName(workerId) : 'Unknown Worker';
        const definitionId = beforeState?.cardcheck?.cardcheckDefinitionId;
        const definitionName = definitionId ? await getDefinitionName(definitionId) : 'Unknown Definition';
        return `Deleted Cardcheck for ${workerName} - ${definitionName}`;
      },
      before: async (args, storage) => {
        const cardcheck = await storage.getCardcheckById(args[0]);
        return { cardcheck };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          cardcheck: beforeState?.cardcheck,
          metadata: {
            cardcheckId: args[0],
            workerId: beforeState?.cardcheck?.workerId,
            cardcheckDefinitionId: beforeState?.cardcheck?.cardcheckDefinitionId,
            status: beforeState?.cardcheck?.status,
          }
        };
      }
    },
  },
};
