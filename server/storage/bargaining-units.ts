import { db } from "../db";
import { bargainingUnits, type BargainingUnit, type InsertBargainingUnit } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export interface BargainingUnitStorage {
  getAllBargainingUnits(): Promise<BargainingUnit[]>;
  getBargainingUnitById(id: string): Promise<BargainingUnit | undefined>;
  getBargainingUnitBySiriusId(siriusId: string): Promise<BargainingUnit | undefined>;
  createBargainingUnit(data: InsertBargainingUnit): Promise<BargainingUnit>;
  updateBargainingUnit(id: string, data: Partial<InsertBargainingUnit>): Promise<BargainingUnit | undefined>;
  deleteBargainingUnit(id: string): Promise<boolean>;
}

export function createBargainingUnitStorage(): BargainingUnitStorage {
  const storage: BargainingUnitStorage = {
    async getAllBargainingUnits(): Promise<BargainingUnit[]> {
      return await db.select().from(bargainingUnits);
    },

    async getBargainingUnitById(id: string): Promise<BargainingUnit | undefined> {
      const [unit] = await db
        .select()
        .from(bargainingUnits)
        .where(eq(bargainingUnits.id, id));
      return unit || undefined;
    },

    async getBargainingUnitBySiriusId(siriusId: string): Promise<BargainingUnit | undefined> {
      const [unit] = await db
        .select()
        .from(bargainingUnits)
        .where(eq(bargainingUnits.siriusId, siriusId));
      return unit || undefined;
    },

    async createBargainingUnit(data: InsertBargainingUnit): Promise<BargainingUnit> {
      const [unit] = await db
        .insert(bargainingUnits)
        .values(data)
        .returning();
      return unit;
    },

    async updateBargainingUnit(id: string, data: Partial<InsertBargainingUnit>): Promise<BargainingUnit | undefined> {
      const [updated] = await db
        .update(bargainingUnits)
        .set(data)
        .where(eq(bargainingUnits.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteBargainingUnit(id: string): Promise<boolean> {
      const result = await db
        .delete(bargainingUnits)
        .where(eq(bargainingUnits.id, id))
        .returning();
      return result.length > 0;
    },
  };

  return storage;
}

export const bargainingUnitLoggingConfig: StorageLoggingConfig<BargainingUnitStorage> = {
  module: 'bargainingUnits',
  methods: {
    createBargainingUnit: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new bargaining unit',
      getDescription: async (args, result) => {
        const name = result?.name || args[0]?.name || 'Unnamed';
        const siriusId = result?.siriusId || args[0]?.siriusId || '';
        return `Created Bargaining Unit [${siriusId}] ${name}`;
      },
      after: async (args, result) => {
        return {
          bargainingUnit: result,
          metadata: {
            bargainingUnitId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    updateBargainingUnit: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const oldName = beforeState?.bargainingUnit?.name || 'Unknown';
        const newName = result?.name || oldName;
        const siriusId = result?.siriusId || beforeState?.bargainingUnit?.siriusId || '';
        if (oldName !== newName) {
          return `Updated Bargaining Unit [${siriusId}] ${oldName} → ${newName}`;
        }
        return `Updated Bargaining Unit [${siriusId}] ${newName}`;
      },
      before: async (args, storage) => {
        const bargainingUnit = await storage.getBargainingUnitById(args[0]);
        return { bargainingUnit };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          bargainingUnit: result,
          previousBargainingUnit: beforeState?.bargainingUnit,
          metadata: {
            bargainingUnitId: result?.id,
            siriusId: result?.siriusId,
            name: result?.name,
          }
        };
      }
    },
    deleteBargainingUnit: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState) => {
        const name = beforeState?.bargainingUnit?.name || 'Unknown';
        const siriusId = beforeState?.bargainingUnit?.siriusId || '';
        return `Deleted Bargaining Unit [${siriusId}] ${name}`;
      },
      before: async (args, storage) => {
        const bargainingUnit = await storage.getBargainingUnitById(args[0]);
        return { bargainingUnit };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          deleted: result,
          bargainingUnit: beforeState?.bargainingUnit,
          metadata: {
            bargainingUnitId: args[0],
            siriusId: beforeState?.bargainingUnit?.siriusId,
            name: beforeState?.bargainingUnit?.name,
          }
        };
      }
    },
  }
};
