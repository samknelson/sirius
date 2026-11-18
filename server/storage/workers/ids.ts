import { createNoopValidator } from '../utils/validation';
import { getClient, runInTransaction } from '../transaction-context';
import { ALTERNATE_TAX_ID, normalizeAlternateTaxId, redactTaxIdRecord, TaxIdentityReviewError } from "@shared/utils/worker-tax-identity";
import { workerIds, optionsWorkerIdType, type WorkerId, type InsertWorkerId } from "@shared/schema";
import { eq, and, inArray, ne, sql } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

/** Escape a literal string for safe embedding in a Postgres regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ShowOnListsIdType {
  id: string;
  name: string;
}

export interface WorkerIdForList {
  workerId: string;
  typeId: string;
  value: string;
}

export interface WorkerIdStorage {
  getWorkerIdsByWorkerId(workerId: string, includeSensitive?: boolean): Promise<WorkerId[]>;
  getWorkerId(id: string, includeSensitive?: boolean): Promise<WorkerId | undefined>;
  createWorkerId(workerId: InsertWorkerId): Promise<WorkerId>;
  updateWorkerId(id: string, workerId: Partial<InsertWorkerId>): Promise<WorkerId | undefined>;
  deleteWorkerId(id: string): Promise<boolean>;
  getShowOnListsIdTypes(): Promise<ShowOnListsIdType[]>;
  getWorkerIdsForListByWorkerIds(workerIdsList: string[]): Promise<WorkerIdForList[]>;
  getWorkerIdsByTypeForWorkerIds(typeId: string, workerIdsList: string[]): Promise<{ workerId: string; value: string }[]>;
  getWorkerIdByTypeAndValue(typeId: string, value: string): Promise<WorkerId | undefined>;
  /**
   * All rows for a type whose value equals `value` OR equals `value` with a
   * single leading letter (case-insensitive), e.g. "118637" also matches
   * "I118637" / "O118637". Returns every match so callers can prefer the
   * exact match and detect ambiguity among prefixed variants.
   */
  getWorkerIdsByTypeAndValueWithOptionalPrefix(typeId: string, value: string): Promise<WorkerId[]>;
  getByTypeAndValues(typeId: string, values: string[]): Promise<Array<{ value: string; workerId: string }>>;
  getTypeIdBySiriusId(siriusId: string): Promise<string | null>;
}

