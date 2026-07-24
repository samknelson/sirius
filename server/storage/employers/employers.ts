import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { employers, type Employer, type InsertEmployer } from "@shared/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { defineLoggingConfig, type StorageLoggingConfig } from "../middleware/logging";
import { eventBus, EventType } from "../../services/event-bus";
import { storageLogger as logger } from "../../logger";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator<InsertEmployer, Employer>();

export interface EmployerWorker {
  workerId: string;
  workerSiriusId: number | null;
  contactName: string | null;
  employmentHistoryId: string | null;
  employmentStatusId: string | null;
  employmentStatusName: string | null;
  position: string | null;
  date: string | null;
  home: boolean | null;
}

export interface EmployerStorage {
  getAllEmployers(): Promise<Employer[]>;
  /** Every employer whose `is_active` flag is true. */
  listActive(): Promise<Employer[]>;
  getEmployer(id: string): Promise<Employer | undefined>;
  getBySiriusId(siriusId: string): Promise<Employer | undefined>;
  getByIds(ids: string[]): Promise<Employer[]>;
  getEmployerWorkers(employerId: string): Promise<EmployerWorker[]>;
  createEmployer(employer: InsertEmployer): Promise<Employer>;
  updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined>;
  updateEmployerPolicy(employerId: string, denormPolicyId: string | null): Promise<Employer | undefined>;
  deleteEmployer(id: string): Promise<boolean>;
}

export function createEmployerStorage(): EmployerStorage {
  return {
    async getAllEmployers(): Promise<Employer[]> {
      const client = getClient();
      return await client.select().from(employers);
    },

    async listActive(): Promise<Employer[]> {
      const client = getClient();
      return await client.select().from(employers).where(eq(employers.isActive, true));
    },

    async getEmployer(id: string): Promise<Employer | undefined> {
      const client = getClient();
      const [employer] = await client.select().from(employers).where(eq(employers.id, id));
      return employer || undefined;
    },

    async getBySiriusId(siriusId: string): Promise<Employer | undefined> {
      const client = getClient();
      const [employer] = await client.select().from(employers).where(eq(employers.siriusId, siriusId));
      return employer || undefined;
    },

    async getByIds(ids: string[]): Promise<Employer[]> {
      if (ids.length === 0) return [];
      const client = getClient();
      return await client.select().from(employers).where(inArray(employers.id, ids));
    },

    async getEmployerWorkers(employerId: string): Promise<EmployerWorker[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT DISTINCT ON (w.id)
          w.id as "workerId",
          w.sirius_id as "workerSiriusId",
          c.display_name as "contactName",
          wh.id as "employmentHistoryId",
          wh.employment_status_id as "employmentStatusId",
          es.name as "employmentStatusName",
          NULL as position,
          make_date(wh.year, wh.month, wh.day)::text as date,
          wh.home
        FROM workers w
        INNER JOIN worker_hours wh ON w.id = wh.worker_id
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN options_employment_status es ON wh.employment_status_id = es.id
        WHERE wh.employer_id = ${employerId}
        ORDER BY w.id, wh.year DESC, wh.month DESC, wh.day DESC
      `);
      
      return result.rows as unknown as EmployerWorker[];
    },

    async createEmployer(employer: InsertEmployer): Promise<Employer> {
      validate.validateOrThrow(employer);
      const client = getClient();
      try {
        const [newEmployer] = await client
          .insert(employers)
          .values(employer)
          .returning();
        return newEmployer;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async updateEmployer(id: string, employer: Partial<InsertEmployer>): Promise<Employer | undefined> {
      validate.validateOrThrow(employer);
      const client = getClient();
      try {
        // Pre-state for industry-change detection: only read it when the
        // patch actually carries an industry assignment.
        let previousIndustryId: string | null = null;
        const industryTouched = Object.prototype.hasOwnProperty.call(employer, "industryId");
        if (industryTouched) {
          const [before] = await client
            .select({ industryId: employers.industryId })
            .from(employers)
            .where(eq(employers.id, id));
          previousIndustryId = before?.industryId ?? null;
        }
        const [updatedEmployer] = await client
          .update(employers)
          .set(employer)
          .where(eq(employers.id, id))
          .returning();
        if (updatedEmployer && industryTouched) {
          const newIndustryId = updatedEmployer.industryId ?? null;
          if (newIndustryId !== previousIndustryId) {
            // BAO thresholds resolve through the employer's industry, so an
            // industry change silently shifts eligibility math for every
            // worker at this employer. Fire-and-forget; listeners defer
            // their side effects to after commit.
            eventBus.emit(EventType.EMPLOYER_INDUSTRY_SAVED, {
              employerId: updatedEmployer.id,
              previousIndustryId,
              newIndustryId,
            }).catch(err => {
              logger.error("Failed to emit EMPLOYER_INDUSTRY_SAVED event", {
                service: "employer-storage",
                employerId: updatedEmployer.id,
                error: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
        return updatedEmployer || undefined;
      } catch (error: any) {
        if (error.code === '23505') {
          throw new Error("An employer with this ID already exists");
        }
        throw error;
      }
    },

    async updateEmployerPolicy(employerId: string, denormPolicyId: string | null): Promise<Employer | undefined> {
      const client = getClient();
      const [updatedEmployer] = await client
        .update(employers)
        .set({ denormPolicyId })
        .where(eq(employers.id, employerId))
        .returning();
      
      return updatedEmployer || undefined;
    },

    async deleteEmployer(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(employers).where(eq(employers.id, id)).returning();
      return result.length > 0;
    }
  };
}

export const employerLoggingConfig = defineLoggingConfig<EmployerStorage>({
  module: 'employers',
  getter: 'getEmployer',
  hostEntityId: (args, result, before) => result?.id ?? before?.id ?? args[0],
  methods: {
    createEmployer: { getEntityId: (args, result) => result?.id || args[0]?.name || 'new employer' },
    updateEmployer: {},
    deleteEmployer: {},
  },
});
