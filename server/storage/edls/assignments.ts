import { 
  createAsyncStorageValidator,
  type ValidationError
} from '../utils/validation';
import { 
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  workers,
  contacts,
  users,
  facilities,
  dispatchJobGroups,
  type EdlsAssignment, 
  type InsertEdlsAssignment
} from "@shared/schema";
import { eq, and, sql, gte, lte, asc, inArray, ne } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";
import { getClient, runInTransaction } from "../transaction-context";
import { createUnifiedOptionsStorage } from "../unified-options";
import { createEdlsCrewsStorage } from "./crews";
import { createReadOnlyStorage } from "../read-only";

export const validate = createAsyncStorageValidator<InsertEdlsAssignment, EdlsAssignment, {}>(
  async (data, existing) => {
    const errors: ValidationError[] = [];
    const client = getClient();
    
    const crewId = data.crewId ?? existing?.crewId;
    
    if (crewId) {
      const crewResult = await client.execute(
        sql`SELECT id, worker_count FROM edls_crews WHERE id = ${crewId} FOR UPDATE`
      );
      const crew = crewResult.rows[0] as { id: string; worker_count: number } | undefined;
      
      if (!crew) {
        errors.push({
          field: 'crewId',
          code: 'CREW_NOT_FOUND',
          message: 'Crew not found'
        });
      } else {
        const countResult = await client.execute(
          sql`SELECT COUNT(*) as count FROM edls_assignments WHERE crew_id = ${crewId}`
        );
        const currentCount = Number((countResult.rows[0] as { count: string })?.count || 0);
        
        const isUpdate = !!existing;
        const effectiveCount = isUpdate ? currentCount : currentCount + 1;
        
        if (effectiveCount > crew.worker_count) {
          errors.push({
            field: 'crewId',
            code: 'CREW_FULL',
            message: 'Crew is already full'
          });
        }
      }
    }
    
    if (errors.length > 0) {
      return { ok: false, errors };
    }
    return { ok: true, value: {} };
  }
);

export interface EdlsAssignmentWithWorker extends EdlsAssignment {
  worker: {
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
    memberStatusId: string | null;
    memberStatusCode: string | null;
    memberStatusName: string | null;
  };
}

export interface AvailableWorkerForSheet {
  id: string;
  siriusId: number | null;
  contactId: string;
  displayName: string | null;
  given: string | null;
  family: string | null;
  priorStatus: string | null;
  currentStatus: string | null;
  nextStatus: string | null;
  ratingValue: number | null;
  memberStatusId: string | null;
  memberStatusName: string | null;
  memberStatusSequence: number | null;
}

export interface WorkerAssignmentDetail {
  sheetId: string;
  sheetName: string;
  sheetYmd: string;
  sheetStatus: string;
  crewId: string;
  crewName: string;
  startTime: string | null;
  endTime: string | null;
  supervisorName: string | null;
}

export interface WorkerAssignmentDetails {
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  prior: WorkerAssignmentDetail | null;
  current: WorkerAssignmentDetail | null;
  next: WorkerAssignmentDetail | null;
}

export interface AssignmentForWorkerFilters {
  startYmd?: string;
  endYmd?: string;
  supervisorId?: string;
  facilityId?: string;
  jobGroupId?: string;
}

export interface AssignmentForWorker {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

export interface DailySummaryByMemberStatusRow {
  memberStatus: string;
  msSequence: number | null;
  sheetStatus: string;
  workerCount: number;
}

export type MemberStatusSummaryRow = DailySummaryByMemberStatusRow;

export interface EdlsAssignmentsStorage {
  getDailySummaryByMemberStatus(ymd: string): Promise<DailySummaryByMemberStatusRow[]>;
  getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]>;
  getBySheetId(sheetId: string, industryId?: string | null): Promise<EdlsAssignmentWithWorker[]>;
  get(id: string): Promise<EdlsAssignment | undefined>;
  create(assignment: InsertEdlsAssignment): Promise<EdlsAssignment>;
  delete(id: string): Promise<boolean>;
  deleteByCrewId(crewId: string): Promise<number>;
  updateData(id: string, data: Record<string, unknown>): Promise<EdlsAssignment | undefined>;
  getAvailableWorkersForSheet(sheetYmd: string, industryId: string | null, ratingId?: string): Promise<AvailableWorkerForSheet[]>;
  getWorkerAssignmentDetails(workerId: string, sheetYmd: string): Promise<WorkerAssignmentDetails | null>;
  getMemberStatusSummaryByYmd(ymd: string): Promise<MemberStatusSummaryRow[]>;
  getAssignmentsForWorker(workerId: string, filters?: AssignmentForWorkerFilters): Promise<AssignmentForWorker[]>;
  getAssignmentsForWorkerIds(workerIds: string[], filters?: AssignmentForWorkerFilters): Promise<Map<string, AssignmentForWorker[]>>;
}

