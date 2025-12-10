import { db } from "../db";
import {
  workers,
  contacts,
  trustWmb,
  trustBenefits,
  employers,
  optionsWorkerWs,
  type Worker,
  type InsertWorker,
  type TrustWmb,
  type TrustBenefit,
  type Employer,
} from "@shared/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import type { ContactsStorage } from "./contacts";
import { type StorageLoggingConfig } from "./middleware/logging";
import { logger } from "../logger";

export interface WorkerEmployerSummary {
  workerId: string;
  employers: Array<{ id: string; name: string; isHome: boolean }>;
}

export interface WorkerCurrentBenefits {
  workerId: string;
  benefits: Array<{ id: string; name: string; typeName: string | null; typeIcon: string | null; employerName: string | null }>;
}

export interface WorkerWithDetails {
  id: string;
  sirius_id: number | null;
  contact_id: string;
  ssn: string | null;
  denorm_ws_id: string | null;
  denorm_home_employer_id: string | null;
  denorm_employer_ids: string[] | null;
  contact_name: string | null;
  contact_email: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  phone_number: string | null;
  is_primary: boolean | null;
  address_id: string | null;
  address_friendly_name: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  work_status_name: string | null;
  address_country: string | null;
  address_is_primary: boolean | null;
  benefit_types: string[] | null;
  benefit_ids: string[] | null;
  benefits: Array<{ id: string; name: string; typeName: string; typeIcon: string | null }> | null;
}

