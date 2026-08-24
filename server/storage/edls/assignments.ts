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
  employers,
  dispatchJobGroups,
  optionsDepartment,
  optionsEdlsShowStatus,
  optionsEdlsTasks,
  type EdlsAssignment, 
  type InsertEdlsAssignment
} from "@shared/schema";
import { eq, and, sql, gt, gte, lte, asc, inArray, ne } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";
import { getClient, runInTransaction } from "../transaction-context";
import { createUnifiedOptionsStorage } from "../unified-options";
import { createEdlsCrewsStorage } from "./crews";
import { isComponentEnabledSync } from "../../services/component-cache";
import type { SnapshotNode } from "@shared/snapshots";

/**
 * The dispatch_job_group table is owned by the `dispatch.job_group`
 * component; it may not exist in the database when that component is
 * disabled. All reads must gate their join on this check.
 */
function jobGroupsEnabled(): boolean {
  return isComponentEnabledSync("dispatch.job_group");
}

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
  /**
   * Status of the communication `commId` points at, or null when the
   * assignment has no linked communication (or the reader does not join it).
   */
  commStatus?: string | null;
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
  /** Strictly-after date bound (ymd > afterYmd), e.g. "next assignment after this sheet". */
  afterYmd?: string;
  startYmd?: string;
  endYmd?: string;
  supervisorId?: string;
  facilityId?: string;
  jobGroupId?: string;
  /**
   * Restrict to sheets in one of these statuses. When omitted the only
   * exclusion is `trash` (the historic default every caller relies on).
   * Callers that publish assignments outside the staff screens — e.g. the
   * public worker schedule page — name the statuses they accept explicitly
   * rather than post-filtering the rows.
   */
  sheetStatuses?: string[];
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
  /** Crew check-in location, as entered on the crew row. */
  location: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  employer: { id: string; name: string } | null;
  showStatus: { id: string; name: string } | null;
  task: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

export interface DailySummaryByMemberStatusRow {
  memberStatus: string;
  msSequence: number | null;
  sheetStatus: string;
  workerCount: number;
}

export type MemberStatusSummaryRow = DailySummaryByMemberStatusRow;

export interface OutOfPopulationAssignmentRow {
  assignmentId: string;
  sheetId: string;
  sheetTitle: string;
  sheetYmd: string;
  workerId: string;
  siriusId: number | null;
  displayName: string | null;
  startTime: string | null;
  taskName: string | null;
  departmentName: string | null;
  supervisorName: string | null;
}

/**
 * One assignment on a sheet, resolved down to the single phone number an SMS
 * to that worker would actually go to: their contact's ACTIVE PRIMARY number.
 * Assignments whose worker has no such number are left out entirely — a
 * caller pre-filtering recipients must not have to guess which of several
 * numbers the send layer would pick.
 */