async function sortAssignmentsByClassification(
  assignments: EdlsAssignmentWithWorker[]
): Promise<EdlsAssignmentWithWorker[]> {
  if (assignments.length === 0) {
    return assignments;
  }

  const optionsStorage = createUnifiedOptionsStorage();
  const classifications = await optionsStorage.list("classification");
  
  const classificationPositionMap = new Map<string, number>();
  classifications.forEach((c: { id: string }, index: number) => {
    classificationPositionMap.set(c.id, index);
  });

  return [...assignments].sort((a, b) => {
    const aData = a.data as Record<string, unknown> | null;
    const bData = b.data as Record<string, unknown> | null;
    const aClassificationId = (aData?.classificationId as string) || null;
    const bClassificationId = (bData?.classificationId as string) || null;

    const aPos = aClassificationId ? (classificationPositionMap.get(aClassificationId) ?? Infinity) : Infinity;
    const bPos = bClassificationId ? (classificationPositionMap.get(bClassificationId) ?? Infinity) : Infinity;
    
    if (aPos !== bPos) {
      return aPos - bPos;
    }

    const aFamily = (a.worker.family || '').toLowerCase();
    const bFamily = (b.worker.family || '').toLowerCase();
    if (aFamily !== bFamily) {
      return aFamily.localeCompare(bFamily);
    }

    const aGiven = (a.worker.given || '').toLowerCase();
    const bGiven = (b.worker.given || '').toLowerCase();
    return aGiven.localeCompare(bGiven);
  });
}

