import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import { bargainingUnits, type BargainingUnit, type InsertBargainingUnit } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

export interface NamedRate {
  name: string;
  rate: number;
}

export interface AccountRates {
  [accountId: string]: NamedRate[];
}

export interface BargainingUnitData {
  accountRates?: AccountRates;
  [key: string]: unknown;
}

function normalizeAccountRates(raw: Record<string, unknown> | undefined): AccountRates {
  if (!raw) return {};
  const result: AccountRates = {};
  for (const [accountId, value] of Object.entries(raw)) {
    if (typeof value === 'number') {
      result[accountId] = [{ name: 'Default', rate: value }];
    } else if (Array.isArray(value)) {
      result[accountId] = value as NamedRate[];
    }
  }
  return result;
}

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertBargainingUnit, BargainingUnit>();

export interface BargainingUnitStorage {
  getAllBargainingUnits(): Promise<BargainingUnit[]>;
  getBargainingUnitById(id: string): Promise<BargainingUnit | undefined>;
  getBargainingUnitBySiriusId(siriusId: string): Promise<BargainingUnit | undefined>;
  createBargainingUnit(data: InsertBargainingUnit): Promise<BargainingUnit>;
  updateBargainingUnit(id: string, data: Partial<InsertBargainingUnit>): Promise<BargainingUnit | undefined>;
  deleteBargainingUnit(id: string): Promise<boolean>;
  setAccountRate(id: string, accountId: string, name: string, rate: number): Promise<BargainingUnit | undefined>;
  updateAccountRate(id: string, accountId: string, rateIndex: number, name: string, rate: number): Promise<BargainingUnit | undefined>;
  removeAccountRateEntry(id: string, accountId: string, rateIndex: number): Promise<BargainingUnit | undefined>;
  getAccountRates(id: string): Promise<AccountRates | undefined>;
  removeAccountRate(id: string, accountId: string): Promise<BargainingUnit | undefined>;
}

