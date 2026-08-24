/**
 * Freeman passport export query.
 *
 * One page of "Scheduled" (status `lock`) EDLS sheets with everything the
 * legacy Freeman passport export response needs: sheet relations, crews in
 * sequence order, assignments with worker identity, industry-scoped member
 * status, the `freeman_ein` worker id value, classification names, the
 * Freeman crew lead sirius id and each sheet's most recent snapshot id.
 *
 * The page is fetched in bulk — a fixed number of queries regardless of how
 * many sheets, crews, workers or crew leads are on the page. Every optional
 * source (snapshot, crew lead, `freeman_ein` id, job group, facility) is
 * absent-tolerant: it degrades to null rather than failing the export.
 *
 * The result is deliberately raw: dates, names and counts are returned as
 * stored so the response mapper owns every presentation decision.
 */
import {
  edlsSheets,
  edlsCrews,
  edlsAssignments,
  employers,
  users,
  optionsDepartment,
  optionsEdlsShowStatus,
  optionsEdlsTasks,
  dispatchJobGroups,
  facilities,
} from "@shared/schema";
import { and, asc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getClient } from "../transaction-context";
import { storage } from "../index";
import { createUnifiedOptionsStorage } from "../unified-options";
import { isComponentEnabledSync } from "../../services/component-cache";
import { logger } from "../../logger";

const SERVICE_NAME = "edls-passport-export";

/** Only sheets in this status are exported; they display as "Scheduled". */
const SCHEDULED_STATUS = "lock";

/** Entity type used by the snapshot capture service for EDLS sheets. */
const SHEET_SNAPSHOT_ENTITY_TYPE = "edls_sheet";

/** Sirius id of the worker id type carrying the Freeman employee number. */
const FREEMAN_EIN_ID_TYPE_SIRIUS_ID = "freeman_ein";

/**
 * The dispatch_job_group table is owned by the `dispatch.job_group`
 * component; it may not exist in the database when that component is
 * disabled. All reads must gate their join on this check.
 */
function jobGroupsEnabled(): boolean {
  return isComponentEnabledSync("dispatch.job_group");
}

export interface EdlsPassportExportQuery {
  /** Only sheets whose `changed` timestamp is at or after this instant. */
  changedSince?: Date | null;
  /** Zero-based page index. */
  page: number;
  /** Page size. */
  limit: number;
}

