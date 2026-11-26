import { sql } from "drizzle-orm";
import { workerQueryPlan } from "./worker-query-plan";
import { getClient } from "../../../../../server/storage/transaction-context";

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

export type EdlsSummaryPopulationWorker = Pick<
  AvailableWorkerForSheet,
  "id" | "memberStatusName" | "memberStatusSequence"
>;

// Population membership is independent of sheet date, industry and ratings.
// Share both the contact requirement and active rule across the lean and
// scheduling reads so identifier lists cannot silently drift from scheduling.
function populationFrom(includeInactive = false) {
  const edlsJoin = includeInactive
    ? sql`LEFT JOIN worker_edls we ON we.worker_id = w.id`
    : sql`INNER JOIN worker_edls we ON we.worker_id = w.id`;
  return sql`FROM workers w
    INNER JOIN contacts c ON w.contact_id = c.id
    ${edlsJoin}`;
}

function populationWhere(includeInactive = false, workerIds?: readonly string[]) {
  const conditions = [];
  if (!includeInactive) conditions.push(sql`we.active = true`);
  // Bound directory pages before joining their assignment history.
  if (workerIds) {
    conditions.push(sql`w.id IN (${sql.join(workerIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  return conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
}

/** Active workers with contacts only; no display fields or history lookups. */
export async function getPopulationWorkerIdsQuery(): Promise<string[]> {
  const result = await getClient().execute(sql`
    SELECT w.id
    ${populationFrom()}
    ${populationWhere()}
  `);
  return (result.rows as unknown as { id: string }[]).map(row => row.id);
}

function memberStatusJoin(industryId: string | null) {
  return industryId
    ? sql`LEFT JOIN LATERAL (
        SELECT ms.id, ms.name, ms.sequence
        FROM worker_msh_denorm wmd
        INNER JOIN options_worker_ms ms ON ms.id = wmd.ms_id AND ms.industry_id = ${industryId}
        WHERE wmd.worker_id = w.id
        LIMIT 1
      ) member_status ON true`
    : sql``;
}

function nearestAssignmentJoin(
  sheetYmd: string,
  position: "prior" | "current" | "next",
) {
  const dayCondition = position === "prior"
    ? sql`ea.ymd < ${sheetYmd}`
    : position === "next"
      ? sql`ea.ymd > ${sheetYmd}`
      : sql`ea.ymd = ${sheetYmd}`;
  const ordering = position === "prior"
    ? sql`ea.ymd DESC, ea.id`
    : position === "next"
      ? sql`ea.ymd ASC, ea.id`
      : sql`ea.id`;

  // The worker/date index lets each lookup stop at the first joined row.
  // Join BEFORE LIMIT: retained cleared rows and missing crews/sheets must
  // not hide a farther valid assignment. Trash sheets still count, and the
  // date is the assignment's (not the sheet's). Keep id ASC for date ties.
  return sql`LEFT JOIN LATERAL (
    SELECT es.status
    FROM edls_assignments ea
    INNER JOIN edls_crews ec ON ea.crew_id = ec.id
    INNER JOIN edls_sheets es ON ec.sheet_id = es.id
    WHERE ea.worker_id = aw.id
      AND ea.crew_id IS NOT NULL
      AND ${dayCondition}
    ORDER BY ${ordering}
    LIMIT 1
  ) ${sql.identifier(`${position}_assignment`)} ON true`;
}

/**
 * The default available-workers population, without assignment history or
 * display/rating fields. Keep the contact join and ordering: the summary uses
 * the first sequence encountered when multiple statuses share a name.
 * Industry selection and exclusion of the day's assigned workers stay with
 * the caller; population membership itself is independent of the day.
 */
export async function getSummaryPopulationQuery(
  industryId: string | null,
): Promise<EdlsSummaryPopulationWorker[]> {
  const memberStatusSelect = industryId
    ? sql`member_status.name as "memberStatusName", member_status.sequence as "memberStatusSequence"`
    : sql`NULL::varchar as "memberStatusName", NULL::integer as "memberStatusSequence"`;
  const orderBy = industryId
    ? sql`ORDER BY COALESCE(member_status.sequence, 999999), c.family, c.given`
    : sql`ORDER BY c.family, c.given`;
  const result = await getClient().execute(sql`
    SELECT w.id, ${memberStatusSelect}
    ${populationFrom()}
    ${memberStatusJoin(industryId)}
    ${populationWhere()}
    ${orderBy}
  `);
  return result.rows as unknown as EdlsSummaryPopulationWorker[];
}

export async function getAvailableWorkersForSheetQuery(
  sheetYmd: string,
  industryId: string | null,
  ratingId?: string,
  includeInactive = false,
  workerIds?: readonly string[],
): Promise<AvailableWorkerForSheet[]> {
  const plan = await workerQueryPlan({ surface: "available", ratingId, industryId },
    industryId
      ? sql`ORDER BY COALESCE(aw."memberStatusSequence", 999999), aw.family, aw.given`
      : sql`ORDER BY aw.family, aw.given`);
  if (workerIds?.length === 0) return [];
  const client = getClient();
  const ratingJoin = plan.join;
  const ratingSelect = sql`${plan.value} as "ratingValue"`;
  const memberStatusSelect = industryId
    ? sql`member_status.id as "memberStatusId", member_status.name as "memberStatusName", member_status.sequence as "memberStatusSequence"`
    : sql`NULL::varchar as "memberStatusId", NULL::varchar as "memberStatusName", NULL::integer as "memberStatusSequence"`;

  const orderBy = plan.orderBy;

  const result = await client.execute(sql`
    WITH available_workers AS MATERIALIZED (
      SELECT
        w.id,
        w.sirius_id as "siriusId",
        w.contact_id as "contactId",
        c.display_name as "displayName",
        c.given,
        c.family,
        ${ratingSelect},
        ${memberStatusSelect}
      ${populationFrom(includeInactive)}
      ${ratingJoin}
      ${memberStatusJoin(industryId)}
      ${populationWhere(includeInactive, workerIds)}
    )
    SELECT
      aw.id,
      aw."siriusId",
      aw."contactId",
      aw."displayName",
      aw.given,
      aw.family,
      prior_assignment.status as "priorStatus",
      current_assignment.status as "currentStatus",
      next_assignment.status as "nextStatus",
      aw."ratingValue",
      aw."memberStatusId",
      aw."memberStatusName",
      aw."memberStatusSequence"
    FROM available_workers aw
    ${nearestAssignmentJoin(sheetYmd, "prior")}
    ${nearestAssignmentJoin(sheetYmd, "current")}
    ${nearestAssignmentJoin(sheetYmd, "next")}
    ${orderBy}
  `);
  return result.rows as unknown as AvailableWorkerForSheet[];
}
