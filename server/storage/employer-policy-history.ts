import { createNoopValidator } from './utils/validation';
import { getClient } from './transaction-context';
import {
  employerPolicyHistory,
  policies,
  type EmployerPolicyHistory,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertEmployerPolicyHistory, EmployerPolicyHistory>();

export interface EmployerPolicyHistoryStorage {
  getEmployerPolicyHistory(employerId: string): Promise<any[]>;
  createEmployerPolicyHistory(data: { employerId: string; date: string; policyId: string; data?: any }): Promise<EmployerPolicyHistory>;
  updateEmployerPolicyHistory(id: string, data: { date?: string; policyId?: string; data?: any }): Promise<EmployerPolicyHistory | undefined>;
  deleteEmployerPolicyHistory(id: string): Promise<boolean>;
}

export function createEmployerPolicyHistoryStorage(
  updateEmployerPolicy: (employerId: string, denormPolicyId: string | null) => Promise<any>
): EmployerPolicyHistoryStorage {
  async function syncEmployerCurrentPolicy(employerId: string): Promise<void> {
    const client = getClient();
    const [mostRecent] = await client
      .select()
      .from(employerPolicyHistory)
      .where(eq(employerPolicyHistory.employerId, employerId))
      .orderBy(desc(employerPolicyHistory.date), sql`${employerPolicyHistory.createdAt} DESC NULLS LAST`, desc(employerPolicyHistory.id))
      .limit(1);

    await updateEmployerPolicy(employerId, mostRecent?.policyId || null);
  }

  const storage: EmployerPolicyHistoryStorage = {
    async getEmployerPolicyHistory(employerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
        .select({
          id: employerPolicyHistory.id,
          date: employerPolicyHistory.date,
          employerId: employerPolicyHistory.employerId,
          policyId: employerPolicyHistory.policyId,
          data: employerPolicyHistory.data,
          createdAt: employerPolicyHistory.createdAt,
          policy: policies,
        })
        .from(employerPolicyHistory)
        .leftJoin(policies, eq(employerPolicyHistory.policyId, policies.id))
        .where(eq(employerPolicyHistory.employerId, employerId))
        .orderBy(desc(employerPolicyHistory.date));

      return results;
    },

    async createEmployerPolicyHistory(data: { employerId: string; date: string; policyId: string; data?: any }): Promise<EmployerPolicyHistory> {
      const client = getClient();
      const [created] = await client
        .insert(employerPolicyHistory)
        .values(data)
        .returning();
      
      await syncEmployerCurrentPolicy(data.employerId);
      
      return created;
    },

    async updateEmployerPolicyHistory(id: string, data: { date?: string; policyId?: string; data?: any }): Promise<EmployerPolicyHistory | undefined> {
      const client = getClient();
      const [updated] = await client
        .update(employerPolicyHistory)
        .set(data)
        .where(eq(employerPolicyHistory.id, id))
        .returning();
      
      if (updated) {
        await syncEmployerCurrentPolicy(updated.employerId);
      }
      
      return updated || undefined;
    },

    async deleteEmployerPolicyHistory(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(employerPolicyHistory)
        .where(eq(employerPolicyHistory.id, id))
        .returning();
      
      if (result.length > 0 && result[0].employerId) {
        await syncEmployerCurrentPolicy(result[0].employerId);
      }
      
      return result.length > 0;
    },
  };

  return storage;
}

export const employerPolicyHistoryLoggingConfig: StorageLoggingConfig<EmployerPolicyHistoryStorage> = {
  module: 'employer-policy-history',
  methods: {
    createEmployerPolicyHistory: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new policy history',
      getHostEntityId: (args) => args[0]?.employerId,
      getDescription: async (args, result, beforeState, afterState) => {
        const policyName = afterState?.policy?.name || 'Unknown';
        const date = result?.date || args[0]?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Created Policy History Entry [${policyName} ${formattedDate}]`;
      },
      after: async (args, result, storage) => {
        const client = getClient();
        const [policy] = await client.select().from(policies).where(eq(policies.id, result.policyId));
        return {
          policyHistory: result,
          policy: policy,
          metadata: {
            employerId: result.employerId,
            date: result.date,
            policyName: policy?.name || 'Unknown',
            note: `Policy history entry created: ${policy?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    updateEmployerPolicyHistory: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.policyHistory?.employerId) {
          return beforeState.policyHistory.employerId;
        }
        const client = getClient();
        const [entry] = await client.select().from(employerPolicyHistory).where(eq(employerPolicyHistory.id, args[0]));
        return entry?.employerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const oldPolicyName = beforeState?.policy?.name || 'Unknown';
        const newPolicyName = afterState?.policy?.name || 'Unknown';
        const date = result?.date || beforeState?.policyHistory?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Updated Policy History Entry [${oldPolicyName} → ${newPolicyName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [entry] = await client.select().from(employerPolicyHistory).where(eq(employerPolicyHistory.id, args[0]));
        if (!entry) {
          return null;
        }
        
        const [policy] = await client.select().from(policies).where(eq(policies.id, entry.policyId));
        return {
          policyHistory: entry,
          policy: policy,
          metadata: {
            employerId: entry.employerId,
            date: entry.date,
            policyName: policy?.name || 'Unknown'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        const client = getClient();
        const [policy] = await client.select().from(policies).where(eq(policies.id, result.policyId));
        return {
          policyHistory: result,
          policy: policy,
          metadata: {
            employerId: result.employerId,
            date: result.date,
            policyName: policy?.name || 'Unknown',
            note: `Policy history entry updated to: ${policy?.name || 'Unknown'} on ${result.date}`
          }
        };
      }
    },
    deleteEmployerPolicyHistory: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        if (beforeState?.policyHistory?.employerId) {
          return beforeState.policyHistory.employerId;
        }
        const client = getClient();
        const [entry] = await client.select().from(employerPolicyHistory).where(eq(employerPolicyHistory.id, args[0]));
        return entry?.employerId;
      },
      getDescription: async (args, result, beforeState, afterState) => {
        const policyName = beforeState?.policy?.name || 'Unknown';
        const date = beforeState?.policyHistory?.date || 'Unknown';
        let formattedDate = date;
        if (date !== 'Unknown' && typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const [year, month, day] = date.split('-');
          formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
        }
        return `Deleted Policy History Entry [${policyName} ${formattedDate}]`;
      },
      before: async (args, storage) => {
        const client = getClient();
        const [entry] = await client.select().from(employerPolicyHistory).where(eq(employerPolicyHistory.id, args[0]));
        if (!entry) {
          return null;
        }
        
        const [policy] = await client.select().from(policies).where(eq(policies.id, entry.policyId));
        return {
          policyHistory: entry,
          policy: policy,
          metadata: {
            employerId: entry.employerId,
            date: entry.date,
            policyName: policy?.name || 'Unknown',
            note: `Policy history entry deleted: ${policy?.name || 'Unknown'} on ${entry.date}`
          }
        };
      }
    }
  }
};