export interface EdlsPassportUser {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface EdlsPassportAssignment {
  id: string;
  workerGiven: string | null;
  workerFamily: string | null;
  workerSiriusId: number | null;
  /** Member status code in the industry of the sheet's employer. */
  memberStatusCode: string | null;
  /** Value of the worker id whose type has sirius id `freeman_ein`. */
  employeeId: string | null;
  /** Start time stored on the assignment's data blob. */
  startTime: string | null;
  /** Note stored on the assignment's data blob. */
  note: string | null;
  classificationName: string | null;
}

export interface EdlsPassportCrew {
  id: string;
  title: string;
  taskName: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  workerCount: number;
  supervisorUser: EdlsPassportUser | null;
  /** Sirius id of the crew's Freeman crew lead, when resolvable. */
  crewleadSiriusId: string | null;
  assignments: EdlsPassportAssignment[];
}

export interface EdlsPassportSheet {
  id: string;
  title: string;
  ymd: string;
  notes: string | null;
  changed: Date;
  /** Planned worker count. */
  workerCount: number;
  /** Number of workers actually assigned across the sheet's crews. */
  assignedCount: number;
  employerName: string | null;
  departmentName: string | null;
  facilityName: string | null;
  jobGroupName: string | null;
  showStatusName: string | null;
  supervisorUser: EdlsPassportUser | null;
  creatorUser: EdlsPassportUser | null;
  /** Id of the sheet's most recent snapshot; null when it has none. */
  latestSnapshotId: string | null;
  crews: EdlsPassportCrew[];
}

export interface EdlsPassportExportPage {
  sheets: EdlsPassportSheet[];
  /** Total number of matching sheets, ignoring paging. */
  total: number;
}

interface RawAssignmentRow {
  id: string;
  crewId: string;
  data: unknown;
  workerId: string;
  workerSiriusId: number | null;
  given: string | null;
  family: string | null;
  memberStatusCode: string | null;
}

function toUser(
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  id: string | null,
): EdlsPassportUser | null {
  if (!id) return null;
  return { firstName, lastName, email };
}

function assignmentDataField(data: unknown, key: string): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Freeman crew lead sirius ids keyed by crew-lead row id. Empty when the
 * `sitespecific.freeman` component (and therefore its table) is not present,
 * or when the lookup fails for any reason — a missing crew lead is never
 * fatal to the export.
 */
async function loadCrewleadSiriusIds(): Promise<Map<string, string>> {
  if (!isComponentEnabledSync("sitespecific.freeman")) return new Map();
  try {
    if (!(await storage.freemanCrewleads.tableExists())) return new Map();
    const crewleads = await storage.freemanCrewleads.getAll();
    return new Map(crewleads.map((lead) => [lead.id, lead.siriusId]));
  } catch (err) {
    logger.warn(
      `Freeman crew leads unavailable for passport export: ${err instanceof Error ? err.message : String(err)}`,
      { service: SERVICE_NAME },
    );
    return new Map();
  }
}

/**
 * `freeman_ein` id values keyed by worker id. Empty when the id type does not
 * exist; workers without such an id are simply absent from the map.
 */
async function loadEmployeeIds(workerIds: string[]): Promise<Map<string, string>> {
  if (workerIds.length === 0) return new Map();
  const typeId = await storage.workerIds.getTypeIdBySiriusId(FREEMAN_EIN_ID_TYPE_SIRIUS_ID);
  if (!typeId) return new Map();
  const rows = await storage.workerIds.getWorkerIdsByTypeForWorkerIds(typeId, workerIds);
  const byWorker = new Map<string, string>();
  for (const row of rows) {
    if (!byWorker.has(row.workerId)) byWorker.set(row.workerId, row.value);
  }
  return byWorker;
}

export async function getEdlsPassportExportPage(
  query: EdlsPassportExportQuery,
): Promise<EdlsPassportExportPage> {
  const client = getClient();
  const withJobGroups = jobGroupsEnabled();
  const supervisorUsers = alias(users, "sheet_supervisor_user");
  const creatorUsers = alias(users, "sheet_creator_user");
  const crewSupervisorUsers = alias(users, "crew_supervisor_user");

  const conditions: SQL[] = [eq(edlsSheets.status, SCHEDULED_STATUS)];
  if (query.changedSince) {
    conditions.push(gte(edlsSheets.changed, query.changedSince));
  }
  const whereCondition = and(...conditions)!;

  const [countRow] = await client
    .select({ count: sql<number>`count(*)::int` })
    .from(edlsSheets)
    .where(whereCondition);
  const total = countRow?.count ?? 0;

  const assignedCountSubquery = sql<number>`(
    SELECT COUNT(*)::int
    FROM ${edlsAssignments}
    INNER JOIN ${edlsCrews} ON ${edlsAssignments.crewId} = ${edlsCrews.id}
    WHERE ${edlsCrews.sheetId} = ${edlsSheets.id}
  )`.as("assigned_count");

  const baseQuery = client
    .select({
      id: edlsSheets.id,
      title: edlsSheets.title,
      ymd: edlsSheets.ymd,
      notes: edlsSheets.notes,
      changed: edlsSheets.changed,
      workerCount: edlsSheets.workerCount,
      assignedCount: assignedCountSubquery,
      employerName: employers.name,
      departmentName: optionsDepartment.name,
      facilityName: facilities.name,
      showStatusName: optionsEdlsShowStatus.name,
      jobGroupName: withJobGroups ? dispatchJobGroups.name : sql<string | null>`NULL::text`,
      supervisorId: supervisorUsers.id,
      supervisorFirstName: supervisorUsers.firstName,
      supervisorLastName: supervisorUsers.lastName,
      supervisorEmail: supervisorUsers.email,
      creatorId: creatorUsers.id,
      creatorFirstName: creatorUsers.firstName,
      creatorLastName: creatorUsers.lastName,
      creatorEmail: creatorUsers.email,
    })
    .from(edlsSheets)
    .leftJoin(employers, eq(edlsSheets.employerId, employers.id))
    .leftJoin(optionsDepartment, eq(edlsSheets.departmentId, optionsDepartment.id))
    .leftJoin(facilities, eq(edlsSheets.facilityId, facilities.id))
    .leftJoin(optionsEdlsShowStatus, eq(edlsSheets.showStatusId, optionsEdlsShowStatus.id))
    .leftJoin(supervisorUsers, eq(edlsSheets.supervisor, supervisorUsers.id))
    .leftJoin(creatorUsers, eq(edlsSheets.createdBy, creatorUsers.id))
    .$dynamic();

  const joinedQuery = withJobGroups
    ? baseQuery.leftJoin(dispatchJobGroups, eq(edlsSheets.jobGroupId, dispatchJobGroups.id))
    : baseQuery;

  // Oldest change first: a client paging through an incremental export walks
  // the change history forward, and the id tiebreak keeps the order stable
  // across pages when several sheets share a `changed` instant.
  const sheetRows = await joinedQuery
    .where(whereCondition)
    .orderBy(asc(edlsSheets.changed), asc(edlsSheets.id))
    .limit(query.limit)
    .offset(query.page * query.limit);

  if (sheetRows.length === 0) {
    return { sheets: [], total };
  }

  const sheetIds = sheetRows.map((row) => row.id);

  const crewRows = await client
    .select({
      id: edlsCrews.id,
      sheetId: edlsCrews.sheetId,
      title: edlsCrews.title,
      workerCount: edlsCrews.workerCount,
      location: edlsCrews.location,
      startTime: edlsCrews.startTime,
      endTime: edlsCrews.endTime,
      data: edlsCrews.data,
      taskName: optionsEdlsTasks.name,
      supervisorId: crewSupervisorUsers.id,
      supervisorFirstName: crewSupervisorUsers.firstName,
      supervisorLastName: crewSupervisorUsers.lastName,
      supervisorEmail: crewSupervisorUsers.email,
    })
    .from(edlsCrews)
    .leftJoin(optionsEdlsTasks, eq(edlsCrews.taskId, optionsEdlsTasks.id))
    .leftJoin(crewSupervisorUsers, eq(edlsCrews.supervisor, crewSupervisorUsers.id))
    .where(inArray(edlsCrews.sheetId, sheetIds))
    .orderBy(asc(edlsCrews.sheetId), asc(edlsCrews.sequence));

  const crewIds = crewRows.map((row) => row.id);

  // Member status is industry-scoped: each assignment resolves against the
  // industry of ITS OWN sheet's employer, the same lateral-join rule the live
  // assignments query applies for a single sheet. `industry_id` may be null,
  // in which case the lateral simply yields no row.
  let assignmentRows: RawAssignmentRow[] = [];
  if (crewIds.length > 0) {
    const crewIdList = sql.join(
      crewIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const result = await client.execute(sql`
      SELECT
        ea.id,
        ea.crew_id as "crewId",
        ea.data,
        w.id as "workerId",
        w.sirius_id as "workerSiriusId",
        c.given,
        c.family,
        member_status.code as "memberStatusCode"
      FROM edls_assignments ea
      INNER JOIN edls_crews ec ON ea.crew_id = ec.id
      INNER JOIN edls_sheets es ON ec.sheet_id = es.id
      LEFT JOIN employers emp ON es.employer_id = emp.id
      INNER JOIN workers w ON ea.worker_id = w.id
      INNER JOIN contacts c ON w.contact_id = c.id
      LEFT JOIN LATERAL (
        SELECT ms.code
        FROM worker_msh_denorm wmd
        INNER JOIN options_worker_ms ms ON ms.id = wmd.ms_id AND ms.industry_id = emp.industry_id
        WHERE wmd.worker_id = w.id
        LIMIT 1
      ) member_status ON true
      WHERE ea.crew_id IN (${crewIdList})
    `);
    assignmentRows = result.rows as unknown as RawAssignmentRow[];
  }

  const [snapshotIds, crewleadSiriusIds, employeeIds, classifications] = await Promise.all([
    storage.snapshots.getLatestIdsByEntity(SHEET_SNAPSHOT_ENTITY_TYPE, sheetIds),
    loadCrewleadSiriusIds(),
    loadEmployeeIds(Array.from(new Set(assignmentRows.map((row) => row.workerId)))),
    createUnifiedOptionsStorage().list("classification"),
  ]);

  const classificationNames = new Map<string, string>();
  const classificationPositions = new Map<string, number>();
  classifications.forEach((option: { id: string; name: string }, index: number) => {
    classificationNames.set(option.id, option.name);
    classificationPositions.set(option.id, index);
  });

  const assignmentsByCrew = new Map<string, EdlsPassportAssignment[]>();
  for (const row of assignmentRows) {
    const classificationId = assignmentDataField(row.data, "classificationId");
    const assignments = assignmentsByCrew.get(row.crewId) ?? [];
    assignments.push({
      id: row.id,
      workerGiven: row.given,
      workerFamily: row.family,
      workerSiriusId: row.workerSiriusId,
      memberStatusCode: row.memberStatusCode,
      employeeId: employeeIds.get(row.workerId) ?? null,
      startTime: assignmentDataField(row.data, "startTime"),
      note: assignmentDataField(row.data, "note"),
      classificationName: classificationId
        ? (classificationNames.get(classificationId) ?? null)
        : null,
    });
    assignmentsByCrew.set(row.crewId, assignments);
  }

  // Same order the sheet itself displays: classification order, then name.
  const classificationPositionOf = (row: RawAssignmentRow): number => {
    const id = assignmentDataField(row.data, "classificationId");
    return id ? (classificationPositions.get(id) ?? Infinity) : Infinity;
  };
  const positionById = new Map(assignmentRows.map((row) => [row.id, classificationPositionOf(row)]));
  for (const assignments of Array.from(assignmentsByCrew.values())) {
    assignments.sort((a, b) => {
      const aPos = positionById.get(a.id) ?? Infinity;
      const bPos = positionById.get(b.id) ?? Infinity;
      if (aPos !== bPos) return aPos - bPos;
      const family = (a.workerFamily || "").toLowerCase().localeCompare((b.workerFamily || "").toLowerCase());
      if (family !== 0) return family;
      return (a.workerGiven || "").toLowerCase().localeCompare((b.workerGiven || "").toLowerCase());
    });
  }

  const crewsBySheet = new Map<string, EdlsPassportCrew[]>();
  for (const row of crewRows) {
    const crewLeadId = assignmentDataField(row.data, "freemanCrewLeadId");
    const crews = crewsBySheet.get(row.sheetId) ?? [];
    crews.push({
      id: row.id,
      title: row.title,
      taskName: row.taskName ?? null,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      location: row.location ?? null,
      workerCount: row.workerCount,
      supervisorUser: toUser(
        row.supervisorFirstName,
        row.supervisorLastName,
        row.supervisorEmail,
        row.supervisorId,
      ),
      crewleadSiriusId: crewLeadId ? (crewleadSiriusIds.get(crewLeadId) ?? null) : null,
      assignments: assignmentsByCrew.get(row.id) ?? [],
    });
    crewsBySheet.set(row.sheetId, crews);
  }

  const sheets: EdlsPassportSheet[] = sheetRows.map((row) => ({
    id: row.id,
    title: row.title,
    ymd: row.ymd,
    notes: row.notes,
    changed: row.changed,
    workerCount: row.workerCount,
    assignedCount: row.assignedCount ?? 0,
    employerName: row.employerName ?? null,
    departmentName: row.departmentName ?? null,
    facilityName: row.facilityName ?? null,
    jobGroupName: row.jobGroupName ?? null,
    showStatusName: row.showStatusName ?? null,
    supervisorUser: toUser(
      row.supervisorFirstName,
      row.supervisorLastName,
      row.supervisorEmail,
      row.supervisorId,
    ),
    creatorUser: toUser(
      row.creatorFirstName,
      row.creatorLastName,
      row.creatorEmail,
      row.creatorId,
    ),
    latestSnapshotId: snapshotIds.get(row.id) ?? null,
    crews: crewsBySheet.get(row.id) ?? [],
  }));

  return { sheets, total };
}
