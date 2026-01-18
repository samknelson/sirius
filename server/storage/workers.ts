import { getClient } from './transaction-context';
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
import { eq, sql, desc, and, ne } from "drizzle-orm";
import type { ContactsStorage } from "./contacts";
import type { WorkerDenormData } from "./worker-hours";
import { type StorageLoggingConfig } from "./middleware/logging";
import { logger } from "../logger";
import { eventBus, EventType } from "../services/event-bus";
import { 
  type ValidationError,
  createAsyncStorageValidator
} from "./utils/validation";
import { parseSSN, validateSSN } from "@shared/utils/ssn";

export const ssnValidate = createAsyncStorageValidator<{ ssn: string | null; workerId?: string }, never, { ssn: string | null }>(
  async (data) => {
    const errors: ValidationError[] = [];
    
    if (!data.ssn || !data.ssn.trim()) {
      return { ok: true, value: { ssn: null } };
    }
    
    const cleanSSN = data.ssn.trim();
    
    let parsedSSN: string;
    try {
      parsedSSN = parseSSN(cleanSSN);
    } catch (error) {
      errors.push({
        field: 'ssn',
        code: 'INVALID_FORMAT',
        message: error instanceof Error ? error.message : "Invalid SSN format"
      });
      return { ok: false, errors };
    }
    
    const validation = validateSSN(parsedSSN);
    if (!validation.valid) {
      errors.push({
        field: 'ssn',
        code: 'INVALID_SSN',
        message: validation.error || "Invalid SSN"
      });
      return { ok: false, errors };
    }
    
    if (data.workerId) {
      const client = getClient();
      const [existingWorker] = await client
        .select({ id: workers.id })
        .from(workers)
        .where(and(eq(workers.ssn, parsedSSN), ne(workers.id, data.workerId)));
      
      if (existingWorker) {
        errors.push({
          field: 'ssn',
          code: 'DUPLICATE_SSN',
          message: "This SSN is already assigned to another worker"
        });
        return { ok: false, errors };
      }
    }
    
    return { ok: true, value: { ssn: parsedSSN } };
  }
);

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
  denorm_job_title: string | null;
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
  getWorkerByContactEmail(email: string): Promise<Worker | undefined>;
  getWorkerByContactId(contactId: string): Promise<Worker | undefined>;
  getWorkersByHomeEmployerId(employerId: string, options?: { excludeAssignedToSheetId?: string }): Promise<Array<{
    id: string;
    siriusId: number | null;
    contactId: string;
    displayName: string | null;
    given: string | null;
    family: string | null;
  }>>;
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
  setDenormDataProvider(provider: (workerId: string) => Promise<WorkerDenormData>): void;
  syncWorkerEmployerDenorm(workerId: string): Promise<void>;
  deleteWorker(id: string): Promise<boolean>;
  updateWorkerBargainingUnit(workerId: string, bargainingUnitId: string | null): Promise<Worker | undefined>;
  // Worker benefits methods
  getWorkerBenefits(workerId: string): Promise<any[]>;
  createWorkerBenefit(data: { workerId: string; month: number; year: number; employerId: string; benefitId: string }): Promise<TrustWmb>;
  deleteWorkerBenefit(id: string): Promise<boolean>;
  workerBenefitExists(workerId: string, benefitId: string, month: number, year: number): Promise<boolean>;
}

