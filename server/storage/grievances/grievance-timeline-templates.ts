import { getClient, runInTransaction } from "../transaction-context";
import {
  grievanceTimelineTemplates,
  grievanceTimelineTemplateSteps,
  optionsGrievanceSteps,
  optionsGrievanceStatus,
  type GrievanceTimelineTemplate,
  type InsertGrievanceTimelineTemplate,
  type GrievanceTimelineTemplateStep,
  type InsertGrievanceTimelineTemplateStep,
} from "@shared/schema";
import { eq, and, ne, inArray, asc, sql } from "drizzle-orm";
import { type StorageLoggingConfig } from "../middleware/logging";

export interface GrievanceTimelineTemplateStepWithDetails
  extends GrievanceTimelineTemplateStep {
  stepName: string | null;
  stepActor: string | null;
}

export interface GrievanceTimelineTemplateWithSteps
  extends GrievanceTimelineTemplate {
  steps: GrievanceTimelineTemplateStepWithDetails[];
}

export interface GrievanceTimelineTemplateStorage {
  list(): Promise<GrievanceTimelineTemplate[]>;
  get(id: string): Promise<GrievanceTimelineTemplate | undefined>;
  getWithSteps(
    id: string,
  ): Promise<GrievanceTimelineTemplateWithSteps | undefined>;
  create(
    data: InsertGrievanceTimelineTemplate,
  ): Promise<GrievanceTimelineTemplate>;
  update(
    id: string,
    data: Partial<InsertGrievanceTimelineTemplate>,
  ): Promise<GrievanceTimelineTemplate | undefined>;
  delete(id: string): Promise<boolean>;
  listSteps(
    templateId: string,
  ): Promise<GrievanceTimelineTemplateStepWithDetails[]>;
  getStep(
    templateId: string,
    stepRowId: string,
  ): Promise<GrievanceTimelineTemplateStep | undefined>;
  createStep(
    data: InsertGrievanceTimelineTemplateStep,
  ): Promise<GrievanceTimelineTemplateStep>;
  updateStep(
    templateId: string,
    stepRowId: string,
    data: Partial<InsertGrievanceTimelineTemplateStep>,
  ): Promise<GrievanceTimelineTemplateStep | undefined>;
  deleteStep(templateId: string, stepRowId: string): Promise<boolean>;
  /** Whether every supplied status option id currently exists. */
  statusesExist(ids: string[]): Promise<boolean>;
  /** Whether the supplied grievance step definition id currently exists. */
  stepExists(stepId: string): Promise<boolean>;
  /** Whether any template step references the given status option id. */
  isStatusReferenced(statusId: string): Promise<boolean>;
  getLogLabel(id: string): Promise<string | undefined>;
}

