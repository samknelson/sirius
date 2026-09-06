import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import {
  employerPolicyHistory,
  entityMetadata,
  policies,
  users,
  type EmployerPolicyHistory,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";
import { parseYmdParts } from '@shared/utils/date';
import { sortPolicyHistoryEntries } from './policy-history-order';

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<{ employerId: string; date: string; policyId: string; data?: any }, EmployerPolicyHistory>();

/** The raw table these entries live in, as provenance rows name it. */
const TABLE_NAME = 'employer_policy_history';

/**
 * Join condition for an entry's provenance row.
 *
 * `entity_id` is unique across the whole table, but the table name is matched
 * too: a row naming a different table would be provenance for someone else's
 * record, and this join must produce nothing rather than the wrong answer.
 */
const provenanceJoin = and(
  eq(entityMetadata.entityId, employerPolicyHistory.id),
  eq(entityMetadata.contextId, TABLE_NAME),
);
/**
 * Display name of the person a provenance row names: "First Last", falling
 * back to whichever half exists, then the email, then nobody.
 */
function personNameFrom(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
): string | null {
  const full = [firstName, lastName].filter((part) => part && part.trim() !== "").join(" ");
  if (full) return full;
  return email ?? null;
}

export interface EmployerPolicyHistoryStorage {
  getEmployerPolicyHistory(employerId: string): Promise<any[]>;
  createEmployerPolicyHistory(data: { employerId: string; date: string; policyId: string; data?: any }): Promise<EmployerPolicyHistory>;
  updateEmployerPolicyHistory(id: string, data: { date?: string; policyId?: string; data?: any }): Promise<EmployerPolicyHistory | undefined>;
  deleteEmployerPolicyHistory(id: string): Promise<boolean>;
}

export function createEmployerPolicyHistoryStorage(
  updateEmployerPolicy: (employerId: string, denormPolicyId: string | null) => Promise<any>
): EmployerPolicyHistoryStorage {
  /**
   * Denormalize the employer's current policy: the first entry in the order
   * the history page shows.
   *
   * `justCreatedId` names an entry inserted by the caller's own transaction,
   * whose provenance cannot exist yet — see `comparePolicyHistoryEntries`,
   * which is the one place that order is decided, so that what is written here
   * and what the page displays cannot part company. Every entry is fetched
   * rather than the top one, because the order is decided in memory; an
   * employer's policy history is a handful of rows.
   */
  async function syncEmployerCurrentPolicy(
    employerId: string,
    justCreatedId?: string,
  ): Promise<void> {
    const client = getClient();
    const entries = await client
      .select({
        id: employerPolicyHistory.id,
        date: employerPolicyHistory.date,
        policyId: employerPolicyHistory.policyId,
        recordedAt: entityMetadata.createdDate,
      })
      .from(employerPolicyHistory)
      .leftJoin(entityMetadata, provenanceJoin)
      .where(eq(employerPolicyHistory.employerId, employerId));

    const [mostRecent] = sortPolicyHistoryEntries(entries, justCreatedId);

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
          policy: policies,
          // When the entry was recorded, and by whom — the record's own
          // history, which is where this lives now that the table has no
          // `created_at` of its own. Null for an entry whose provenance row
          // has not landed (or was lost): the page says so rather than
          // showing a date nobody stands behind.
          recordedAt: entityMetadata.createdDate,
          recordedByFirstName: users.firstName,
          recordedByLastName: users.lastName,
          recordedByEmail: users.email,
        })
        .from(employerPolicyHistory)
        .leftJoin(policies, eq(employerPolicyHistory.policyId, policies.id))
        .leftJoin(entityMetadata, provenanceJoin)
        .leftJoin(users, eq(users.id, entityMetadata.createdBy))
        .where(eq(employerPolicyHistory.employerId, employerId));

      return sortPolicyHistoryEntries(results).map(
        ({ recordedByFirstName, recordedByLastName, recordedByEmail, ...entry }) => ({
          ...entry,
          recordedByName: personNameFrom(recordedByFirstName, recordedByLastName, recordedByEmail),
        }),
      );
    },

    async createEmployerPolicyHistory(data: { employerId: string; date: string; policyId: string; data?: any }): Promise<EmployerPolicyHistory> {
      validate.validateOrThrow(data);
      const client = getClient();
      const [created] = await client
        .insert(employerPolicyHistory)
        .values(data)
        .returning();
      
      // The entry that was just written is named to the sync: it is the newest
      // there is, but its provenance is not written until this transaction
      // commits, so nothing in the database says so yet.
      await syncEmployerCurrentPolicy(data.employerId, created.id);
      
      return created;
    },

    async updateEmployerPolicyHistory(id: string, data: { date?: string; policyId?: string; data?: any }): Promise<EmployerPolicyHistory | undefined> {
      validate.validateOrThrow(data);
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
  table: 'employer_policy_history',
  hostTable: 'employers',
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
          const { year, month, day } = parseYmdParts(date);
          formattedDate = `${month}/${day}/${year}`;
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
          const { year, month, day } = parseYmdParts(date);
          formattedDate = `${month}/${day}/${year}`;
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
          const { year, month, day } = parseYmdParts(date);
          formattedDate = `${month}/${day}/${year}`;
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