export function createEdlsAssignmentsStorage(): EdlsAssignmentsStorage {
  return {
    async getDailySummaryByMemberStatus(ymd: string): Promise<DailySummaryByMemberStatusRow[]> {
      const readOnly = createReadOnlyStorage();
      return readOnly.query(async (client) => {
        const result = await client.execute(sql`
          SELECT
            COALESCE(oms.name, 'Unassigned') AS member_status,
            oms.sequence AS ms_sequence,
            s.status AS sheet_status,
            COUNT(DISTINCT a.worker_id)::int AS worker_count
          FROM edls_assignments a
          JOIN edls_crews c ON c.id = a.crew_id
          JOIN edls_sheets s ON s.id = c.sheet_id
          JOIN workers w ON w.id = a.worker_id
          LEFT JOIN LATERAL (
            SELECT oms2.name, oms2.sequence
            FROM options_worker_ms oms2
            JOIN employers emp ON emp.id = s.employer_id
            WHERE oms2.industry_id = emp.industry_id
              AND oms2.id = ANY(w.denorm_ms_ids)
            ORDER BY oms2.sequence ASC NULLS LAST, oms2.name
            LIMIT 1
          ) oms ON true
          WHERE a.ymd = ${ymd}
            AND s.status != 'trash'
          GROUP BY oms.name, oms.sequence, s.status
          ORDER BY oms.sequence NULLS LAST, oms.name
        `);
        return (result.rows as Array<Record<string, unknown>>).map((row) => ({
          memberStatus: row.member_status as string,
          msSequence: row.ms_sequence === null ? null : Number(row.ms_sequence),
          sheetStatus: row.sheet_status as string,
          workerCount: Number(row.worker_count ?? 0),
        }));
      });
    },

    async getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]> {
      const client = getClient();
      const rows = await client
        .select({
          assignment: edlsAssignments,
          worker: {
            id: workers.id,
            siriusId: workers.siriusId,
            displayName: contacts.displayName,
            given: contacts.given,
            family: contacts.family,
          },
        })
        .from(edlsAssignments)
        .innerJoin(workers, eq(edlsAssignments.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(edlsAssignments.crewId, crewId));

      const unsortedAssignments = rows.map(row => ({
        ...row.assignment,
        worker: {
          ...row.worker,
          memberStatusId: null,
          memberStatusCode: null,
          memberStatusName: null,
        },
      }));

      return sortAssignmentsByClassification(unsortedAssignments);
    },

    async getBySheetId(sheetId: string, industryId?: string | null): Promise<EdlsAssignmentWithWorker[]> {
      const client = getClient();

      // Lateral join to find the worker's member status for the sheet's industry,
      // mirroring the join used by getAvailableWorkersForSheet.
      const memberStatusJoin = industryId
        ? sql`LEFT JOIN LATERAL (
          SELECT ms.id, ms.code, ms.name
          FROM UNNEST(w.denorm_ms_ids) AS ms_id
          INNER JOIN options_worker_ms ms ON ms.id = ms_id AND ms.industry_id = ${industryId}
          LIMIT 1
        ) member_status ON true`
        : sql``;
      const memberStatusSelect = industryId
        ? sql`member_status.id as "memberStatusId", member_status.code as "memberStatusCode", member_status.name as "memberStatusName"`
        : sql`NULL::varchar as "memberStatusId", NULL::varchar as "memberStatusCode", NULL::varchar as "memberStatusName"`;

      interface RawSheetAssignmentRow {
        id: string;
        ymd: string;
        workerId: string;
        crewId: string;
        data: unknown;
        workerRowId: string;
        siriusId: number | null;
        displayName: string | null;
        given: string | null;
        family: string | null;
        memberStatusId: string | null;
        memberStatusCode: string | null;
        memberStatusName: string | null;
      }

      const result = await client.execute(sql`
        SELECT
          ea.id,
          ea.ymd,
          ea.worker_id as "workerId",
          ea.crew_id as "crewId",
          ea.data,
          w.id as "workerRowId",
          w.sirius_id as "siriusId",
          c.display_name as "displayName",
          c.given,
          c.family,
          ${memberStatusSelect}
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN workers w ON ea.worker_id = w.id
        INNER JOIN contacts c ON w.contact_id = c.id
        ${memberStatusJoin}
        WHERE ec.sheet_id = ${sheetId}
      `);

      const rows = result.rows as unknown as RawSheetAssignmentRow[];
      const unsortedAssignments: EdlsAssignmentWithWorker[] = rows.map((row) => ({
        id: row.id,
        ymd: row.ymd,
        workerId: row.workerId,
        crewId: row.crewId,
        data: row.data,
        worker: {
          id: row.workerRowId,
          siriusId: row.siriusId,
          displayName: row.displayName,
          given: row.given,
          family: row.family,
          memberStatusId: row.memberStatusId,
          memberStatusCode: row.memberStatusCode,
          memberStatusName: row.memberStatusName,
        },
      }));

      return sortAssignmentsByClassification(unsortedAssignments);
    },

    async get(id: string): Promise<EdlsAssignment | undefined> {
      const client = getClient();
      const [assignment] = await client.select().from(edlsAssignments).where(eq(edlsAssignments.id, id));
      return assignment || undefined;
    },

    async create(insertAssignment: InsertEdlsAssignment): Promise<EdlsAssignment> {
      return runInTransaction(async () => {
        await validate.validateOrThrow(insertAssignment);
        const client = getClient();
        const [assignment] = await client.insert(edlsAssignments).values(insertAssignment).returning();
        return assignment;
      });
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(edlsAssignments).where(eq(edlsAssignments.id, id)).returning();
      return result.length > 0;
    },

    async deleteByCrewId(crewId: string): Promise<number> {
      const client = getClient();
      const result = await client.delete(edlsAssignments).where(eq(edlsAssignments.crewId, crewId)).returning();
      return result.length;
    },

    async updateData(id: string, data: Record<string, unknown>): Promise<EdlsAssignment | undefined> {
      const client = getClient();
      const [assignment] = await client
        .update(edlsAssignments)
        .set({ data })
        .where(eq(edlsAssignments.id, id))
        .returning();
      return assignment || undefined;
    },

    async getAvailableWorkersForSheet(sheetYmd: string, industryId: string | null, ratingId?: string): Promise<AvailableWorkerForSheet[]> {
      const client = getClient();
      
      // Build query with optional rating join
      const ratingJoin = ratingId 
        ? sql`INNER JOIN worker_ratings wr ON wr.worker_id = w.id AND wr.rating_id = ${ratingId}`
        : sql``;
      const ratingSelect = ratingId
        ? sql`wr.value as "ratingValue"`
        : sql`NULL::integer as "ratingValue"`;
      
      // Build member status join - uses UNNEST on denorm_ms_ids to find the member status for the employer's industry
      const memberStatusJoin = industryId
        ? sql`LEFT JOIN LATERAL (
          SELECT ms.id, ms.name, ms.sequence
          FROM UNNEST(w.denorm_ms_ids) AS ms_id
          INNER JOIN options_worker_ms ms ON ms.id = ms_id AND ms.industry_id = ${industryId}
          LIMIT 1
        ) member_status ON true`
        : sql``;
      const memberStatusSelect = industryId
        ? sql`member_status.id as "memberStatusId", member_status.name as "memberStatusName", member_status.sequence as "memberStatusSequence"`
        : sql`NULL::varchar as "memberStatusId", NULL::varchar as "memberStatusName", NULL::integer as "memberStatusSequence"`;
      
      // Order by member status sequence first (nulls last), then by rating (if provided), then by name
      // When industryId is null, skip member status ordering since the lateral join is not included
      let orderBy;
      if (industryId && ratingId) {
        orderBy = sql`ORDER BY COALESCE(member_status.sequence, 999999), wr.value DESC, c.family, c.given`;
      } else if (industryId) {
        orderBy = sql`ORDER BY COALESCE(member_status.sequence, 999999), c.family, c.given`;
      } else if (ratingId) {
        orderBy = sql`ORDER BY wr.value DESC, c.family, c.given`;
      } else {
        orderBy = sql`ORDER BY c.family, c.given`;
      }
      
      const result = await client.execute(sql`
        SELECT 
          w.id,
          w.sirius_id as "siriusId",
          w.contact_id as "contactId",
          c.display_name as "displayName",
          c.given,
          c.family,
          prior_asg.status as "priorStatus",
          current_asg.status as "currentStatus",
          next_asg.status as "nextStatus",
          ${ratingSelect},
          ${memberStatusSelect}
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
        INNER JOIN worker_edls we ON we.worker_id = w.id
        ${ratingJoin}
        ${memberStatusJoin}
        LEFT JOIN LATERAL (
          SELECT es.status
          FROM edls_assignments ea
          INNER JOIN edls_crews ec ON ea.crew_id = ec.id
          INNER JOIN edls_sheets es ON ec.sheet_id = es.id
          WHERE ea.worker_id = w.id AND es.ymd < ${sheetYmd}
          ORDER BY es.ymd DESC
          LIMIT 1
        ) prior_asg ON true
        LEFT JOIN LATERAL (
          SELECT es.status
          FROM edls_assignments ea
          INNER JOIN edls_crews ec ON ea.crew_id = ec.id
          INNER JOIN edls_sheets es ON ec.sheet_id = es.id
          WHERE ea.worker_id = w.id AND es.ymd = ${sheetYmd}
          LIMIT 1
        ) current_asg ON true
        LEFT JOIN LATERAL (
          SELECT es.status
          FROM edls_assignments ea
          INNER JOIN edls_crews ec ON ea.crew_id = ec.id
          INNER JOIN edls_sheets es ON ec.sheet_id = es.id
          WHERE ea.worker_id = w.id AND es.ymd > ${sheetYmd}
          ORDER BY es.ymd ASC
          LIMIT 1
        ) next_asg ON true
        WHERE we.active = true
        ${orderBy}
      `);
      return result.rows as unknown as AvailableWorkerForSheet[];
    },

    async getAssignmentsForWorker(
      workerId: string,
      filters?: AssignmentForWorkerFilters
    ): Promise<AssignmentForWorker[]> {
      const client = getClient();
      const conditions = [
        eq(edlsAssignments.workerId, workerId),
        ne(edlsSheets.status, 'trash'),
      ];
      if (filters?.startYmd) conditions.push(gte(edlsSheets.ymd, filters.startYmd));
      if (filters?.endYmd) conditions.push(lte(edlsSheets.ymd, filters.endYmd));
      if (filters?.supervisorId) conditions.push(eq(edlsSheets.supervisor, filters.supervisorId));
      if (filters?.facilityId) conditions.push(eq(edlsSheets.facilityId, filters.facilityId));
      if (filters?.jobGroupId) conditions.push(eq(edlsSheets.jobGroupId, filters.jobGroupId));

      const rows = await client
        .select({
          assignmentId: edlsAssignments.id,
          assignmentData: edlsAssignments.data,
          ymd: edlsSheets.ymd,
          sheetId: edlsSheets.id,
          sheetTitle: edlsSheets.title,
          sheetStatus: edlsSheets.status,
          crewId: edlsCrews.id,
          crewTitle: edlsCrews.title,
          startTime: edlsCrews.startTime,
          endTime: edlsCrews.endTime,
          supervisorId: users.id,
          supervisorFirstName: users.firstName,
          supervisorLastName: users.lastName,
          supervisorEmail: users.email,
          facilityId: facilities.id,
          facilityName: facilities.name,
          jobGroupId: dispatchJobGroups.id,
          jobGroupName: dispatchJobGroups.name,
        })
        .from(edlsAssignments)
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(edlsSheets, eq(edlsCrews.sheetId, edlsSheets.id))
        .leftJoin(users, eq(edlsSheets.supervisor, users.id))
        .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
        .leftJoin(dispatchJobGroups, eq(edlsSheets.jobGroupId, dispatchJobGroups.id))
        .where(and(...conditions))
        .orderBy(asc(edlsSheets.ymd), asc(edlsCrews.startTime));

      return rows.map((r) => ({
        assignmentId: r.assignmentId,
        ymd: r.ymd,
        sheetId: r.sheetId,
        sheetTitle: r.sheetTitle,
        sheetStatus: r.sheetStatus,
        crewId: r.crewId,
        crewTitle: r.crewTitle,
        startTime: r.startTime,
        endTime: r.endTime,
        supervisor: r.supervisorId
          ? {
              id: r.supervisorId,
              firstName: r.supervisorFirstName,
              lastName: r.supervisorLastName,
              email: r.supervisorEmail!,
            }
          : null,
        facility: r.facilityId ? { id: r.facilityId, name: r.facilityName! } : null,
        jobGroup: r.jobGroupId ? { id: r.jobGroupId, name: r.jobGroupName! } : null,
        data: (r.assignmentData as Record<string, unknown> | null) ?? null,
      }));
    },

    async getAssignmentsForWorkerIds(
      workerIds: string[],
      filters?: AssignmentForWorkerFilters
    ): Promise<Map<string, AssignmentForWorker[]>> {
      const result = new Map<string, AssignmentForWorker[]>();
      for (const id of workerIds) result.set(id, []);
      if (workerIds.length === 0) return result;

      const client = getClient();
      const conditions = [
        inArray(edlsAssignments.workerId, workerIds),
        ne(edlsSheets.status, 'trash'),
      ];
      if (filters?.startYmd) conditions.push(gte(edlsSheets.ymd, filters.startYmd));
      if (filters?.endYmd) conditions.push(lte(edlsSheets.ymd, filters.endYmd));
      if (filters?.supervisorId) conditions.push(eq(edlsSheets.supervisor, filters.supervisorId));
      if (filters?.facilityId) conditions.push(eq(edlsSheets.facilityId, filters.facilityId));
      if (filters?.jobGroupId) conditions.push(eq(edlsSheets.jobGroupId, filters.jobGroupId));

      const rows = await client
        .select({
          workerId: edlsAssignments.workerId,
          assignmentId: edlsAssignments.id,
          assignmentData: edlsAssignments.data,
          ymd: edlsSheets.ymd,
          sheetId: edlsSheets.id,
          sheetTitle: edlsSheets.title,
          sheetStatus: edlsSheets.status,
          crewId: edlsCrews.id,
          crewTitle: edlsCrews.title,
          startTime: edlsCrews.startTime,
          endTime: edlsCrews.endTime,
          supervisorId: users.id,
          supervisorFirstName: users.firstName,
          supervisorLastName: users.lastName,
          supervisorEmail: users.email,
          facilityId: facilities.id,
          facilityName: facilities.name,
          jobGroupId: dispatchJobGroups.id,
          jobGroupName: dispatchJobGroups.name,
        })
        .from(edlsAssignments)
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(edlsSheets, eq(edlsCrews.sheetId, edlsSheets.id))
        .leftJoin(users, eq(edlsSheets.supervisor, users.id))
        .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
        .leftJoin(dispatchJobGroups, eq(edlsSheets.jobGroupId, dispatchJobGroups.id))
        .where(and(...conditions))
        .orderBy(asc(edlsSheets.ymd), asc(edlsCrews.startTime));

      for (const r of rows) {
        const item: AssignmentForWorker = {
          assignmentId: r.assignmentId,
          ymd: r.ymd,
          sheetId: r.sheetId,
          sheetTitle: r.sheetTitle,
          sheetStatus: r.sheetStatus,
          crewId: r.crewId,
          crewTitle: r.crewTitle,
          startTime: r.startTime,
          endTime: r.endTime,
          supervisor: r.supervisorId
            ? {
                id: r.supervisorId,
                firstName: r.supervisorFirstName,
                lastName: r.supervisorLastName,
                email: r.supervisorEmail!,
              }
            : null,
          facility: r.facilityId ? { id: r.facilityId, name: r.facilityName! } : null,
          jobGroup: r.jobGroupId ? { id: r.jobGroupId, name: r.jobGroupName! } : null,
          data: (r.assignmentData as Record<string, unknown> | null) ?? null,
        };
        const list = result.get(r.workerId);
        if (list) list.push(item);
      }
      return result;
    },

    async getWorkerAssignmentDetails(workerId: string, sheetYmd: string): Promise<WorkerAssignmentDetails | null> {
      const client = getClient();
      
      const workerResult = await client.execute(sql`
        SELECT 
          w.id as "workerId",
          w.sirius_id as "siriusId",
          c.display_name as "displayName",
          c.given,
          c.family
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
        WHERE w.id = ${workerId}
      `);
      
      if (workerResult.rows.length === 0) {
        return null;
      }
      
      const worker = workerResult.rows[0] as {
        workerId: string;
        siriusId: number | null;
        displayName: string | null;
        given: string | null;
        family: string | null;
      };

      const assignmentsResult = await client.execute(sql`
        SELECT 
          es.id as "sheetId",
          es.title as "sheetName",
          es.ymd as "sheetYmd",
          es.status as "sheetStatus",
          ec.id as "crewId",
          ec.title as "crewName",
          ec.start_time as "startTime",
          ec.end_time as "endTime",
          CONCAT(sup.first_name, ' ', sup.last_name) as "supervisorName",
          CASE 
            WHEN es.ymd < ${sheetYmd} THEN 'prior'
            WHEN es.ymd = ${sheetYmd} THEN 'current'
            WHEN es.ymd > ${sheetYmd} THEN 'next'
          END as "period"
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN edls_sheets es ON ec.sheet_id = es.id
        LEFT JOIN users sup ON ec.supervisor = sup.id
        WHERE ea.worker_id = ${workerId}
          AND (
            (es.ymd < ${sheetYmd} AND es.ymd = (
              SELECT MAX(es2.ymd) FROM edls_assignments ea2
              INNER JOIN edls_crews ec2 ON ea2.crew_id = ec2.id
              INNER JOIN edls_sheets es2 ON ec2.sheet_id = es2.id
              WHERE ea2.worker_id = ${workerId} AND es2.ymd < ${sheetYmd}
            ))
            OR es.ymd = ${sheetYmd}
            OR (es.ymd > ${sheetYmd} AND es.ymd = (
              SELECT MIN(es2.ymd) FROM edls_assignments ea2
              INNER JOIN edls_crews ec2 ON ea2.crew_id = ec2.id
              INNER JOIN edls_sheets es2 ON ec2.sheet_id = es2.id
              WHERE ea2.worker_id = ${workerId} AND es2.ymd > ${sheetYmd}
            ))
          )
        ORDER BY es.ymd
      `);

      let prior: WorkerAssignmentDetail | null = null;
      let current: WorkerAssignmentDetail | null = null;
      let next: WorkerAssignmentDetail | null = null;

      for (const row of assignmentsResult.rows) {
        const detail = row as unknown as WorkerAssignmentDetail & { period: string };
        const assignmentDetail: WorkerAssignmentDetail = {
          sheetId: detail.sheetId,
          sheetName: detail.sheetName,
          sheetYmd: detail.sheetYmd,
          sheetStatus: detail.sheetStatus,
          crewId: detail.crewId,
          crewName: detail.crewName,
          startTime: detail.startTime,
          endTime: detail.endTime,
          supervisorName: detail.supervisorName,
        };

        if (detail.period === 'prior') {
          prior = assignmentDetail;
        } else if (detail.period === 'current') {
          current = assignmentDetail;
        } else if (detail.period === 'next') {
          next = assignmentDetail;
        }
      }

      return {
        ...worker,
        prior,
        current,
        next,
      };
    },

    async getMemberStatusSummaryByYmd(ymd: string): Promise<MemberStatusSummaryRow[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          COALESCE(oms.name, 'Unassigned') AS "memberStatus",
          oms.sequence AS "msSequence",
          s.status AS "sheetStatus",
          COUNT(DISTINCT a.worker_id)::int AS "workerCount"
        FROM edls_assignments a
        JOIN edls_crews c ON c.id = a.crew_id
        JOIN edls_sheets s ON s.id = c.sheet_id
        JOIN workers w ON w.id = a.worker_id
        LEFT JOIN LATERAL (
          SELECT oms2.name, oms2.sequence
          FROM options_worker_ms oms2
          JOIN employers emp ON emp.id = s.employer_id
          WHERE oms2.industry_id = emp.industry_id
            AND oms2.id = ANY(w.denorm_ms_ids)
          ORDER BY oms2.sequence ASC NULLS LAST, oms2.name
          LIMIT 1
        ) oms ON true
        WHERE a.ymd = ${ymd}
          AND s.status != 'trash'
        GROUP BY oms.name, oms.sequence, s.status
        ORDER BY oms.sequence NULLS LAST, oms.name
      `);
      return result.rows as unknown as MemberStatusSummaryRow[];
    },
  };
}

async function getSheetIdFromCrewId(crewId: string): Promise<string | undefined> {
  const crewsStorage = createEdlsCrewsStorage();
  const crew = await crewsStorage.get(crewId);
  return crew?.sheetId;
}

async function getWorkerDescription(workerId: string): Promise<string> {
  const client = getClient();
  const [row] = await client
    .select({
      siriusId: workers.siriusId,
      displayName: contacts.displayName,
      given: contacts.given,
      family: contacts.family,
    })
    .from(workers)
    .innerJoin(contacts, eq(workers.contactId, contacts.id))
    .where(eq(workers.id, workerId));

  if (!row) return 'unknown worker';

  const name = row.family && row.given 
    ? `${row.family}, ${row.given}`
    : row.displayName || 'unknown';
  
  return row.siriusId ? `${name} (${row.siriusId})` : name;
}

export const edlsAssignmentsLoggingConfig = defineLoggingConfig<EdlsAssignmentsStorage>({
  module: 'edls-assignments',
  // No module-level stateKey — `before` for delete/updateData augments the
  // raw assignment row with a `workerDesc` lookup, and `after` is suppressed
  // (set explicitly to undefined) so legacy logs stay byte-identical.
  methods: {
    create: {
      entityIdFallback: 'new',
      after: undefined,
      getHostEntityId: async (args) => {
        const crewId = args[0]?.crewId;
        if (!crewId) return undefined;
        return getSheetIdFromCrewId(crewId);
      },
      getDescription: async (args, result) => {
        const workerId = result?.workerId || args[0]?.workerId;
        if (!workerId) return 'Created assignment';
        const workerDesc = await getWorkerDescription(workerId);
        return `Created assignment for ${workerDesc}`;
      },
    },
    delete: {
      before: async (args, storage) => {
        const assignment = await storage.get(args[0]);
        if (!assignment) return undefined;
        const workerDesc = await getWorkerDescription(assignment.workerId);
        return { ...assignment, workerDesc };
      },
      getHostEntityId: async (_args, _result, beforeState) => {
        const crewId = beforeState?.crewId;
        if (!crewId) return undefined;
        return getSheetIdFromCrewId(crewId);
      },
      getDescription: async (_args, _result, beforeState) => {
        const workerDesc = beforeState?.workerDesc || 'unknown worker';
        return `Deleted assignment for ${workerDesc}`;
      },
    },
    updateData: {
      before: async (args, storage) => {
        const assignment = await storage.get(args[0]);
        if (!assignment) return undefined;
        const workerDesc = await getWorkerDescription(assignment.workerId);
        return { ...assignment, workerDesc };
      },
      after: undefined,
      getHostEntityId: async (_args, result, beforeState) => {
        const crewId = beforeState?.crewId || result?.crewId;
        if (!crewId) return undefined;
        return getSheetIdFromCrewId(crewId);
      },
      getDescription: async (_args, _result, beforeState) => {
        const workerDesc = beforeState?.workerDesc || 'unknown worker';
        return `Updated assignment for ${workerDesc}`;
      },
    },
  },
});
