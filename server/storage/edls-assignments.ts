import { 
  createAsyncStorageValidator,
  type ValidationError
} from './utils/validation';
import { 
  edlsAssignments,
  edlsCrews,
  edlsSheets,
  workers,
  contacts,
  type EdlsAssignment, 
  type InsertEdlsAssignment
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { StorageLoggingConfig } from "./middleware/logging";
import { getClient, runInTransaction } from "./transaction-context";

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

export interface EdlsAssignmentsStorage {
  getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]>;
  getBySheetId(sheetId: string): Promise<EdlsAssignmentWithWorker[]>;
  get(id: string): Promise<EdlsAssignment | undefined>;
  create(assignment: InsertEdlsAssignment): Promise<EdlsAssignment>;
  delete(id: string): Promise<boolean>;
  deleteByCrewId(crewId: string): Promise<number>;
  getAvailableWorkersForSheet(employerId: string, sheetYmd: string): Promise<AvailableWorkerForSheet[]>;
  getWorkerAssignmentDetails(workerId: string, sheetYmd: string): Promise<WorkerAssignmentDetails | null>;
}

export function createEdlsAssignmentsStorage(): EdlsAssignmentsStorage {
  return {
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

      return rows.map(row => ({
        ...row.assignment,
        worker: row.worker,
      }));
    },

    async getBySheetId(sheetId: string): Promise<EdlsAssignmentWithWorker[]> {
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
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(workers, eq(edlsAssignments.workerId, workers.id))
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .where(eq(edlsCrews.sheetId, sheetId));

      return rows.map(row => ({
        ...row.assignment,
        worker: row.worker,
      }));
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

    async getAvailableWorkersForSheet(employerId: string, sheetYmd: string): Promise<AvailableWorkerForSheet[]> {
      const client = getClient();
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
          next_asg.status as "nextStatus"
        FROM workers w
        INNER JOIN contacts c ON w.contact_id = c.id
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
        WHERE w.denorm_home_employer_id = ${employerId}
        ORDER BY c.family, c.given
      `);
      return result.rows as unknown as AvailableWorkerForSheet[];
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
          COALESCE(sup_c.display_name, CONCAT(sup_c.given, ' ', sup_c.family)) as "supervisorName",
          CASE 
            WHEN es.ymd < ${sheetYmd} THEN 'prior'
            WHEN es.ymd = ${sheetYmd} THEN 'current'
            WHEN es.ymd > ${sheetYmd} THEN 'next'
          END as "period"
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN edls_sheets es ON ec.sheet_id = es.id
        LEFT JOIN users sup ON ec.supervisor = sup.id
        LEFT JOIN contacts sup_c ON sup.contact_id = sup_c.id
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
  };
}

export const edlsAssignmentsLoggingConfig: StorageLoggingConfig<EdlsAssignmentsStorage> = {
  module: 'edls-assignments',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new',
      getHostEntityId: (args) => args[0]?.crewId,
      getDescription: async () => `Created assignment for worker`,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted assignment ${args[0]}`,
    },
  },
};