export function createGrievanceTimelineTemplateStorage(): GrievanceTimelineTemplateStorage {
  return {
    async list(): Promise<GrievanceTimelineTemplate[]> {
      const client = getClient();
      return client
        .select()
        .from(grievanceTimelineTemplates)
        .orderBy(asc(grievanceTimelineTemplates.title));
    },

    async get(id: string): Promise<GrievanceTimelineTemplate | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceTimelineTemplates)
        .where(eq(grievanceTimelineTemplates.id, id));
      return row || undefined;
    },

    async getWithSteps(
      id: string,
    ): Promise<GrievanceTimelineTemplateWithSteps | undefined> {
      const template = await this.get(id);
      if (!template) return undefined;
      const steps = await this.listSteps(id);
      return { ...template, steps };
    },

    async create(
      data: InsertGrievanceTimelineTemplate,
    ): Promise<GrievanceTimelineTemplate> {
      const client = getClient();
      const [row] = await client
        .insert(grievanceTimelineTemplates)
        .values(data)
        .returning();
      return row;
    },

    async update(
      id: string,
      data: Partial<InsertGrievanceTimelineTemplate>,
    ): Promise<GrievanceTimelineTemplate | undefined> {
      const client = getClient();
      const [row] = await client
        .update(grievanceTimelineTemplates)
        .set(data)
        .where(eq(grievanceTimelineTemplates.id, id))
        .returning();
      return row || undefined;
    },

    async delete(id: string): Promise<boolean> {
      // Step rows are removed automatically by the ON DELETE CASCADE FK.
      const client = getClient();
      const result = await client
        .delete(grievanceTimelineTemplates)
        .where(eq(grievanceTimelineTemplates.id, id))
        .returning();
      return result.length > 0;
    },

    async listSteps(
      templateId: string,
    ): Promise<GrievanceTimelineTemplateStepWithDetails[]> {
      const client = getClient();
      return client
        .select({
          id: grievanceTimelineTemplateSteps.id,
          templateId: grievanceTimelineTemplateSteps.templateId,
          fromStatuses: grievanceTimelineTemplateSteps.fromStatuses,
          toStatuses: grievanceTimelineTemplateSteps.toStatuses,
          stepId: grievanceTimelineTemplateSteps.stepId,
          days: grievanceTimelineTemplateSteps.days,
          dayType: grievanceTimelineTemplateSteps.dayType,
          sequence: grievanceTimelineTemplateSteps.sequence,
          stepName: optionsGrievanceSteps.name,
          stepActor: optionsGrievanceSteps.actor,
        })
        .from(grievanceTimelineTemplateSteps)
        .leftJoin(
          optionsGrievanceSteps,
          eq(grievanceTimelineTemplateSteps.stepId, optionsGrievanceSteps.id),
        )
        .where(eq(grievanceTimelineTemplateSteps.templateId, templateId))
        .orderBy(
          asc(grievanceTimelineTemplateSteps.sequence),
          asc(grievanceTimelineTemplateSteps.id),
        );
    },

    async getStep(
      templateId: string,
      stepRowId: string,
    ): Promise<GrievanceTimelineTemplateStep | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(grievanceTimelineTemplateSteps)
        .where(
          and(
            eq(grievanceTimelineTemplateSteps.id, stepRowId),
            eq(grievanceTimelineTemplateSteps.templateId, templateId),
          ),
        );
      return row || undefined;
    },

    async createStep(
      data: InsertGrievanceTimelineTemplateStep,
    ): Promise<GrievanceTimelineTemplateStep> {
      const client = getClient();
      // New steps append to the end of the template unless an explicit
      // sequence is supplied, mirroring the unified-options sequencing model.
      let sequence = data.sequence;
      if (sequence === undefined || sequence === null) {
        const [maxRow] = await client
          .select({
            max: sql<number>`COALESCE(MAX(${grievanceTimelineTemplateSteps.sequence}), -1)`,
          })
          .from(grievanceTimelineTemplateSteps)
          .where(eq(grievanceTimelineTemplateSteps.templateId, data.templateId));
        sequence = Number(maxRow?.max ?? -1) + 1;
      }
      const [row] = await client
        .insert(grievanceTimelineTemplateSteps)
        .values({ ...data, sequence })
        .returning();
      return row;
    },

    async updateStep(
      templateId: string,
      stepRowId: string,
      data: Partial<InsertGrievanceTimelineTemplateStep>,
    ): Promise<GrievanceTimelineTemplateStep | undefined> {
      // When the sequence changes, swap it atomically with whatever step
      // currently holds the target sequence. Doing both writes in one
      // transaction means a single PATCH can reorder Up/Down (no dedicated
      // reorder route) without ever leaving two steps sharing a sequence.
      if (data.sequence !== undefined && data.sequence !== null) {
        const targetSequence = data.sequence;
        return runInTransaction(async () => {
          const client = getClient();
          const [existing] = await client
            .select()
            .from(grievanceTimelineTemplateSteps)
            .where(
              and(
                eq(grievanceTimelineTemplateSteps.id, stepRowId),
                eq(grievanceTimelineTemplateSteps.templateId, templateId),
              ),
            );
          if (!existing) return undefined;
          if (existing.sequence !== targetSequence) {
            // Hand exactly one conflicting step this row's old sequence (the
            // swap counterpart). Picking a single id keeps the swap a true
            // 1-for-1 even if legacy data left several rows on targetSequence.
            const [conflict] = await client
              .select({ id: grievanceTimelineTemplateSteps.id })
              .from(grievanceTimelineTemplateSteps)
              .where(
                and(
                  eq(grievanceTimelineTemplateSteps.templateId, templateId),
                  eq(grievanceTimelineTemplateSteps.sequence, targetSequence),
                  ne(grievanceTimelineTemplateSteps.id, stepRowId),
                ),
              )
              .orderBy(asc(grievanceTimelineTemplateSteps.id))
              .limit(1);
            if (conflict) {
              await client
                .update(grievanceTimelineTemplateSteps)
                .set({ sequence: existing.sequence })
                .where(eq(grievanceTimelineTemplateSteps.id, conflict.id));
            }
          }
          const [row] = await client
            .update(grievanceTimelineTemplateSteps)
            .set(data)
            .where(
              and(
                eq(grievanceTimelineTemplateSteps.id, stepRowId),
                eq(grievanceTimelineTemplateSteps.templateId, templateId),
              ),
            )
            .returning();
          return row || undefined;
        });
      }

      const client = getClient();
      const [row] = await client
        .update(grievanceTimelineTemplateSteps)
        .set(data)
        .where(
          and(
            eq(grievanceTimelineTemplateSteps.id, stepRowId),
            eq(grievanceTimelineTemplateSteps.templateId, templateId),
          ),
        )
        .returning();
      return row || undefined;
    },

    async deleteStep(templateId: string, stepRowId: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(grievanceTimelineTemplateSteps)
        .where(
          and(
            eq(grievanceTimelineTemplateSteps.id, stepRowId),
            eq(grievanceTimelineTemplateSteps.templateId, templateId),
          ),
        )
        .returning();
      return result.length > 0;
    },

    async statusesExist(ids: string[]): Promise<boolean> {
      if (ids.length === 0) return true;
      const client = getClient();
      const unique = Array.from(new Set(ids));
      const rows = await client
        .select({ id: optionsGrievanceStatus.id })
        .from(optionsGrievanceStatus)
        .where(inArray(optionsGrievanceStatus.id, unique));
      return rows.length === unique.length;
    },

    async stepExists(stepId: string): Promise<boolean> {
      const client = getClient();
      const [row] = await client
        .select({ id: optionsGrievanceSteps.id })
        .from(optionsGrievanceSteps)
        .where(eq(optionsGrievanceSteps.id, stepId));
      return !!row;
    },

    async isStatusReferenced(statusId: string): Promise<boolean> {
      const client = getClient();
      // Scalar = ANY(arrayColumn) is the safe form (a JS array on the right
      // side of ANY throws); here the column is the real array and statusId is
      // the scalar being searched for.
      const rows = await client
        .select({ id: grievanceTimelineTemplateSteps.id })
        .from(grievanceTimelineTemplateSteps)
        .where(
          sql`${statusId} = ANY(${grievanceTimelineTemplateSteps.fromStatuses}) OR ${statusId} = ANY(${grievanceTimelineTemplateSteps.toStatuses})`,
        )
        .limit(1);
      return rows.length > 0;
    },

    async getLogLabel(id: string): Promise<string | undefined> {
      const client = getClient();
      const [row] = await client
        .select({ title: grievanceTimelineTemplates.title })
        .from(grievanceTimelineTemplates)
        .where(eq(grievanceTimelineTemplates.id, id));
      if (!row) return undefined;
      return row.title
        ? `timeline template "${row.title}"`
        : `timeline template ${id.slice(0, 8)}`;
    },
  };
}