export interface WorkerStorage {
  getAllWorkers(): Promise<Worker[]>;
  getWorkersWithDetails(): Promise<WorkerWithDetails[]>;
  getWorkersEmployersSummary(): Promise<WorkerEmployerSummary[]>;
  getWorkersCurrentBenefits(month?: number, year?: number): Promise<WorkerCurrentBenefits[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  getWorkerBySSN(ssn: string): Promise<Worker | undefined>;
  createWorker(name: string): Promise<Worker>;
  // Update methods that delegate to contact storage (contact storage already has logging)
  updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined>;
  updateWorkerContactNameComponents(workerId: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<Worker | undefined>;
  updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined>;
  updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined>;
  updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined>;
  updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined>;
  updateWorkerStatus(workerId: string, denormWsId: string | null): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
  // Worker benefits methods
  getWorkerBenefits(workerId: string): Promise<any[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean>;
}

export function createWorkerStorage(contactsStorage: ContactsStorage): WorkerStorage {
  const storage = {
    async getAllWorkers(): Promise<Worker[]> {
      return await db.select().from(workers);
    },

    async getWorkersWithDetails(): Promise<WorkerWithDetails[]> {
      const result = await db.execute(sql`
        SELECT 
          w.id,
          w.sirius_id,
          w.contact_id,
          w.ssn,
          w.denorm_ws_id,
          w.denorm_home_employer_id,
          w.denorm_employer_ids,
          c.display_name as contact_name,
          c.email as contact_email,
          c.given,
          c.middle,
          c.family,
          p.phone_number,
          p.is_primary,
          a.id as address_id,
          a.friendly_name as address_friendly_name,
          a.street as address_street,
          a.city as address_city,
          a.state as address_state,
          a.postal_code as address_postal_code,
          a.country as address_country,
          a.is_primary as address_is_primary,
          ws.name as work_status_name,
          COALESCE(
            (
              SELECT json_agg(DISTINCT bt.name)
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              INNER JOIN options_trust_benefit_type bt ON tb.benefit_type = bt.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefit_types,
          COALESCE(
            (
              SELECT json_agg(DISTINCT wmb.benefit_id)
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefit_ids,
          COALESCE(
            (
              SELECT json_agg(DISTINCT jsonb_build_object(
                'id', tb.id,
                'name', tb.name,
                'typeName', bt.name,
                'typeIcon', bt.data->>'icon'
              ))
              FROM trust_wmb wmb
              INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
              INNER JOIN options_trust_benefit_type bt ON tb.benefit_type = bt.id
              WHERE wmb.worker_id = w.id
                AND tb.is_active = true
            ),
            '[]'::json
          ) as benefits
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN options_worker_ws ws ON w.denorm_ws_id = ws.id
        LEFT JOIN LATERAL (
          SELECT phone_number, is_primary
          FROM contact_phone
          WHERE contact_id = c.id
          ORDER BY is_primary DESC NULLS LAST, created_at ASC
          LIMIT 1
        ) p ON true
        LEFT JOIN LATERAL (
          SELECT id, friendly_name, street, city, state, postal_code, country, is_primary
          FROM contact_postal
          WHERE contact_id = c.id AND is_active = true
          ORDER BY is_primary DESC NULLS LAST, created_at ASC
          LIMIT 1
        ) a ON true
        ORDER BY c.family, c.given
      `);
      
      return result.rows as unknown as WorkerWithDetails[];
    },

    async getWorkersEmployersSummary(): Promise<WorkerEmployerSummary[]> {
      const result = await db.execute(sql`
        SELECT 
          w.id as worker_id,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', e.id,
                'name', e.name,
                'isHome', COALESCE(wh.home, false)
              )
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'::json
          ) as employers
        FROM workers w
        LEFT JOIN worker_hours wh ON w.id = wh.worker_id
        LEFT JOIN employers e ON wh.employer_id = e.id
        GROUP BY w.id
      `);
      
      return result.rows.map((row: any) => ({
        workerId: row.worker_id,
        employers: row.employers || []
      }));
    },

    async getWorkersCurrentBenefits(month?: number, year?: number): Promise<WorkerCurrentBenefits[]> {
      const now = new Date();
      const currentMonth = month ?? (now.getMonth() + 1);
      const currentYear = year ?? now.getFullYear();

      const result = await db.execute(sql`
        SELECT 
          w.id as worker_id,
          COALESCE(
            (
              SELECT json_agg(benefit_data)
              FROM (
                SELECT DISTINCT ON (tb.id, e.id)
                  jsonb_build_object(
                    'id', tb.id,
                    'name', tb.name,
                    'typeName', tbt.name,
                    'typeIcon', tbt.data->>'icon',
                    'employerName', e.name
                  ) as benefit_data
                FROM trust_wmb wmb
                INNER JOIN trust_benefits tb ON wmb.benefit_id = tb.id
                LEFT JOIN options_trust_benefit_type tbt ON tb.benefit_type = tbt.id
                LEFT JOIN employers e ON wmb.employer_id = e.id
                WHERE wmb.worker_id = w.id
                  AND wmb.month = ${currentMonth}
                  AND wmb.year = ${currentYear}
                ORDER BY tb.id, e.id
              ) benefit_rows
            ),
            '[]'::json
          ) as benefits
        FROM workers w
      `);
      
      return result.rows.map((row: any) => ({
        workerId: row.worker_id,
        benefits: Array.isArray(row.benefits) ? row.benefits : []
      }));
    },

    async getWorker(id: string): Promise<Worker | undefined> {
      const [worker] = await db.select().from(workers).where(eq(workers.id, id));
      return worker || undefined;
    },

    async getWorkerBySSN(ssn: string): Promise<Worker | undefined> {
      // Parse SSN to normalize format before lookup
      const { parseSSN } = await import('@shared/utils/ssn');
      let normalizedSSN: string;
      try {
        normalizedSSN = parseSSN(ssn);
      } catch (error) {
        // If SSN can't be parsed, it won't match anything in the database
        return undefined;
      }
      
      // Use SQL to strip non-digits from database column for comparison
      // This allows matching both normalized SSNs (123456789) and legacy dashed SSNs (123-45-6789)
      const [worker] = await db
        .select()
        .from(workers)
        .where(sql`regexp_replace(${workers.ssn}, '[^0-9]', '', 'g') = ${normalizedSSN}`);
      
      return worker || undefined;
    },

    async createWorker(name: string): Promise<Worker> {
      // For simple name input, parse into given/family names
      const nameParts = name.trim().split(' ');
      const given = nameParts[0] || '';
      const family = nameParts.slice(1).join(' ') || '';
      
      // Create contact first with name components using contact storage
      const contact = await contactsStorage.createContact({
        given: given || null,
        family: family || null,
        displayName: name,
      });
      
      // Create worker with the contact reference
      const [worker] = await db
        .insert(workers)
        .values({ contactId: contact.id })
        .returning();
      
      return worker;
    },

    async updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's name using contact storage
      await contactsStorage.updateName(currentWorker.contactId, name);
      
      return currentWorker;
    },

    async updateWorkerContactNameComponents(
      workerId: string,
      components: {
        title?: string;
        given?: string;
        middle?: string;
        family?: string;
        generational?: string;
        credentials?: string;
      }
    ): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's name components using contact storage
      await contactsStorage.updateNameComponents(currentWorker.contactId, components);
      
      return currentWorker;
    },

    async updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's email using contact storage
      await contactsStorage.updateEmail(currentWorker.contactId, email);
      
      return currentWorker;
    },

    async updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's birth date using contact storage
      await contactsStorage.updateBirthDate(currentWorker.contactId, birthDate);
      
      return currentWorker;
    },

