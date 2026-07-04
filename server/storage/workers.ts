import { getClient } from './transaction-context';
import {
  workers,
  contacts,
  employers,
  optionsWorkerWs,
  workerMshDenorm,
  workerWshDenorm,
  workerEmploymentDenorm,
  denorm,
  type Worker,
  type InsertWorker,
  type TrustBenefit,
  type Employer,
} from "@shared/schema";
import { eq, sql, and, ne, isNull } from "drizzle-orm";
import type { ContactsStorage } from "./contacts";
import { type StorageLoggingConfig } from "./middleware/logging";
import { logger } from "../logger";
import { 
  type ValidationError,
  createAsyncStorageValidator
} from "./utils/validation";
import { parseSSN, validateSSN } from "@shared/utils/ssn";
import { isComponentEnabledSync } from "../services/component-cache";

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

export interface WorkerContactExportRow {
  id: string;
  given: string | null;
  family: string | null;
  email: string | null;
  denorm_ms_ids: string[] | null;
  denorm_employer_ids: string[] | null;
  phone_number: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
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

export interface PaginatedWorkersResult {
  data: WorkerWithDetails[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface WorkersExportParams {
  search?: string;
  sortOrder?: 'asc' | 'desc';
  employerId?: string;
  employerTypeId?: string;
  bargainingUnitId?: string;
  benefitId?: string;
  contactStatus?: 'all' | 'has_email' | 'missing_email' | 'has_phone' | 'missing_phone' | 'has_address' | 'missing_address' | 'complete' | 'incomplete';
  jobTitle?: string;
  memberStatusId?: string;
  representativeId?: string;
}

export interface WorkersPaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: 'name' | 'email';
  sortBy?: 'lastName' | 'firstName' | 'employer';
  sortOrder?: 'asc' | 'desc';
  // Filters
  employerId?: string;
  employerTypeId?: string;
  bargainingUnitId?: string;
  benefitId?: string;
  contactStatus?: 'all' | 'has_email' | 'missing_email' | 'has_phone' | 'missing_phone' | 'has_address' | 'missing_address' | 'complete' | 'incomplete';
  hasMultipleEmployers?: boolean;
  jobTitle?: string;
  memberStatusId?: string;
  representativeId?: string;
}

export interface WorkerSearchResult {
  workers: Array<{ id: string; siriusId: number; displayName: string }>;
  total: number;
}

export interface WorkerStorage {
  getAllWorkers(): Promise<Worker[]>;
  /**
   * Backfill anti-join: worker ids that have no `denorm` row for the given
   * config, capped at `limit`. Read-only; used by the denorm backfill sweep to
   * discover workers that still need a (stale) denorm row enqueued.
   */
  findIdsMissingDenorm(configId: string, limit: number): Promise<string[]>;
  /**
   * Widow anti-join (the mirror of {@link findIdsMissingDenorm}): entity ids of
   * `denorm` rows for the given config whose worker no longer exists, capped at
   * `limit`. Read-only; used by the denorm backfill sweep to discover orphaned
   * denorm rows to delete.
   */
  findDenormWidowIds(configId: string, limit: number): Promise<string[]>;
  searchWorkers(query: string, limit?: number): Promise<WorkerSearchResult>;
  getWorkersWithDetails(): Promise<WorkerWithDetails[]>;
  getWorkersWithDetailsPaginated(params: WorkersPaginationParams): Promise<PaginatedWorkersResult>;
  getWorkersForExport(params: WorkersExportParams): Promise<WorkerWithDetails[]>;
  getAllMatchingContactIds(params: Omit<WorkersPaginationParams, 'page' | 'pageSize' | 'sortField'>): Promise<string[]>;
  getWorkersEmployersSummary(): Promise<WorkerEmployerSummary[]>;
  getContactExportDataByIds(workerIdsList: string[]): Promise<WorkerContactExportRow[]>;
  getWorkersCurrentBenefits(month?: number, year?: number): Promise<WorkerCurrentBenefits[]>;
  getWorker(id: string): Promise<Worker | undefined>;
  // Generic, feature-agnostic accessors for the worker's `data` jsonb blob.
  // These know nothing about any particular feature's JSON path; the only
  // legitimate writer is a validated, feature-specific storage namespace that
  // performs an atomic read-modify-write. Do NOT use as a general escape hatch.
  getData(id: string): Promise<Record<string, unknown>>;
  setData(id: string, data: Record<string, unknown>): Promise<void>;
  getWorkerDisplayName(id: string | undefined | null): Promise<string>;
  getWorkerBySSN(ssn: string): Promise<Worker | undefined>;
  getWorkerByContactEmail(email: string): Promise<Worker | undefined>;
  getWorkerByContactId(contactId: string): Promise<Worker | undefined>;
  getWorkersByHomeEmployerId(employerId: string): Promise<Array<{
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
  updateWorkerBargainingUnit(workerId: string, bargainingUnitId: string | null): Promise<Worker | undefined>;
  deleteWorker(id: string): Promise<boolean>;
  updateWorkerBargainingUnit(workerId: string, bargainingUnitId: string | null): Promise<Worker | undefined>;
  // Worker benefits methods
  getMemberStatusCodesByIndustry(industryId: string, workerIdsList: string[]): Promise<Array<{ workerId: string; code: string }>>;
}

interface InternalSearchParams {
  search?: string;
  sortOrder?: 'asc' | 'desc';
  sortBy?: 'lastName' | 'firstName' | 'employer';
  employerId?: string;
  employerTypeId?: string;
  bargainingUnitId?: string;
  benefitId?: string;
  contactStatus?: string;
  hasMultipleEmployers?: boolean;
  jobTitle?: string;
  memberStatusId?: string;
  representativeId?: string;
  page?: number;
  pageSize?: number;
}

interface InternalSearchResult {
  rows: WorkerWithDetails[];
  total?: number;
}

function _buildContactStatusCondition(contactStatus: string | undefined) {
  if (!contactStatus || contactStatus === 'all') return sql``;
  switch (contactStatus) {
    case 'has_email':
      return sql`AND c.email IS NOT NULL AND c.email != ''`;
    case 'missing_email':
      return sql`AND (c.email IS NULL OR c.email = '')`;
    case 'has_phone':
      return sql`AND EXISTS (SELECT 1 FROM contact_phone cp WHERE cp.contact_id = c.id)`;
    case 'missing_phone':
      return sql`AND NOT EXISTS (SELECT 1 FROM contact_phone cp WHERE cp.contact_id = c.id)`;
    case 'has_address':
      return sql`AND EXISTS (SELECT 1 FROM contact_postal ca WHERE ca.contact_id = c.id AND ca.is_active = true)`;
    case 'missing_address':
      return sql`AND NOT EXISTS (SELECT 1 FROM contact_postal ca WHERE ca.contact_id = c.id AND ca.is_active = true)`;
    case 'complete':
      return sql`AND c.email IS NOT NULL AND c.email != '' 
        AND EXISTS (SELECT 1 FROM contact_phone cp WHERE cp.contact_id = c.id)
        AND EXISTS (SELECT 1 FROM contact_postal ca WHERE ca.contact_id = c.id AND ca.is_active = true)`;
    case 'incomplete':
      return sql`AND (
        (c.email IS NULL OR c.email = '')
        OR NOT EXISTS (SELECT 1 FROM contact_phone cp WHERE cp.contact_id = c.id)
        OR NOT EXISTS (SELECT 1 FROM contact_postal ca WHERE ca.contact_id = c.id AND ca.is_active = true)
      )`;
    default:
      return sql``;
  }
}

async function _searchWorkers(params: InternalSearchParams): Promise<InternalSearchResult> {
  const client = getClient();
  const search = params.search?.trim() ?? '';
  const sortOrder = params.sortOrder ?? 'asc';
  const sortBy = params.sortBy ?? 'lastName';
  const { employerId, employerTypeId, bargainingUnitId, benefitId, contactStatus, hasMultipleEmployers, jobTitle, memberStatusId, representativeId } = params;

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const benefitsEnabled = isComponentEnabledSync('trust.benefits');
  const bargainingUnitsEnabled = isComponentEnabledSync('bargainingunits');
  const politicalEnabled = isComponentEnabledSync('sitespecific.btu.political');

  const searchCondition = (() => {
    if (!search) return sql``;
    const terms = search.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return sql``;
    const termConditions = terms.map(term => {
      const pattern = `%${term}%`;
      const digitsOnly = term.replace(/\D/g, '');
      const phonePattern = digitsOnly.length >= 3 ? `%${digitsOnly}%` : null;
      return sql`(
        LOWER(c.display_name) LIKE ${pattern}
        OR LOWER(c.email) LIKE ${pattern}
        OR LOWER(c.given) LIKE ${pattern}
        OR LOWER(c.family) LIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM worker_ids wid
          INNER JOIN options_worker_id_type widt ON wid.type_id = widt.id
          WHERE wid.worker_id = w.id
            AND (widt.data->>'showOnLists')::boolean = true
            AND LOWER(wid.value) LIKE ${pattern}
        )
        OR EXISTS (
          SELECT 1 FROM contact_phone cp
          WHERE cp.contact_id = c.id
            AND cp.is_active = true
            AND (
              LOWER(cp.phone_number) LIKE ${pattern}
              ${phonePattern ? sql`OR REGEXP_REPLACE(cp.phone_number, '[^0-9]', '', 'g') LIKE ${phonePattern}` : sql``}
            )
        )
        OR EXISTS (
          SELECT 1 FROM contact_postal cpo
          WHERE cpo.contact_id = c.id
            AND cpo.is_active = true
            AND (
              LOWER(cpo.street) LIKE ${pattern}
              OR LOWER(cpo.city) LIKE ${pattern}
              OR LOWER(cpo.state) LIKE ${pattern}
              OR cpo.postal_code LIKE ${pattern}
            )
        )
      )`;
    });
    let combined = termConditions[0];
    for (let i = 1; i < termConditions.length; i++) {
      combined = sql`${combined} AND ${termConditions[i]}`;
    }
    return sql`AND (${combined})`;
  })();

  const employerCondition = employerId 
    ? sql`AND EXISTS (
        SELECT 1 FROM worker_employment_denorm wed
        WHERE wed.worker_id = w.id AND wed.employer_id = ${employerId}
      )`
    : sql``;

  const employerTypeCondition = employerTypeId
    ? sql`AND EXISTS (
        SELECT 1 FROM worker_employment_denorm wed
        JOIN employers e ON e.id = wed.employer_id
        WHERE wed.worker_id = w.id
        AND e.type_id = ${employerTypeId}
      )`
    : sql``;

  const bargainingUnitCondition = (bargainingUnitId && bargainingUnitsEnabled)
    ? sql`AND w.bargaining_unit_id = ${bargainingUnitId}`
    : sql``;

  const benefitCondition = (benefitId && benefitsEnabled)
    ? sql`AND EXISTS (
        SELECT 1 FROM trust_wmb wmb
        WHERE wmb.worker_id = w.id
        AND wmb.benefit_id = ${benefitId}
        AND wmb.month = ${currentMonth}
        AND wmb.year = ${currentYear}
      )`
    : sql``;

  const contactStatusCondition = _buildContactStatusCondition(contactStatus);

  const multipleEmployersCondition = hasMultipleEmployers
    ? sql`AND (SELECT COUNT(*) FROM worker_employment_denorm wed WHERE wed.worker_id = w.id) > 1`
    : sql``;

  const jobTitleCondition = jobTitle
    ? sql`AND EXISTS (
        SELECT 1 FROM worker_employment_denorm wed
        WHERE wed.worker_id = w.id AND wed.home = true
        AND LOWER(wed.job_title) LIKE ${`%${jobTitle.toLowerCase()}%`}
      )`
    : sql``;

  const memberStatusCondition = memberStatusId
    ? memberStatusId === 'none'
      ? sql`AND NOT EXISTS (SELECT 1 FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id)`
      : sql`AND EXISTS (SELECT 1 FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id AND wmd.ms_id = ${memberStatusId})`
    : sql``;

  const representativeCondition = (representativeId && politicalEnabled)
    ? sql`AND EXISTS (
        SELECT 1 FROM sitespecific_btu_political_worker_reps pwr
        WHERE pwr.worker_id = w.id
        AND pwr.official_id = ${representativeId}
      )`
    : sql``;

  const allConditions = sql`${searchCondition} ${employerCondition} ${employerTypeCondition} ${bargainingUnitCondition} ${benefitCondition} ${contactStatusCondition} ${multipleEmployersCondition} ${jobTitleCondition} ${memberStatusCondition} ${representativeCondition}`;

  const isPaginated = params.page !== undefined && params.pageSize !== undefined;
  let total: number | undefined;

  if (isPaginated) {
    const countResult = await client.execute(sql`
      SELECT COUNT(*) as total
      FROM workers w
      INNER JOIN contacts c ON w.contact_id = c.id
      WHERE 1=1 ${allConditions}
    `);
    total = parseInt((countResult.rows[0] as any).total, 10);
  }

  const orderDirection = sortOrder === 'desc' ? sql`DESC` : sql`ASC`;

  let orderByClause;
  if (sortBy === 'firstName') {
    orderByClause = sql`ORDER BY c.given ${orderDirection}, c.family ${orderDirection}`;
  } else if (sortBy === 'employer') {
    orderByClause = sql`ORDER BY (
      SELECT MIN(e.name) FROM employers e
      JOIN worker_employment_denorm wed ON e.id = wed.employer_id
      WHERE wed.worker_id = w.id
    ) ${orderDirection} NULLS LAST, c.family ${orderDirection}, c.given ${orderDirection}`;
  } else {
    orderByClause = sql`ORDER BY c.family ${orderDirection}, c.given ${orderDirection}`;
  }

  const bargainingUnitColumns = bargainingUnitsEnabled
    ? sql`bu.sirius_id as bargaining_unit_code, bu.name as bargaining_unit_name,`
    : sql`NULL::integer as bargaining_unit_code, NULL::text as bargaining_unit_name,`;

  const bargainingUnitJoin = bargainingUnitsEnabled
    ? sql`LEFT JOIN bargaining_units bu ON w.bargaining_unit_id = bu.id`
    : sql``;

  const benefitColumns = benefitsEnabled
    ? sql`
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
        ) as benefits`
    : sql`
        '[]'::json as benefit_types,
        '[]'::json as benefit_ids,
        '[]'::json as benefits`;

  const paginationClause = isPaginated
    ? sql`LIMIT ${params.pageSize} OFFSET ${(params.page! - 1) * params.pageSize!}`
    : sql``;

  const result = await client.execute(sql`
    SELECT 
      w.id,
      w.sirius_id,
      w.contact_id,
      w.ssn,
      wwd.ws_id AS denorm_ws_id,
      (SELECT wed.job_title FROM worker_employment_denorm wed WHERE wed.worker_id = w.id AND wed.home = true LIMIT 1) AS denorm_job_title,
      (SELECT wed.employer_id FROM worker_employment_denorm wed WHERE wed.worker_id = w.id AND wed.home = true LIMIT 1) AS denorm_home_employer_id,
      (SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id = w.id) AS denorm_employer_ids,
      (SELECT array_agg(wmd.ms_id) FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id) AS denorm_ms_ids,
      w.bargaining_unit_id,
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
      ${bargainingUnitColumns}
      ${benefitColumns}
    FROM workers w
    INNER JOIN contacts c ON w.contact_id = c.id
    LEFT JOIN worker_wsh_denorm wwd ON wwd.worker_id = w.id
    LEFT JOIN options_worker_ws ws ON ws.id = wwd.ws_id
    ${bargainingUnitJoin}
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
    WHERE 1=1 ${allConditions}
    ${orderByClause}
    ${paginationClause}
  `);

  return {
    rows: result.rows as unknown as WorkerWithDetails[],
    total,
  };
}

// Strip the internal `data` jsonb blob from a worker row before it leaves the
// storage layer. `data` (beneficiary PII, etc.) must never ride along on generic
// worker responses; it is only exposed via the dedicated getData/baoBeneficiaries
// paths. Applied to every method that returns a worker row to callers.
function stripWorkerData<T extends { data?: unknown }>(row: T): Omit<T, "data"> {
  const { data: _data, ...rest } = row;
  return rest;
}

export function createWorkerStorage(contactsStorage: ContactsStorage): WorkerStorage {
  const storage = {
    async getAllWorkers(): Promise<Worker[]> {
      const client = getClient();
      const rows = await client.select().from(workers);
      return rows.map(stripWorkerData);
    },

    async findIdsMissingDenorm(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ id: workers.id })
        .from(workers)
        .leftJoin(
          denorm,
          and(eq(denorm.entityId, workers.id), eq(denorm.configId, configId)),
        )
        .where(isNull(denorm.id))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async findDenormWidowIds(configId: string, limit: number): Promise<string[]> {
      const client = getClient();
      const rows = await client
        .select({ entityId: denorm.entityId })
        .from(denorm)
        .leftJoin(workers, eq(workers.id, denorm.entityId))
        .where(and(eq(denorm.configId, configId), isNull(workers.id)))
        .limit(limit);
      return rows.map((r) => r.entityId);
    },

    async searchWorkers(query: string, limit: number = 10): Promise<WorkerSearchResult> {
      const client = getClient();
      const trimmedQuery = query.trim();
      
      const numericQuery = parseInt(trimmedQuery, 10);
      const isNumeric = !isNaN(numericQuery);
      
      let results;
      if (isNumeric) {
        results = await client
          .select({
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
          })
          .from(workers)
          .innerJoin(contacts, eq(workers.contactId, contacts.id))
          .where(eq(workers.siriusId, numericQuery))
          .limit(limit);
      } else {
        results = await client
          .select({
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
          })
          .from(workers)
          .innerJoin(contacts, eq(workers.contactId, contacts.id))
          .where(sql`${contacts.displayName} ILIKE ${'%' + trimmedQuery + '%'}`)
          .orderBy(contacts.displayName)
          .limit(limit);
      }
      
      return {
        workers: results.map(r => ({
          id: r.id,
          siriusId: r.siriusId,
          displayName: r.displayName || `Worker #${r.siriusId}`,
        })),
        total: results.length,
      };
    },

    async getWorkersWithDetails(): Promise<WorkerWithDetails[]> {
      const { rows } = await _searchWorkers({});
      return rows;
    },

    async getWorkersWithDetailsPaginated(params: WorkersPaginationParams): Promise<PaginatedWorkersResult> {
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 50;

      const { rows, total } = await _searchWorkers({
        search: params.search,
        sortOrder: params.sortOrder,
        sortBy: params.sortBy,
        employerId: params.employerId,
        employerTypeId: params.employerTypeId,
        bargainingUnitId: params.bargainingUnitId,
        benefitId: params.benefitId,
        contactStatus: params.contactStatus,
        hasMultipleEmployers: params.hasMultipleEmployers,
        jobTitle: params.jobTitle,
        memberStatusId: params.memberStatusId,
        representativeId: params.representativeId,
        page,
        pageSize,
      });

      return {
        data: rows,
        total: total!,
        page,
        pageSize,
        totalPages: Math.ceil(total! / pageSize),
      };
    },

    async getWorkersForExport(params: WorkersExportParams): Promise<WorkerWithDetails[]> {
      const { rows } = await _searchWorkers({
        search: params.search,
        sortOrder: params.sortOrder,
        employerId: params.employerId,
        employerTypeId: params.employerTypeId,
        bargainingUnitId: params.bargainingUnitId,
        benefitId: params.benefitId,
        contactStatus: params.contactStatus,
        jobTitle: params.jobTitle,
        memberStatusId: params.memberStatusId,
        representativeId: params.representativeId,
      });
      return rows;
    },

    async getAllMatchingContactIds(params: Omit<WorkersPaginationParams, 'page' | 'pageSize' | 'sortField'>): Promise<string[]> {
      const { rows } = await _searchWorkers({
        search: params.search,
        sortOrder: params.sortOrder,
        sortBy: params.sortBy,
        employerId: params.employerId,
        employerTypeId: params.employerTypeId,
        bargainingUnitId: params.bargainingUnitId,
        benefitId: params.benefitId,
        contactStatus: params.contactStatus,
        hasMultipleEmployers: params.hasMultipleEmployers,
        jobTitle: params.jobTitle,
        memberStatusId: params.memberStatusId,
        representativeId: params.representativeId,
      });
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const r of rows) {
        if (r.contact_id && !seen.has(r.contact_id)) {
          seen.add(r.contact_id);
          ordered.push(r.contact_id);
        }
      }
      return ordered;
    },