async function describeTemplate(
  storage: GrievanceTimelineTemplateStorage,
  id: string,
): Promise<string> {
  const label = await storage.getLogLabel(id);
  return label ?? `timeline template ${id.slice(0, 8)}`;
}

/**
 * Logging configuration for grievance timeline template storage operations.
 *
 * Step mutations set the host entity to the parent template id so they surface
 * in the template's Logs tab.
 */
export const grievanceTimelineTemplateLoggingConfig: StorageLoggingConfig<GrievanceTimelineTemplateStorage> =
  {
    module: "grievanceTimelineTemplates",
    methods: {
      create: {
        enabled: true,
        getEntityId: (_args, result) => result?.id,
        getHostEntityId: (_args, result) => result?.id,
        after: async (_args, result) => result,
        getDescription: async (_args, result, _b, _a, storage) => {
          if (!result?.id) return "Created timeline template";
          return `Created ${await describeTemplate(storage, result.id)}`;
        },
      },
      update: {
        enabled: true,
        getEntityId: (args) => args[0],
        getHostEntityId: (args) => args[0],
        before: async (args, storage) => storage.get(args[0]),
        after: async (args, result) => result,
        getDescription: async (args, _result, _b, _a, storage) =>
          `Updated ${await describeTemplate(storage, args[0])}`,
      },
      delete: {
        enabled: true,
        getEntityId: (args) => args[0],
        getHostEntityId: (args) => args[0],
        before: async (args, storage) => storage.get(args[0]),
        getDescription: async (args) => {
          const id = args[0] as string;
          return `Deleted timeline template ${typeof id === "string" ? id.slice(0, 8) : id}`;
        },
      },
      createStep: {
        enabled: true,
        getEntityId: (_args, result) => result?.id,
        getHostEntityId: (_args, result) => result?.templateId,
        after: async (_args, result) => result,
        getDescription: async () => `Added step to timeline template`,
      },
      updateStep: {
        enabled: true,
        getEntityId: (args) => args[1],
        getHostEntityId: (args) => args[0],
        after: async (args, result) => result,
        getDescription: async () => `Updated step on timeline template`,
      },
      deleteStep: {
        enabled: true,
        getEntityId: (args) => args[1],
        getHostEntityId: (args) => args[0],
        getDescription: async () => `Removed step from timeline template`,
      },
    },
  };