    async updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined> {
      // Get the current worker to find its contact
      const [currentWorker] = await db.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's gender using contact storage
      await contactsStorage.updateGender(currentWorker.contactId, gender, genderNota);
      
      return currentWorker;
    },

    async updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined> {
      const cleanSSN = ssn.trim();
      
      // Allow clearing the SSN
      if (!cleanSSN) {
        const [updatedWorker] = await db
          .update(workers)
          .set({ ssn: null })
          .where(eq(workers.id, workerId))
          .returning();
        
        return updatedWorker || undefined;
      }
      
      // Import SSN utilities
      const { parseSSN, validateSSN } = await import("@shared/utils/ssn");
      
      // Parse SSN to normalize format (strips non-digits, pads with zeros)
      let parsedSSN: string;
      try {
        parsedSSN = parseSSN(cleanSSN);
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Invalid SSN format");
      }
      
      // Validate SSN format and rules
      const validation = validateSSN(parsedSSN);
      if (!validation.valid) {
        throw new Error(validation.error || "Invalid SSN");
      }
      
      try {
        // Update the worker's SSN with parsed (normalized) value
        const [updatedWorker] = await db
          .update(workers)
          .set({ ssn: parsedSSN })
          .where(eq(workers.id, workerId))
          .returning();
        
        return updatedWorker || undefined;
      } catch (error: any) {
        // Check for unique constraint violation
        if (error.code === '23505' && error.constraint === 'workers_ssn_unique') {
          throw new Error("This SSN is already assigned to another worker");
        }
        throw error;
      }
    },

    async updateWorkerStatus(workerId: string, denormWsId: string | null): Promise<Worker | undefined> {
      const [updatedWorker] = await db
        .update(workers)
        .set({ denormWsId })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    },

    async deleteWorker(id: string): Promise<boolean> {
      // Get the worker to find its contact
      const [worker] = await db.select().from(workers).where(eq(workers.id, id));
      if (!worker) {
        return false;
      }
      
      // Delete the worker first
      const result = await db.delete(workers).where(eq(workers.id, id)).returning();
      
      // If worker was deleted, also delete the corresponding contact using contact storage
      if (result.length > 0) {
        await contactsStorage.deleteContact(worker.contactId);
      }
      
      return result.length > 0;
    },

    // Worker benefits methods
    async getWorkerBenefits(workerId: string): Promise<any[]> {
      const results = await db
        .select({
          id: trustWmb.id,
          month: trustWmb.month,
          year: trustWmb.year,
          workerId: trustWmb.workerId,
          employerId: trustWmb.employerId,
          benefitId: trustWmb.benefitId,
          benefit: trustBenefits,
          employer: employers,
        })
        .from(trustWmb)
        .leftJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(eq(trustWmb.workerId, workerId))
        .orderBy(desc(trustWmb.year), desc(trustWmb.month));

      return results;
    },