export function createWorkerIdStorage(): WorkerIdStorage {
  return {
    async getWorkerIdsByWorkerId(workerId: string, includeSensitive = false): Promise<WorkerId[]> {
      const client = getClient();
      return client.select().from(workerIds).where(and(eq(workerIds.workerId, workerId),
        includeSensitive ? undefined : ne(workerIds.typeId, ALTERNATE_TAX_ID)));
    },

    async getWorkerId(id: string, includeSensitive = false): Promise<WorkerId | undefined> {
      const client = getClient();
      const [workerId] = await client.select().from(workerIds).where(and(eq(workerIds.id, id),
        includeSensitive ? undefined : ne(workerIds.typeId, ALTERNATE_TAX_ID)));
      return workerId || undefined;
    },

    async createWorkerId(insertWorkerId: InsertWorkerId): Promise<WorkerId> {
      validate.validateOrThrow(insertWorkerId);
      const data = { ...insertWorkerId };
      if (data.typeId === ALTERNATE_TAX_ID) data.value = normalizeAlternateTaxId(data.value);
      try {
        return await runInTransaction(async () => {
          const [workerId] = await getClient().insert(workerIds).values(data).returning();
          return workerId;
        });
      } catch (error) {
        if (data.typeId === ALTERNATE_TAX_ID) throw new TaxIdentityReviewError("Alternate Tax ID could not be saved. It may already belong to another worker; review IDs before retrying.");
        throw error;
      }
    },

    async updateWorkerId(id: string, workerIdUpdate: Partial<InsertWorkerId>): Promise<WorkerId | undefined> {
      validate.validateOrThrow(id);
      const current = await this.getWorkerId(id, true);
      if (!current) return undefined;
      const data = { ...workerIdUpdate };
      if ((current.typeId === ALTERNATE_TAX_ID || data.typeId === ALTERNATE_TAX_ID)
        && (data.workerId && data.workerId !== current.workerId || data.typeId && data.typeId !== current.typeId)) {
        throw new TaxIdentityReviewError("Do not reassign a tax identifier or change its type. Review and correct the worker's IDs instead.");
      }
      const sensitive = current.typeId === ALTERNATE_TAX_ID;
      if (sensitive) data.value = normalizeAlternateTaxId(data.value ?? current.value);
      try {
        return await runInTransaction(async () => {
          const [workerId] = await getClient().update(workerIds).set(data).where(eq(workerIds.id, id)).returning();
          return workerId || undefined;
        });
      } catch (error) {
        if (sensitive) throw new TaxIdentityReviewError("Alternate Tax ID could not be saved. Review conflicting worker IDs before retrying.");
        throw error;
      }
    },

    async deleteWorkerId(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(workerIds).where(eq(workerIds.id, id)).returning();
      return result.length > 0;
    },

    async getByTypeAndValues(typeId: string, values: string[]): Promise<Array<{ value: string; workerId: string }>> {
      if (typeId === ALTERNATE_TAX_ID) return [];
      if (values.length === 0) return [];
      const client = getClient();
      const results = await client
        .select({ value: workerIds.value, workerId: workerIds.workerId })
        .from(workerIds)
        .where(and(eq(workerIds.typeId, typeId), inArray(workerIds.value, values)));
      return results;
    },

    async getTypeIdBySiriusId(siriusId: string): Promise<string | null> {
      const client = getClient();
      const [row] = await client
        .select({ id: optionsWorkerIdType.id })
        .from(optionsWorkerIdType)
        .where(eq(optionsWorkerIdType.siriusId, siriusId))
        .limit(1);
      return row?.id ?? null;
    },

    async getWorkerIdByTypeAndValue(typeId: string, value: string): Promise<WorkerId | undefined> {
      if (typeId === ALTERNATE_TAX_ID) value = normalizeAlternateTaxId(value);
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerIds)
        .where(and(eq(workerIds.typeId, typeId), eq(workerIds.value, value)))
        .limit(1);
      return row || undefined;
    },

    async getWorkerIdsByTypeAndValueWithOptionalPrefix(typeId: string, value: string): Promise<WorkerId[]> {
      if (typeId === ALTERNATE_TAX_ID) return [];
      const client = getClient();
      return client
        .select()
        .from(workerIds)
        .where(and(
          eq(workerIds.typeId, typeId),
          sql`(${workerIds.value} = ${value} OR ${workerIds.value} ~* ${`^[A-Za-z]${escapeRegex(value)}$`})`,
        ));
    },

    async getShowOnListsIdTypes(): Promise<ShowOnListsIdType[]> {
      const client = getClient();
      const results = await client
        .select({ id: optionsWorkerIdType.id, name: optionsWorkerIdType.name })
        .from(optionsWorkerIdType)
        .where(and(ne(optionsWorkerIdType.id, ALTERNATE_TAX_ID), sql`(${optionsWorkerIdType.data}->>'showOnLists')::boolean = true`))
        .orderBy(optionsWorkerIdType.sequence);
      return results;
    },

    async getWorkerIdsForListByWorkerIds(workerIdsList: string[]): Promise<WorkerIdForList[]> {
      if (workerIdsList.length === 0) return [];
      const client = getClient();
      const showOnListsTypes = await this.getShowOnListsIdTypes();
      if (showOnListsTypes.length === 0) return [];
      const typeIds = showOnListsTypes.map(t => t.id);
      const results = await client
        .select({
          workerId: workerIds.workerId,
          typeId: workerIds.typeId,
          value: workerIds.value,
        })
        .from(workerIds)
        .where(
          and(
            inArray(workerIds.typeId, typeIds),
            inArray(workerIds.workerId, workerIdsList)
          )
        );
      return results;
    },

    async getWorkerIdsByTypeForWorkerIds(typeId: string, workerIdsList: string[]): Promise<{ workerId: string; value: string }[]> {
      if (typeId === ALTERNATE_TAX_ID) return [];
      if (workerIdsList.length === 0) return [];
      const client = getClient();
      const results = await client
        .select({
          workerId: workerIds.workerId,
          value: workerIds.value,
        })
        .from(workerIds)
        .where(
          and(
            eq(workerIds.typeId, typeId),
            inArray(workerIds.workerId, workerIdsList)
          )
        );
      return results;
    }
  };
}

/**
 * Logging configuration for worker ID storage operations
 * 
 * Logs all worker ID mutations with full argument capture and change tracking.
 */
export const workerIdLoggingConfig: StorageLoggingConfig<WorkerIdStorage> = {
  module: 'workerIds',
  table: 'worker_ids',
  hostTable: 'workers',
  methods: {
    createWorkerId: {
      enabled: true,
      logArgs: args => [redactTaxIdRecord(args[0])],
      getEntityId: (args) => args[0]?.workerId || 'new worker ID',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId, // Worker ID is the host
      after: async (args, result, storage) => {
        return redactTaxIdRecord(result);
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = redactTaxIdRecord(workerId)?.value || 'unknown';
        
        return `Created ${typeName} with value "${value}"`;
      }
    },
    updateWorkerId: {
      enabled: true,
      logArgs: args => [args[0], { ...args[1], value: args[1]?.value === undefined ? undefined : "[REDACTED]" }],
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => result?.workerId || beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        const row = await storage.getWorkerId(args[0], true);
        return row && redactTaxIdRecord(row);
      },
      after: async (args, result, storage) => {
        return redactTaxIdRecord(result);
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const updates = args[1];
        const workerId = result;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the new value
        const newValue = workerId?.typeId === ALTERNATE_TAX_ID ? "[REDACTED]" : updates?.value || workerId?.value || 'unknown';
        
        return `Updated ${typeName} to "${newValue}"`;
      }
    },
    deleteWorkerId: {
      enabled: true,
      getEntityId: (args) => args[0], // Worker ID record ID
      getHostEntityId: (args, result, beforeState) => beforeState?.workerId, // Worker ID is the host
      before: async (args, storage) => {
        const row = await storage.getWorkerId(args[0], true);
        return row && redactTaxIdRecord(row);
      },
      getDescription: async (args, result, beforeState, afterState, storage) => {
        const client = getClient();
        const workerId = beforeState;
        
        // Get the type name directly from the database
        const typeId = workerId?.typeId;
        let typeName = 'Unknown type';
        if (typeId) {
          const [type] = await client.select().from(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, typeId));
          typeName = type?.name || 'Unknown type';
        }
        
        // Get the value
        const value = workerId?.value || 'unknown';
        
        return `Deleted ${typeName} with value "${value}"`;
      }
    }
  }
};