export interface SheetAssignmentSmsTarget {
  assignmentId: string;
  workerId: string;
  contactId: string;
  phoneNumber: string;
  /**
   * The assignment's values as they stood when this target was resolved.
   * Hand it back to `setCommId` so a message that goes out just before the
   * row is edited is not recorded as a receipt for the superseded version.
   */
  data: unknown;
}
export interface EdlsAssignmentsStorage {
  getByCrewId(crewId: string): Promise<EdlsAssignmentWithWorker[]>;
  getBySheetId(sheetId: string, industryId?: string | null): Promise<EdlsAssignmentWithWorker[]>;
  /**
   * Every assignment on a sheet that is still WAITING TO BE TEXTED: the
   * worker has an active primary phone number, and the assignment carries no
   * receipt (`commId`) for the values it currently holds. One query, because
   * notifiers fan out per sheet and a per-assignment worker → contact → phone
   * walk would be N round-trips. Ordered by assignment id so a worker
   * appearing twice on a sheet resolves to the same assignment every time.
   *
   * The receipt condition lives here rather than in the notifier because this
   * read is the single place that decides who is texted, which assignment
   * their link names, and which row the send is recorded against. An
   * unchanged sheet arriving at a trigger status again therefore resolves to
   * nobody, and the dispatcher stops on its own.
   */
  getSmsTargetsBySheetId(sheetId: string): Promise<SheetAssignmentSmsTarget[]>;
  get(id: string): Promise<EdlsAssignment | undefined>;
  create(assignment: InsertEdlsAssignment): Promise<EdlsAssignment>;
  delete(id: string): Promise<boolean>;
  deleteByCrewId(crewId: string): Promise<number>;
  /**
   * Replace an assignment's extra values.
   *
   * Voids the assignment's receipt (`commId`) whenever the values genuinely
   * change, because the worker has then not been told about the assignment as
   * it now stands. A save that changes nothing leaves the receipt alone.
   */
  updateData(id: string, data: Record<string, unknown>): Promise<EdlsAssignment | undefined>;
  /**
   * Record the communication a worker was sent about this assignment — the
   * receipt saying they have been told about it as it stood when the message
   * went out. Holding one is what keeps the worker out of the next send.
   *
   * Deliberately narrow: the link is provenance owned by whatever sent the
   * message (which is why the insert schema omits the field), so it is set
   * here rather than through a general-purpose update a caller could reach
   * with a request body. The column holds ONE value — a later message to the
   * same worker replaces an earlier one, making this the most recent message
   * about the assignment rather than a history of every message. "Later"
   * means later SENT, not later written: a message that overtook an earlier
   * one in flight does not get demoted by it.
   *
   * `dataWhenResolved` is the assignment's values as the sender saw them
   * (`SheetAssignmentSmsTarget.data`). A row edited since then is a different
   * assignment than the one that was messaged about, and stamping the receipt
   * on it would quietly cost that worker the re-notification the edit earned
   * them, so the write is refused.
   *
   * Returns false when nothing was recorded — no such assignment (it can be
   * deleted between the message going out and this write landing), a more
   * recent message already on record, or the assignment changed underneath
   * the send. All three are benign; the worker was texted either way.
   */
  setCommId(id: string, commId: string, dataWhenResolved: unknown): Promise<boolean>;
  getAvailableWorkersForSheet(sheetYmd: string, industryId: string | null, ratingId?: string): Promise<AvailableWorkerForSheet[]>;
  /**
   * Report query: every assignment on a future (ymd >= fromYmd), non-trash
   * sheet whose worker is NOT in the EDLS scheduling population (no
   * `worker_edls` row with `active = true` — the same population rule as
   * `getAvailableWorkersForSheet`).
   */
  getFutureOutOfPopulationAssignments(fromYmd: string): Promise<OutOfPopulationAssignmentRow[]>;
  getWorkerAssignmentDetails(workerId: string, sheetYmd: string): Promise<WorkerAssignmentDetails | null>;
  getMemberStatusSummaryByYmd(ymd: string): Promise<MemberStatusSummaryRow[]>;
  getAssignmentsForWorker(workerId: string, filters?: AssignmentForWorkerFilters): Promise<AssignmentForWorker[]>;
  getAssignmentsForWorkerIds(workerIds: string[], filters?: AssignmentForWorkerFilters): Promise<Map<string, AssignmentForWorker[]>>;
  /**
   * Snapshot export: versioned assignment bundles (worker captured as a
   * rendered stub, including member status for the given industry), grouped
   * by crew id. See `shared/snapshots.ts` for the bundle contract.
   */
  exportBySheetId(sheetId: string, industryId?: string | null): Promise<Map<string, SnapshotNode[]>>;
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

/**
 * SQL predicate: the assignment row's stored `data` still means what `data`
 * means.
 *
 * Nulls are stripped from both sides, so a key that is absent and the same
 * key explicitly set to null are the same value. That is what makes a no-op
 * save a no-op: the edit dialog posts all three extras every time, while an
 * assignment nobody has edited stores no `data` at all, and the two must not
 * read as a change.
 */
function assignmentDataUnchanged(data: unknown) {
  const json = JSON.stringify(data ?? {});
  return sql`jsonb_strip_nulls(COALESCE(${edlsAssignments.data}, '{}'::jsonb)) = jsonb_strip_nulls(${json}::jsonb)`;
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

    async exportBySheetId(sheetId: string, industryId?: string | null): Promise<Map<string, SnapshotNode[]>> {
      const assignments = await this.getBySheetId(sheetId, industryId ?? null);
      const byCrewId = new Map<string, SnapshotNode[]>();
      for (const assignment of assignments) {
        const nodes = byCrewId.get(assignment.crewId) ?? [];
        nodes.push({ version: 1, data: assignment });
        byCrewId.set(assignment.crewId, nodes);
      }
      return byCrewId;
    },

    async getBySheetId(sheetId: string, industryId?: string | null): Promise<EdlsAssignmentWithWorker[]> {
      const client = getClient();

      // Lateral join to find the worker's member status for the sheet's industry,
      // mirroring the join used by getAvailableWorkersForSheet.
      const memberStatusJoin = industryId
        ? sql`LEFT JOIN LATERAL (
          SELECT ms.id, ms.code, ms.name
          FROM worker_msh_denorm wmd
          INNER JOIN options_worker_ms ms ON ms.id = wmd.ms_id AND ms.industry_id = ${industryId}
          WHERE wmd.worker_id = w.id
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
        commId: string | null;
        commStatus: string | null;
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
          ea.comm_id as "commId",
          cm.status as "commStatus",
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
        LEFT JOIN comm cm ON cm.id = ea.comm_id
        ${memberStatusJoin}
        WHERE ec.sheet_id = ${sheetId}
      `);

      const rows = result.rows as unknown as RawSheetAssignmentRow[];
      const unsortedAssignments: EdlsAssignmentWithWorker[] = rows.map((row) => ({
        id: row.id,
        ymd: row.ymd,
        workerId: row.workerId,
        crewId: row.crewId,
        commId: row.commId,
        commStatus: row.commStatus,
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

    async getSmsTargetsBySheetId(sheetId: string): Promise<SheetAssignmentSmsTarget[]> {
      const client = getClient();

      // The phone is resolved here, in the same pass, and only the ACTIVE
      // PRIMARY one: that is the number the SMS send layer picks for a
      // contact, so a caller filtering on it filters on the number the
      // message would really go to. A worker with no active primary number
      // drops out of the result rather than coming back phone-less.
      //
      // `comm_id IS NULL` is the receipt condition: a worker already told
      // about the assignment as it currently stands is not a target. Editing
      // the assignment voids that receipt, which is what puts them back in
      // this result for the next send.
      const result = await client.execute(sql`
        SELECT
          ea.id as "assignmentId",
          ea.worker_id as "workerId",
          c.id as "contactId",
          ph.phone_number as "phoneNumber",
          ea.data as "data"
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN workers w ON ea.worker_id = w.id
        INNER JOIN contacts c ON w.contact_id = c.id
        INNER JOIN LATERAL (
          SELECT p.phone_number
          FROM contact_phone p
          WHERE p.contact_id = c.id
            AND p.is_active = true
            AND p.is_primary = true
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT 1
        ) ph ON true
        WHERE ec.sheet_id = ${sheetId}
          AND ea.comm_id IS NULL
        ORDER BY ea.id ASC
      `);

      return result.rows as unknown as SheetAssignmentSmsTarget[];
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
      // Voiding the receipt is part of the assignment write itself, not
      // something every future writer has to remember: a worker told about an
      // assignment has not been told about the one it just became. Expressed
      // in the UPDATE rather than as a read-then-write, so the comparison is
      // against the row actually being overwritten.
      //
      // Only a REAL change voids it. Re-saving the same values must leave the
      // receipt standing, or the note dialog becomes a resend button by
      // accident.
      const [assignment] = await client
        .update(edlsAssignments)
        .set({
          data,
          commId: sql`CASE WHEN ${assignmentDataUnchanged(data)} THEN ${edlsAssignments.commId} ELSE NULL END`,
        })
        .where(eq(edlsAssignments.id, id))
        .returning();
      return assignment || undefined;
    },

    async setCommId(id: string, commId: string, dataWhenResolved: unknown): Promise<boolean> {
      const client = getClient();
      // Order by WHEN THE MESSAGES WERE SENT, not by which bookkeeping write
      // arrives first. Two sends racing (a sheet saved twice in quick
      // succession) finish their post-send writes in provider-latency order,
      // so an unconditional update can leave the older text recorded. The
      // guard makes "most recent message" true regardless of that ordering.
      const result = await client
        .update(edlsAssignments)
        .set({ commId })
        .where(
          and(
            eq(edlsAssignments.id, id),
            // The row must still be the assignment the message was about. A
            // coordinator can edit it in the moment between the text going
            // out and this write landing; that edit voided the receipt on
            // purpose, and stamping the superseded message back on would
            // silently cost the worker their re-notification.
            assignmentDataUnchanged(dataWhenResolved),
            sql`(
              ${edlsAssignments.commId} IS NULL
              OR EXISTS (
                SELECT 1 FROM comm c_new, comm c_old
                WHERE c_new.id = ${commId}
                  AND c_old.id = ${edlsAssignments.commId}
                  AND COALESCE(c_new.sent, 'epoch'::timestamp)
                      >= COALESCE(c_old.sent, 'epoch'::timestamp)
              )
            )`,
          ),
        )
        .returning({ id: edlsAssignments.id });
      return result.length > 0;
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
      
      // Build member status join - uses worker_msh_denorm to find the member status for the employer's industry
      const memberStatusJoin = industryId
        ? sql`LEFT JOIN LATERAL (
          SELECT ms.id, ms.name, ms.sequence
          FROM worker_msh_denorm wmd
          INNER JOIN options_worker_ms ms ON ms.id = wmd.ms_id AND ms.industry_id = ${industryId}
          WHERE wmd.worker_id = w.id
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

    async getFutureOutOfPopulationAssignments(fromYmd: string): Promise<OutOfPopulationAssignmentRow[]> {
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          ea.id as "assignmentId",
          es.id as "sheetId",
          es.title as "sheetTitle",
          es.ymd as "sheetYmd",
          w.id as "workerId",
          w.sirius_id as "siriusId",
          c.display_name as "displayName",
          COALESCE(NULLIF(ea.data->>'startTime', ''), ec.start_time::text) as "startTime",
          t.name as "taskName",
          d.name as "departmentName",
          COALESCE(
            NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), ''),
            su.email,
            NULLIF(TRIM(CONCAT(cu.first_name, ' ', cu.last_name)), ''),
            cu.email
          ) as "supervisorName"
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN edls_sheets es ON ec.sheet_id = es.id
        INNER JOIN workers w ON ea.worker_id = w.id
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN worker_edls we ON we.worker_id = w.id
        LEFT JOIN options_edls_tasks t ON ec.task_id = t.id
        LEFT JOIN options_department d ON es.department_id = d.id
        LEFT JOIN users su ON es.supervisor = su.id
        LEFT JOIN users cu ON ec.supervisor = cu.id
        WHERE es.ymd >= ${fromYmd}
          AND es.status != 'trash'
          AND (we.id IS NULL OR we.active = false)
        ORDER BY es.ymd ASC, es.title ASC, c.family ASC, c.given ASC
      `);
      return result.rows as unknown as OutOfPopulationAssignmentRow[];
    },

    async getAssignmentsForWorker(
      workerId: string,
      filters?: AssignmentForWorkerFilters
    ): Promise<AssignmentForWorker[]> {
      const client = getClient();
      const conditions = [
        eq(edlsAssignments.workerId, workerId),
        filters?.sheetStatuses
          ? inArray(edlsSheets.status, filters.sheetStatuses)
          : ne(edlsSheets.status, 'trash'),
      ];
      if (filters?.afterYmd) conditions.push(gt(edlsSheets.ymd, filters.afterYmd));
      if (filters?.startYmd) conditions.push(gte(edlsSheets.ymd, filters.startYmd));
      if (filters?.endYmd) conditions.push(lte(edlsSheets.ymd, filters.endYmd));
      if (filters?.supervisorId) conditions.push(eq(edlsSheets.supervisor, filters.supervisorId));
      if (filters?.facilityId) conditions.push(eq(edlsSheets.facilityId, filters.facilityId));
      if (filters?.jobGroupId) conditions.push(eq(edlsSheets.jobGroupId, filters.jobGroupId));

      const withJobGroups = jobGroupsEnabled();
      const baseQuery = client
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
          location: edlsCrews.location,
          supervisorId: users.id,
          supervisorFirstName: users.firstName,
          supervisorLastName: users.lastName,
          supervisorEmail: users.email,
          facilityId: facilities.id,
          facilityName: facilities.name,
          departmentId: optionsDepartment.id,
          departmentName: optionsDepartment.name,
          employerId: employers.id,
          employerName: employers.name,
          showStatusId: optionsEdlsShowStatus.id,
          showStatusName: optionsEdlsShowStatus.name,
          taskId: optionsEdlsTasks.id,
          taskName: optionsEdlsTasks.name,
          jobGroupId: withJobGroups ? dispatchJobGroups.id : sql<string | null>`NULL::varchar`,
          jobGroupName: withJobGroups ? dispatchJobGroups.name : sql<string | null>`NULL::text`,
        })
        .from(edlsAssignments)
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(edlsSheets, eq(edlsCrews.sheetId, edlsSheets.id))
        .leftJoin(users, eq(edlsSheets.supervisor, users.id))
        .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
        .leftJoin(optionsDepartment, eq(edlsSheets.departmentId, optionsDepartment.id))
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id))
        .leftJoin(optionsEdlsShowStatus, eq(edlsSheets.showStatusId, optionsEdlsShowStatus.id))
        .leftJoin(optionsEdlsTasks, eq(edlsCrews.taskId, optionsEdlsTasks.id))
        .$dynamic();