    async createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb> {
      const [wmb] = await db
        .insert(trustWmb)
        .values(data)
        .returning();

      if (wmb) {
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          
          const context = {
            trigger: TriggerType.WMB_SAVED as typeof TriggerType.WMB_SAVED,
            wmbId: wmb.id,
            workerId: wmb.workerId,
            employerId: wmb.employerId,
            benefitId: wmb.benefitId,
            year: wmb.year,
            month: wmb.month,
          };

          await executeChargePlugins(context);
        } catch (error) {
          logger.error("Failed to execute charge plugins for WMB create", {
            service: "worker-storage",
            wmbId: wmb.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return wmb;
    },

    async deleteWorkerBenefit(id: string): Promise<boolean> {
      const result = await db
        .delete(trustWmb)
        .where(eq(trustWmb.id, id))
        .returning();
      
      const deleted = result[0];
      
      if (deleted) {
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          
          const context = {
            trigger: TriggerType.WMB_SAVED as typeof TriggerType.WMB_SAVED,
            wmbId: deleted.id,
            workerId: deleted.workerId,
            employerId: deleted.employerId,
            benefitId: deleted.benefitId,
            year: deleted.year,
            month: deleted.month,
            isDeleted: true,
          };

          await executeChargePlugins(context);
        } catch (error) {
          logger.error("Failed to execute charge plugins for WMB delete", {
            service: "worker-storage",
            wmbId: deleted.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      return result.length > 0;
    },

    async workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean> {
      const result = await db
        .select({ id: trustWmb.id })
        .from(trustWmb)
        .where(
          and(
            eq(trustWmb.workerId, workerId),
            eq(trustWmb.benefitId, benefitId),
            eq(trustWmb.month, month),
            eq(trustWmb.year, year)
          )
        )
        .limit(1);
      return result.length > 0;
    },
  };

  return storage;
}

/**
 * Logging configuration for worker storage operations
 * 
 * Note: createWorker and deleteWorker are logged at the worker level because they involve 
 * both worker and contact records, providing a clear entry point for tracking worker lifecycle.
 * 
 * Contact-related update methods (updateWorkerContactName, updateWorkerContactEmail, etc.) 
 * are not logged at the worker level to avoid redundant entries - they are logged via the 
 * contact storage module.
 */
export const workerLoggingConfig: StorageLoggingConfig<WorkerStorage> = {
  module: 'workers',
  methods: {
    createWorker: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new worker',
      getHostEntityId: (args, result) => result?.id,
      after: async (args, result, storage) => {
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, result.contactId));
        return {
          worker: result,
          contact: contact,
          metadata: {
            inputName: args[0],
            workerId: result.id,
            contactId: result.contactId,
            siriusId: result.siriusId,
            note: 'Worker creation also created an associated contact record (logged separately in contacts module)'
          }
        };
      }
    },
    deleteWorker: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args, result, beforeState) => beforeState?.worker?.id || args[0],
      before: async (args, storage) => {
        const worker = await storage.getWorker(args[0]);
        if (!worker) {
          return null;
        }
        
        const [contact] = await db.select().from(contacts).where(eq(contacts.id, worker.contactId));
        return {
          worker: worker,
          contact: contact,
          metadata: {
            workerId: worker.id,
            contactId: worker.contactId,
            siriusId: worker.siriusId,
            note: 'Worker deletion will also delete the associated contact record (logged separately in contacts module)'
          }
        };
      },
      after: async (args, result, storage) => {
        return {
          deleted: result,
          workerId: args[0],
          metadata: {
            note: 'Worker and associated contact successfully deleted'
          }
        };
      }
    },
    updateWorkerStatus: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: async (args, result, beforeState, afterState) => {
        const oldStatus = beforeState?.workStatus?.name || 'None';
        const newStatus = afterState?.workStatus?.name || 'None';
        return `Updated Current Work Status [${oldStatus} → ${newStatus}]`;
      },
      before: async (args, storage) => {
        const worker = await storage.getWorker(args[0]);
        if (!worker || !worker.denormWsId) {
          return null;
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, worker.denormWsId));
        return {
          worker: worker,
          workStatus: workStatus,
          metadata: {
            workerId: worker.id,
            currentWsId: worker.denormWsId,
            currentWorkStatusName: workStatus?.name || 'None'
          }
        };
      },
      after: async (args, result, storage) => {
        if (!result) return null;
        
        if (!result.denormWsId) {
          return {
            worker: result,
            workStatus: null,
            metadata: {
              workerId: result.id,
              newWsId: null,
              newWorkStatusName: 'None',
              note: 'Worker work status cleared (synchronized from work status history)'
            }
          };
        }
        
        const [workStatus] = await db.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.denormWsId));
        return {
          worker: result,
          workStatus: workStatus,
          metadata: {
            workerId: result.id,
            newWsId: result.denormWsId,
            newWorkStatusName: workStatus?.name || 'Unknown',
            note: 'Worker work status updated (synchronized from work status history)'
          }
        };
      }
    }
  }
};