    async getContactExportDataByIds(workerIdsList: string[]): Promise<WorkerContactExportRow[]> {
      if (workerIdsList.length === 0) return [];
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          w.id,
          c.given,
          c.family,
          c.email,
          (SELECT array_agg(wmd.ms_id) FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id) AS denorm_ms_ids,
          (SELECT array_agg(wed.employer_id) FROM worker_employment_denorm wed WHERE wed.worker_id = w.id) AS denorm_employer_ids,
          (SELECT cp2.phone_number FROM contact_phone cp2 WHERE cp2.contact_id = c.id AND cp2.is_active = true ORDER BY cp2.is_primary DESC NULLS LAST LIMIT 1) as phone_number,
          (SELECT cpo.street FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_street,
          (SELECT cpo.city FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_city,
          (SELECT cpo.state FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_state,
          (SELECT cpo.postal_code FROM contact_postal cpo WHERE cpo.contact_id = c.id AND cpo.is_active = true ORDER BY cpo.is_primary DESC NULLS LAST LIMIT 1) as address_postal_code
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
        WHERE w.id = ANY(${workerIdsList})
      `);
      return (result.rows as Array<{
        id: string;
        given: string | null;
        family: string | null;
        email: string | null;
        denorm_ms_ids: string[] | null;
        denorm_employer_ids: string[] | null;
        phone_number: string | null;
        address_street: string | null;
        address_city: string | null;
        address_state: string | null;
        address_postal_code: string | null;
      }>).map(row => ({
        id: row.id,
        given: row.given,
        family: row.family,
        email: row.email,
        denorm_ms_ids: row.denorm_ms_ids,
        denorm_employer_ids: row.denorm_employer_ids,
        phone_number: row.phone_number,
        address_street: row.address_street,
        address_city: row.address_city,
        address_state: row.address_state,
        address_postal_code: row.address_postal_code,
      }));
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
      if (!worker) return undefined;
      const msRows = await client
        .select({ msId: workerMshDenorm.msId })
        .from(workerMshDenorm)
        .where(eq(workerMshDenorm.workerId, id));
      const [wsRow] = await client
        .select({ wsId: workerWshDenorm.wsId })
        .from(workerWshDenorm)
        .where(eq(workerWshDenorm.workerId, id));
      const empRows = await client
        .select({
          employerId: workerEmploymentDenorm.employerId,
          home: workerEmploymentDenorm.home,
          jobTitle: workerEmploymentDenorm.jobTitle,
        })
        .from(workerEmploymentDenorm)
        .where(eq(workerEmploymentDenorm.workerId, id));
      const homeRow = empRows.find((r) => r.home);
      return {
        ...stripWorkerData(worker),
        denormMsIds: msRows.length > 0 ? msRows.map((r) => r.msId) : null,
        denormWsId: wsRow?.wsId ?? null,
        denormHomeEmployerId: homeRow?.employerId ?? null,
        denormEmployerIds: empRows.length > 0 ? empRows.map((r) => r.employerId) : null,
        denormJobTitle: homeRow?.jobTitle ?? null,
      };
    },

    async getData(id: string): Promise<Record<string, unknown>> {
      const client = getClient();
      const [row] = await client
        .select({ data: workers.data })
        .from(workers)
        .where(eq(workers.id, id));
      if (!row) {
        throw new Error("WORKER_NOT_FOUND");
      }
      const data = row.data;
      return data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    },

    async setData(id: string, data: Record<string, unknown>): Promise<void> {
      const client = getClient();
      const result = await client
        .update(workers)
        .set({ data })
        .where(eq(workers.id, id))
        .returning({ id: workers.id });
      if (result.length === 0) {
        throw new Error("WORKER_NOT_FOUND");
      }
    },

    async getWorkerDisplayName(id: string | undefined | null): Promise<string> {
      if (!id) return '';
      const client = getClient();
      const [row] = await client
        .select({
          displayName: contacts.displayName,
          given: contacts.given,
          family: contacts.family,
        })
        .from(workers)
        .leftJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(workers.id, id));
      if (!row) return id;
      const composed = [row.given, row.family].filter(Boolean).join(' ').trim();
      return composed || row.displayName || id;
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
      
      return worker ? stripWorkerData(worker) : undefined;
    },

    async getWorkerByContactEmail(email: string): Promise<Worker | undefined> {
      const client = getClient();
      const [result] = await client
        .select({
          id: workers.id,
          siriusId: workers.siriusId,
          contactId: workers.contactId,
          ssn: workers.ssn,
          bargainingUnitId: workers.bargainingUnitId,
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(sql`LOWER(${contacts.email}) = LOWER(${email})`);

      if (!result) return undefined;
      const [wsRow] = await client
        .select({ wsId: workerWshDenorm.wsId })
        .from(workerWshDenorm)
        .where(eq(workerWshDenorm.workerId, result.id));
      const empRows = await client
        .select({
          employerId: workerEmploymentDenorm.employerId,
          home: workerEmploymentDenorm.home,
          jobTitle: workerEmploymentDenorm.jobTitle,
        })
        .from(workerEmploymentDenorm)
        .where(eq(workerEmploymentDenorm.workerId, result.id));
      const homeRow = empRows.find((r) => r.home);
      return {
        ...result,
        denormWsId: wsRow?.wsId ?? null,
        denormHomeEmployerId: homeRow?.employerId ?? null,
        denormEmployerIds: empRows.length > 0 ? empRows.map((r) => r.employerId) : null,
        denormJobTitle: homeRow?.jobTitle ?? null,
      };
    },

    async getWorkerByContactId(contactId: string): Promise<Worker | undefined> {
      const client = getClient();
      const [worker] = await client
        .select()
        .from(workers)
        .where(eq(workers.contactId, contactId));
      return worker ? stripWorkerData(worker) : undefined;
    },

    async getWorkersByHomeEmployerId(employerId: string): Promise<Array<{
      id: string;
      siriusId: number | null;
      contactId: string;
      displayName: string | null;
      given: string | null;
      family: string | null;
    }>> {
      const client = getClient();
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
        .innerJoin(
          workerEmploymentDenorm,
          and(
            eq(workerEmploymentDenorm.workerId, workers.id),
            eq(workerEmploymentDenorm.home, true),
          ),
        )
        .where(eq(workerEmploymentDenorm.employerId, employerId))
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
      
      return stripWorkerData(worker);
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
      
      return stripWorkerData(currentWorker);
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
      
      return stripWorkerData(currentWorker);
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
      
      return stripWorkerData(currentWorker);
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
      
      return stripWorkerData(currentWorker);
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
      
      return stripWorkerData(currentWorker);
    },

    async updateWorkerSSN(workerId: string, ssn: string): Promise<Worker | undefined> {
      const client = getClient();
      const validated = await ssnValidate.validateOrThrow({ ssn, workerId });
      
      const [updatedWorker] = await client
        .update(workers)
        .set({ ssn: validated.ssn })
        .where(eq(workers.id, workerId))
        .returning();
      
      return updatedWorker ? stripWorkerData(updatedWorker) : undefined;
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
      
      return updatedWorker ? stripWorkerData(updatedWorker) : undefined;
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

    async getMemberStatusCodesByIndustry(industryId: string, workerIdsList: string[]): Promise<Array<{ workerId: string; code: string }>> {
      if (workerIdsList.length === 0) return [];
      const client = getClient();
      const result = await client.execute(sql`
        SELECT w.id AS "workerId", ms.code AS "code"
        FROM workers w
        CROSS JOIN LATERAL (
          SELECT ms.code
          FROM worker_msh_denorm wmd
          INNER JOIN options_worker_ms ms ON ms.id = wmd.ms_id AND ms.industry_id = ${industryId}
          WHERE wmd.worker_id = w.id
          LIMIT 1
        ) ms
        WHERE w.id IN (${sql.join(workerIdsList.map((id) => sql`${id}`), sql`, `)})
      `);
      const rows = result.rows as unknown as Array<{ workerId: string; code: string | null }>;
      return rows
        .filter((r): r is { workerId: string; code: string } => r.code !== null)
        .map((r) => ({ workerId: r.workerId, code: r.code }));
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
    setData: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: () => 'Updated worker data',
    }
  }
};