      const rows = await (withJobGroups
        ? baseQuery.leftJoin(dispatchJobGroups, eq(edlsSheets.jobGroupId, dispatchJobGroups.id))
        : baseQuery)
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
        location: r.location,
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
        department: r.departmentId ? { id: r.departmentId, name: r.departmentName! } : null,
        employer: r.employerId ? { id: r.employerId, name: r.employerName! } : null,
        showStatus: r.showStatusId ? { id: r.showStatusId, name: r.showStatusName! } : null,
        task: r.taskId ? { id: r.taskId, name: r.taskName! } : null,
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
        filters?.sheetStatuses
          ? inArray(edlsSheets.status, filters.sheetStatuses)
          : ne(edlsSheets.status, 'trash'),
      ];
      if (filters?.afterYmd) conditions.push(gt(edlsSheets.ymd, filters.afterYmd));
      if (filters?.startYmd) conditions.push(gte(edlsSheets.ymd, filters.startYmd));
      if (filters?.endYmd) conditions.push(lte(edlsSheets.ymd, filters.endYmd));
      if (filters?.supervisorId) conditions.push(eq(edlsSheets.supervisor, filters.supervisorId));
      if (filters?.facilityId) conditions.push(eq(edlsSheets.facilityId, filters.facilityId));
      if (filters?.jobGroupId) conditions.push(eq(edlsSheets.jobGroupId, filters.jobGroupId));

      const withJobGroups = jobGroupsEnabled();
      const baseQuery = client
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
          location: edlsCrews.location,
          supervisorId: users.id,
          supervisorFirstName: users.firstName,
          supervisorLastName: users.lastName,
          supervisorEmail: users.email,
          facilityId: facilities.id,
          facilityName: facilities.name,
          departmentId: optionsDepartment.id,
          departmentName: optionsDepartment.name,
          employerId: employers.id,
          employerName: employers.name,
          showStatusId: optionsEdlsShowStatus.id,
          showStatusName: optionsEdlsShowStatus.name,
          taskId: optionsEdlsTasks.id,
          taskName: optionsEdlsTasks.name,
          jobGroupId: withJobGroups ? dispatchJobGroups.id : sql<string | null>`NULL::varchar`,
          jobGroupName: withJobGroups ? dispatchJobGroups.name : sql<string | null>`NULL::text`,
        })
        .from(edlsAssignments)
        .innerJoin(edlsCrews, eq(edlsAssignments.crewId, edlsCrews.id))
        .innerJoin(edlsSheets, eq(edlsCrews.sheetId, edlsSheets.id))
        .leftJoin(users, eq(edlsSheets.supervisor, users.id))
        .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
        .leftJoin(optionsDepartment, eq(edlsSheets.departmentId, optionsDepartment.id))
        .leftJoin(employers, eq(edlsSheets.employerId, employers.id))
        .leftJoin(optionsEdlsShowStatus, eq(edlsSheets.showStatusId, optionsEdlsShowStatus.id))
        .leftJoin(optionsEdlsTasks, eq(edlsCrews.taskId, optionsEdlsTasks.id))
        .$dynamic();

      const rows = await (withJobGroups
        ? baseQuery.leftJoin(dispatchJobGroups, eq(edlsSheets.jobGroupId, dispatchJobGroups.id))
        : baseQuery)
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
          location: r.location,
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
          department: r.departmentId ? { id: r.departmentId, name: r.departmentName! } : null,
          employer: r.employerId ? { id: r.employerId, name: r.employerName! } : null,
          showStatus: r.showStatusId ? { id: r.showStatusId, name: r.showStatusName! } : null,
          task: r.taskId ? { id: r.taskId, name: r.taskName! } : null,
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
            AND EXISTS (SELECT 1 FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id AND wmd.ms_id = oms2.id)
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
      state: { fallbackId: 'new' },
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
