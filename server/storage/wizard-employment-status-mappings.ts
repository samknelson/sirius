import { getClient } from './transaction-context';
import { wizardEmploymentStatusMappings, type WizardEmploymentStatusMapping } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { defineLoggingConfig } from "./middleware/logging";

export interface WizardEmploymentStatusMappingStorage {
  getByEmployer(employerId: string): Promise<WizardEmploymentStatusMapping[]>;
  upsert(employerId: string, sourceStatus: string, targetStatusId: string): Promise<WizardEmploymentStatusMapping>;
  delete(id: string): Promise<boolean>;
  deleteByEmployerAndSource(employerId: string, sourceStatus: string): Promise<boolean>;
}

/**
 * Which of an employer's own employment statuses means which of ours is
 * operator-editable configuration, so who changed a mapping is worth
 * recording. The table joined the storage logging framework when its own
 * `created_at` / `updated_at` columns were retired: `entity_metadata` holds
 * when a mapping was last changed and by whom, and the log entries are what
 * the admin log viewer shows.
 *
 * The mapping has no page of its own — it is reached through its employer,
 * which is therefore named as the host so the change reads there.
 *
 * `upsert` counts as a modification whether it inserted or updated. That is
 * the framework's default for an upsert (and what `sitespecific_btu_political`
 * already does): the config cannot tell the two apart ahead of the call, so a
 * mapping created this way carries a creation DATE but no creator, which is
 * the framework's honest "met it mid-life" state rather than a guess.
 */
export const wizardEmploymentStatusMappingLoggingConfig =
  defineLoggingConfig<WizardEmploymentStatusMappingStorage>({
    module: 'wizardEmploymentStatusMappings',
    table: 'wizard_employment_status_mappings',
    hostTable: 'employers',
    methods: {
      upsert: {
        getEntityId: (_args, result) => result?.id,
        getHostEntityId: (args) => args[0],
        getDescription: async (args, result) =>
          `Mapped employment status "${args[1]}" to ${result?.targetStatusId ?? args[2]}`,
        after: async (_args, result) => result,
      },
      delete: {
        getHostEntityId: (_args, _result, beforeState) => beforeState?.employerId,
        before: async (args) => {
          const client = getClient();
          const [row] = await client
            .select()
            .from(wizardEmploymentStatusMappings)
            .where(eq(wizardEmploymentStatusMappings.id, args[0]));
          return row ?? null;
        },
        getDescription: async (_args, _result, beforeState) =>
          `Removed employment status mapping for "${beforeState?.sourceStatus ?? 'unknown'}"`,
      },
      deleteByEmployerAndSource: {
        // The log entry names the employer whose mapping went, because that is
        // what the caller asked for; provenance is filed under the row's own
        // id, read from the state captured before the delete.
        getEntityId: (args) => args[0],
        metadataEntityId: (_args, _result, beforeState) => beforeState?.id,
        getHostEntityId: (args) => args[0],
        before: async (args) => {
          const client = getClient();
          const [row] = await client
            .select()
            .from(wizardEmploymentStatusMappings)
            .where(
              and(
                eq(wizardEmploymentStatusMappings.employerId, args[0]),
                eq(wizardEmploymentStatusMappings.sourceStatus, args[1]),
              ),
            );
          return row ?? null;
        },
        getDescription: async (args) =>
          `Removed employment status mapping for "${args[1]}"`,
      },
    },
  });

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
          set: { targetStatusId }
        })
        .returning();
      return result;
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
