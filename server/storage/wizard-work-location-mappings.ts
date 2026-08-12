import { getClient } from './transaction-context';
import { wizardWorkLocationMappings, type WizardWorkLocationMapping } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/**
 * Persistent per-employer mappings from an uploaded file's "Work Location
 * Name" to a target employer. Mirrors wizard-employment-status-mappings:
 * scoped to the LAUNCH employer so a single upload stream covering multiple
 * locations (or separate per-location files) resolves consistently on every
 * re-run.
 */
export interface WizardWorkLocationMappingStorage {
  getByEmployer(employerId: string): Promise<WizardWorkLocationMapping[]>;
  upsert(employerId: string, sourceLocation: string, targetEmployerId: string): Promise<WizardWorkLocationMapping>;
  upsertBatch(employerId: string, mappings: Array<{ sourceLocation: string; targetEmployerId: string }>): Promise<WizardWorkLocationMapping[]>;
  delete(id: string): Promise<boolean>;
  deleteByEmployerAndSource(employerId: string, sourceLocation: string): Promise<boolean>;
}

export function createWizardWorkLocationMappingStorage(): WizardWorkLocationMappingStorage {
  return {
    async getByEmployer(employerId: string): Promise<WizardWorkLocationMapping[]> {
      const client = getClient();
      return client
        .select()
        .from(wizardWorkLocationMappings)
        .where(eq(wizardWorkLocationMappings.employerId, employerId));
    },

    async upsert(employerId: string, sourceLocation: string, targetEmployerId: string): Promise<WizardWorkLocationMapping> {
      const client = getClient();
      const [result] = await client
        .insert(wizardWorkLocationMappings)
        .values({ employerId, sourceLocation, targetEmployerId })
        .onConflictDoUpdate({
          target: [wizardWorkLocationMappings.employerId, wizardWorkLocationMappings.sourceLocation],
          set: { targetEmployerId, updatedAt: new Date() }
        })
        .returning();
      return result;
    },

    async upsertBatch(employerId: string, mappings: Array<{ sourceLocation: string; targetEmployerId: string }>): Promise<WizardWorkLocationMapping[]> {
      const results: WizardWorkLocationMapping[] = [];
      for (const mapping of mappings) {
        const result = await this.upsert(employerId, mapping.sourceLocation, mapping.targetEmployerId);
        results.push(result);
      }
      return results;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardWorkLocationMappings)
        .where(eq(wizardWorkLocationMappings.id, id))
        .returning();
      return result.length > 0;
    },

    async deleteByEmployerAndSource(employerId: string, sourceLocation: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(wizardWorkLocationMappings)
        .where(
          and(
            eq(wizardWorkLocationMappings.employerId, employerId),
            eq(wizardWorkLocationMappings.sourceLocation, sourceLocation),
          ),
        )
        .returning();
      return result.length > 0;
    },
  };
}