export function createWorkerStorage(contactsStorage: ContactsStorage): WorkerStorage {
  let denormDataProvider: ((workerId: string) => Promise<WorkerDenormData>) | null = null;

  const storage = {
    setDenormDataProvider(provider: (workerId: string) => Promise<WorkerDenormData>): void {
      denormDataProvider = provider;
    },

    async getAllWorkers(): Promise<Worker[]> {
      const client = getClient();
      return await client.select().from(workers);
    },

    async getWorkersWithDetails(): Promise<WorkerWithDetails[]> {
      const client = getClient();
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      
      const result = await client.execute(sql`
        SELECT 
          w.id,
          w.sirius_id,
          w.contact_id,
          w.ssn,
          w.denorm_ws_id,
          w.denorm_job_title,
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
                AND wmb.month = ${currentMonth}
                AND wmb.year = ${currentYear}
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
                AND wmb.month = ${currentMonth}
                AND wmb.year = ${currentYear}
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
                AND wmb.month = ${currentMonth}
                AND wmb.year = ${currentYear}
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
      const client = getClient();
      const result = await client.execute(sql`
        WITH latest_hours AS (
          SELECT DISTINCT ON (worker_id, employer_id)
            worker_id,
            employer_id,
            employment_status_id,
            home
          FROM worker_hours
          ORDER BY worker_id, employer_id, year DESC, month DESC, day DESC
        )
        SELECT 
          w.id as worker_id,
          COALESCE(
            json_agg(
              DISTINCT jsonb_build_object(
                'id', e.id,
                'name', e.name,
                'isHome', COALESCE(lh.home, false),
                'employmentStatusId', es.id,
                'employmentStatusName', es.name,
                'employmentStatusCode', es.code,
                'employmentStatusEmployed', es.employed,
                'employmentStatusColor', es.data->>'color',
                'employerTypeId', et.id,
                'employerTypeName', et.name,
                'employerTypeIcon', et.data->>'icon'
              )
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'::json
          ) as employers
        FROM workers w
        LEFT JOIN latest_hours lh ON w.id = lh.worker_id
        LEFT JOIN employers e ON lh.employer_id = e.id
        LEFT JOIN options_employment_status es ON lh.employment_status_id = es.id
        LEFT JOIN options_employer_type et ON e.type_id = et.id
        GROUP BY w.id
      `);
      
      return result.rows.map((row: any) => ({
        workerId: row.worker_id,
        employers: row.employers || []
      }));
    },

    async getWorkersCurrentBenefits(month?: number, year?: number): Promise<WorkerCurrentBenefits[]> {
      const client = getClient();
      const now = new Date();
      const currentMonth = month ?? (now.getMonth() + 1);
      const currentYear = year ?? now.getFullYear();

      const result = await client.execute(sql`
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
      const client = getClient();
      const [worker] = await client.select().from(workers).where(eq(workers.id, id));
      return worker || undefined;
    },

    async getWorkerBySSN(ssn: string): Promise<Worker | undefined> {
      const client = getClient();
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
      const [worker] = await client
        .select()
        .from(workers)
        .where(sql`regexp_replace(${workers.ssn}, '[^0-9]', '', 'g') = ${normalizedSSN}`);
      
      return worker || undefined;
    },

    async getWorkerByContactEmail(email: string): Promise<Worker | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          ssn: workers.ssn,
          denormWsId: workers.denormWsId,
          denormJobTitle: workers.denormJobTitle,
          denormHomeEmployerId: workers.denormHomeEmployerId,
          denormEmployerIds: workers.denormEmployerIds,
          bargainingUnitId: workers.bargainingUnitId,
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(sql`LOWER(${contacts.email}) = LOWER(${email})`);
      
      return result || undefined;
    },

    async getWorkerByContactId(contactId: string): Promise<Worker | undefined> {
      const client = getClient();
      const [worker] = await client
        .select()
        .from(workers)
        .where(eq(workers.contactId, contactId));
      return worker || undefined;
    },

    async getWorkersByHomeEmployerId(employerId: string, options?: { excludeAssignedToSheetId?: string }): Promise<Array<{
      id: string;
      siriusId: number | null;
      contactId: string;
      displayName: string | null;
      given: string | null;
      family: string | null;
    }>> {
      const client = getClient();
      
      if (options?.excludeAssignedToSheetId) {
        // Exclude workers who are already assigned to crews on this specific sheet
        const result = await client.execute(sql`
          SELECT 
            w.id,
            w.sirius_id as "siriusId",
            w.contact_id as "contactId",
            c.display_name as "displayName",
            c.given,
            c.family
          FROM workers w
          INNER JOIN contacts c ON w.contact_id = c.id
          WHERE w.denorm_home_employer_id = ${employerId}
            AND w.id NOT IN (
              SELECT ea.worker_id 
              FROM edls_assignments ea
              INNER JOIN edls_crews ec ON ea.crew_id = ec.id
              WHERE ec.sheet_id = ${options.excludeAssignedToSheetId}
            )
          ORDER BY c.family, c.given
        `);
        return result.rows as Array<{
          id: string;
          siriusId: number | null;
          contactId: string;
          displayName: string | null;
          given: string | null;
          family: string | null;
        }>;
      }
      
      const result = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          displayName: contacts.displayName,
          given: contacts.given,
          family: contacts.family,
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(workers.denormHomeEmployerId, employerId))
        .orderBy(contacts.family, contacts.given);
      return result;
    },

    async createWorker(name: string): Promise<Worker> {
      const client = getClient();
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
      const [worker] = await client
        .insert(workers)
        .values({ contactId: contact.id })
        .returning();
      
      return worker;
    },

    async updateWorkerContactName(workerId: string, name: string): Promise<Worker | undefined> {
      const client = getClient();
      // Get the current worker to find its contact
      const [currentWorker] = await client.select().from(workers).where(eq(workers.id, workerId));
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
      const client = getClient();
      // Get the current worker to find its contact
      const [currentWorker] = await client.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's name components using contact storage
      await contactsStorage.updateNameComponents(currentWorker.contactId, components);
      
      return currentWorker;
    },

    async updateWorkerContactEmail(workerId: string, email: string): Promise<Worker | undefined> {
      const client = getClient();
      // Get the current worker to find its contact
      const [currentWorker] = await client.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's email using contact storage
      await contactsStorage.updateEmail(currentWorker.contactId, email);
      
      return currentWorker;
    },

    async updateWorkerContactBirthDate(workerId: string, birthDate: string | null): Promise<Worker | undefined> {
      const client = getClient();
      // Get the current worker to find its contact
      const [currentWorker] = await client.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's birth date using contact storage
      await contactsStorage.updateBirthDate(currentWorker.contactId, birthDate);
      
      return currentWorker;
    },

    async updateWorkerContactGender(workerId: string, gender: string | null, genderNota: string | null): Promise<Worker | undefined> {
      const client = getClient();
      // Get the current worker to find its contact
      const [currentWorker] = await client.select().from(workers).where(eq(workers.id, workerId));
      if (!currentWorker) {
        return undefined;
      }
      
      // Update the contact's gender using contact storage
      await contactsStorage.updateGender(currentWorker.contactId, gender, genderNota);
      
      return currentWorker;
    },

    async updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined> {
      const client = getClient();
      const validated = await ssnValidate.validateOrThrow({ ssn, workerId });
      
      const [updatedWorker] = await client
        .update(workers)
        .set({ ssn: validated.ssn })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    },

    async updateWorkerStatus(workerId: string, denormWsId: string | null): Promise<Worker | undefined> {
      const client = getClient();
      const [updatedWorker] = await client
        .update(workers)
        .set({ denormWsId })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    },

    async syncWorkerEmployerDenorm(workerId: string): Promise<void> {
      if (!denormDataProvider) {
        throw new Error("Denorm data provider not set. Call setDenormDataProvider first.");
      }
      
      const denormData = await denormDataProvider(workerId);
      
      const client = getClient();
      await client
        .update(workers)
        .set({
          denormHomeEmployerId: denormData.homeEmployerId,
          denormEmployerIds: denormData.employerIds,
          denormWsId: denormData.latestWsId,
          denormJobTitle: denormData.jobTitle,
        })
        .where(eq(workers.id, workerId));
    },

    async updateWorkerBargainingUnit(workerId: string, bargainingUnitId: string | null): Promise<Worker | undefined> {
      const client = getClient();
      // Normalize empty string to null
      const normalizedId = bargainingUnitId && bargainingUnitId.trim() ? bargainingUnitId.trim() : null;
      
      const [updatedWorker] = await client
        .update(workers)
        .set({ bargainingUnitId: normalizedId })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker || undefined;
    },

    async deleteWorker(id: string): Promise<boolean> {
      const client = getClient();
      // Get the worker to find its contact
      const [worker] = await client.select().from(workers).where(eq(workers.id, id));
      if (!worker) {
        return false;
      }
      
      // Delete the worker first
      const result = await client.delete(workers).where(eq(workers.id, id)).returning();
      
      // If worker was deleted, also delete the corresponding contact using contact storage
      if (result.length > 0) {
        await contactsStorage.deleteContact(worker.contactId);
      }
      
      return result.length > 0;
    },

    // Worker benefits methods
    async getWorkerBenefits(workerId: string): Promise<any[]> {
      const client = getClient();
      const results = await client
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
      const client = getClient();
      const [wmb] = await client
        .insert(trustWmb)
        .values(data)
        .returning();

      if (wmb) {
        const payload = {
          wmbId: wmb.id,
          workerId: wmb.workerId,
          employerId: wmb.employerId,
          benefitId: wmb.benefitId,
          year: wmb.year,
          month: wmb.month,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.WMB_SAVED, payload).catch(err => {
          logger.error("Failed to emit WMB_SAVED event", {
            service: "worker-storage",
            wmbId: wmb.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          await executeChargePlugins({
            trigger: TriggerType.WMB_SAVED,
            ...payload,
          });
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
      const client = getClient();
      const result = await client
        .delete(trustWmb)
        .where(eq(trustWmb.id, id))
        .returning();
      
      const deleted = result[0];
      
      if (deleted) {
        const payload = {
          wmbId: deleted.id,
          workerId: deleted.workerId,
          employerId: deleted.employerId,
          benefitId: deleted.benefitId,
          year: deleted.year,
          month: deleted.month,
          isDeleted: true,
        };

        // Emit event for any listeners (future notification plugins, etc.)
        eventBus.emit(EventType.WMB_SAVED, payload).catch(err => {
          logger.error("Failed to emit WMB_SAVED event", {
            service: "worker-storage",
            wmbId: deleted.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Execute charge plugins directly (for backwards compatibility)
        try {
          const { executeChargePlugins, TriggerType } = await import("../charge-plugins");
          await executeChargePlugins({
            trigger: TriggerType.WMB_SAVED,
            ...payload,
          });
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
      const client = getClient();
      const result = await client
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
        const client = getClient();
        const [contact] = await client.select().from(contacts).where(eq(contacts.id, result.contactId));
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
        
        const client = getClient();
        const [contact] = await client.select().from(contacts).where(eq(contacts.id, worker.contactId));
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
        
        const client = getClient();
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, worker.denormWsId));
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
        
        const client = getClient();
        const [workStatus] = await client.select().from(optionsWorkerWs).where(eq(optionsWorkerWs.id, result.denormWsId));
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