export function createBargainingUnitStorage(): BargainingUnitStorage {
  const storage: BargainingUnitStorage = {
    async getAllBargainingUnits(): Promise<BargainingUnit[]> {
      const client = getClient();
      return await client.select().from(bargainingUnits);
    },

    async getBargainingUnitById(id: string): Promise<BargainingUnit | undefined> {
      const client = getClient();
      const [unit] = await client
        .select()
        .from(bargainingUnits)
        .where(eq(bargainingUnits.id, id));
      return unit || undefined;
    },

    async getBargainingUnitBySiriusId(siriusId: string): Promise<BargainingUnit | undefined> {
      const client = getClient();
      const [unit] = await client
        .select()
        .from(bargainingUnits)
        .where(eq(bargainingUnits.siriusId, siriusId));
      return unit || undefined;
    },

    async createBargainingUnit(data: InsertBargainingUnit): Promise<BargainingUnit> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [unit] = await client
        .insert(bargainingUnits)
        .values(data)
        .returning();
      return unit;
    },

    async updateBargainingUnit(id: string, data: Partial<InsertBargainingUnit>): Promise<BargainingUnit | undefined> {
      validate.validateOrThrow(data as InsertBargainingUnit);
      const client = getClient();
      const [updated] = await client
        .update(bargainingUnits)
        .set(data)
        .where(eq(bargainingUnits.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteBargainingUnit(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(bargainingUnits)
        .where(eq(bargainingUnits.id, id))
        .returning();
      return result.length > 0;
    },

    async setAccountRate(id: string, accountId: string, name: string, rate: number): Promise<BargainingUnit | undefined> {
      const unit = await storage.getBargainingUnitById(id);
      if (!unit) return undefined;

      const existingData = (unit.data as BargainingUnitData) || {};
      const accountRates = normalizeAccountRates(existingData.accountRates as Record<string, unknown>);
      const existing = accountRates[accountId] || [];
      
      const newData: BargainingUnitData = {
        ...existingData,
        accountRates: {
          ...accountRates,
          [accountId]: [...existing, { name, rate }],
        },
      };

      return storage.updateBargainingUnit(id, { data: newData });
    },

    async updateAccountRate(id: string, accountId: string, rateIndex: number, name: string, rate: number): Promise<BargainingUnit | undefined> {
      const unit = await storage.getBargainingUnitById(id);
      if (!unit) return undefined;

      const existingData = (unit.data as BargainingUnitData) || {};
      const accountRates = normalizeAccountRates(existingData.accountRates as Record<string, unknown>);
      const existing = accountRates[accountId] || [];
      if (rateIndex < 0 || rateIndex >= existing.length) return undefined;

      const updated = [...existing];
      updated[rateIndex] = { name, rate };

      const newData: BargainingUnitData = {
        ...existingData,
        accountRates: {
          ...accountRates,
          [accountId]: updated,
        },
      };

      return storage.updateBargainingUnit(id, { data: newData });
    },

    async removeAccountRateEntry(id: string, accountId: string, rateIndex: number): Promise<BargainingUnit | undefined> {
      const unit = await storage.getBargainingUnitById(id);
      if (!unit) return undefined;

      const existingData = (unit.data as BargainingUnitData) || {};
      const accountRates = normalizeAccountRates(existingData.accountRates as Record<string, unknown>);
      const existing = accountRates[accountId] || [];
      if (rateIndex < 0 || rateIndex >= existing.length) return undefined;

      const updated = existing.filter((_, i) => i !== rateIndex);
      const newRates = { ...accountRates };
      if (updated.length === 0) {
        delete newRates[accountId];
      } else {
        newRates[accountId] = updated;
      }

      const newData: BargainingUnitData = {
        ...existingData,
        accountRates: newRates,
      };

      return storage.updateBargainingUnit(id, { data: newData });
    },

    async getAccountRates(id: string): Promise<AccountRates | undefined> {
      const unit = await storage.getBargainingUnitById(id);
      if (!unit) return undefined;

      const data = unit.data as BargainingUnitData | null;
      return normalizeAccountRates(data?.accountRates as Record<string, unknown>);
    },

    async removeAccountRate(id: string, accountId: string): Promise<BargainingUnit | undefined> {
      const unit = await storage.getBargainingUnitById(id);
      if (!unit) return undefined;

      const existingData = (unit.data as BargainingUnitData) || {};
      const accountRates = normalizeAccountRates(existingData.accountRates as Record<string, unknown>);
      delete accountRates[accountId];
      
      const newData: BargainingUnitData = {
        ...existingData,
        accountRates,
      };

      return storage.updateBargainingUnit(id, { data: newData });
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
        
        const oldData = beforeState?.bargainingUnit?.data as BargainingUnitData | null;
        const newData = result?.data as BargainingUnitData | null;
        const oldRates = normalizeAccountRates(oldData?.accountRates as Record<string, unknown>);
        const newRates = normalizeAccountRates(newData?.accountRates as Record<string, unknown>);
        
        const rateChanges: string[] = [];
        const allAccountIds = Array.from(new Set([...Object.keys(oldRates), ...Object.keys(newRates)]));
        for (const accountId of allAccountIds) {
          const oldEntries = oldRates[accountId] || [];
          const newEntries = newRates[accountId] || [];
          const oldStr = JSON.stringify(oldEntries);
          const newStr = JSON.stringify(newEntries);
          if (oldStr !== newStr) {
            if (oldEntries.length === 0) {
              const desc = newEntries.map(e => `${e.name}: $${e.rate}`).join(', ');
              rateChanges.push(`added rates [${desc}] for account ${accountId}`);
            } else if (newEntries.length === 0) {
              rateChanges.push(`removed all rates for account ${accountId}`);
            } else {
              const desc = newEntries.map(e => `${e.name}: $${e.rate}`).join(', ');
              rateChanges.push(`updated rates to [${desc}] for account ${accountId}`);
            }
          }
        }
        
        if (rateChanges.length > 0) {
          return `Updated Bargaining Unit [${siriusId}] ${newName}: ${rateChanges.join(', ')}`;
        }
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
        const oldData = beforeState?.bargainingUnit?.data as BargainingUnitData | null;
        const newData = result?.data as BargainingUnitData | null;
        return {
          bargainingUnit: result,
          previousBargainingUnit: beforeState?.bargainingUnit,
          accountRatesBefore: oldData?.accountRates || {},
          accountRatesAfter: newData?.accountRates || {},
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
