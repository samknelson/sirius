import { getClient } from './transaction-context';
import { wizardEmploymentStatusMappings, type WizardEmploymentStatusMapping } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface WizardEmploymentStatusMappingStorage {
  getByEmployer(employerId: string): Promise<WizardEmploymentStatusMapping[]>;
  upsert(employerId: string, sourceStatus: string, targetStatusId: string): Promise<WizardEmploymentStatusMapping>;
  upsertBatch(employerId: string, mappings: Array<{ sourceStatus: string; targetStatusId: string }>): Promise<WizardEmploymentStatusMapping[]>;
  delete(id: string): Promise<boolean>;
  deleteByEmployerAndSource(employerId: string, sourceStatus: string): Promise<boolean>;
}

export function createWizardEmploymentStatusMappingStorage(): WizardEmploymentStatusMappingStorage {
  return {
    async getByEmployer(employerId: string): Promise<WizardEmploymentStatusMapping[]> {
      const client = getClient();
      return client
        .select()
        .from(wizardEmploymentStatusMappings)
        .where(eq(wizardEmploymentStatusMappings.employerId, employerId));
    },

    async upsert(employerId: string, sourceStatus: string, targetStatusId: string): Promise<WizardEmploymentStatusMapping> {
      const client = getClient();
      const [result] = await client
        .insert(wizardEmploymentStatusMappings)
        .values({ employerId, sourceStatus, targetStatusId })
        .onConflictDoUpdate({
          target: [wizardEmploymentStatusMappings.employerId, wizardEmploymentStatusMappings.sourceStatus],
          set: { targetStatusId, updatedAt: new Date() }
        })
        .returning();
      return result;
    },

    async upsertBatch(employerId: string, mappings: Array<{ sourceStatus: string; targetStatusId: string }>): Promise<WizardEmploymentStatusMapping[]> {
      const results: WizardEmploymentStatusMapping[] = [];
      for (const mapping of mappings) {
        const result = await this.upsert(employerId, mapping.sourceStatus, mapping.targetStatusId);
        results.push(result);
      }
      return results;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardEmploymentStatusMappings)
        .where(eq(wizardEmploymentStatusMappings.id, id))
        .returning();
      return result.length > 0;
    },

    async deleteByEmployerAndSource(employerId: string, sourceStatus: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardEmploymentStatusMappings)
        .where(
          and(
            eq(wizardEmploymentStatusMappings.employerId, employerId),
            eq(wizardEmploymentStatusMappings.sourceStatus, sourceStatus)
          )
        )
        .returning();
      return result.length > 0;
    },
  };
}
