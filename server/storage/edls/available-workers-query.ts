import { sql } from "drizzle-orm";
import { getClient } from "../transaction-context";

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

export async function getAvailableWorkersForSheetQuery(
  sheetYmd: string,
  industryId: string | null,
  ratingId?: string,
  includeInactive = false,
): Promise<AvailableWorkerForSheet[]> {
  const client = getClient();
  const ratingJoin = ratingId
    ? sql`INNER JOIN worker_ratings wr ON wr.worker_id = w.id AND wr.rating_id = ${ratingId}`
    : sql``;
  const ratingSelect = ratingId
    ? sql`wr.value as "ratingValue"`
    : sql`NULL::integer as "ratingValue"`;
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
  const edlsJoin = includeInactive
    ? sql`LEFT JOIN worker_edls we ON we.worker_id = w.id`
    : sql`INNER JOIN worker_edls we ON we.worker_id = w.id`;
  const activeWhere = includeInactive ? sql`` : sql`WHERE we.active = true`;

  let orderBy;
  if (industryId && ratingId) {
    orderBy = sql`ORDER BY COALESCE(aw."memberStatusSequence", 999999), aw."ratingValue" DESC, aw.family, aw.given`;
  } else if (industryId) {
    orderBy = sql`ORDER BY COALESCE(aw."memberStatusSequence", 999999), aw.family, aw.given`;
  } else if (ratingId) {
    orderBy = sql`ORDER BY aw."ratingValue" DESC, aw.family, aw.given`;
  } else {
    orderBy = sql`ORDER BY aw.family, aw.given`;
  }

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
      FROM workers w
      INNER JOIN contacts c ON w.contact_id = c.id
      ${edlsJoin}
      ${ratingJoin}
      ${memberStatusJoin}
      ${activeWhere}
    ),
    assignment_statuses AS MATERIALIZED (
      SELECT
        ea.worker_id,
        (
          array_agg(es.status ORDER BY ea.ymd DESC, ea.id)
            FILTER (WHERE ea.ymd < ${sheetYmd})
        )[1] as "priorStatus",
        (
          array_agg(es.status ORDER BY ea.id)
            FILTER (WHERE ea.ymd = ${sheetYmd})
        )[1] as "currentStatus",
        (
          array_agg(es.status ORDER BY ea.ymd ASC, ea.id)
            FILTER (WHERE ea.ymd > ${sheetYmd})
        )[1] as "nextStatus"
      FROM available_workers aw
      INNER JOIN edls_assignments ea ON ea.worker_id = aw.id
      INNER JOIN edls_crews ec ON ea.crew_id = ec.id
      INNER JOIN edls_sheets es ON ec.sheet_id = es.id
      GROUP BY ea.worker_id
    )
    SELECT
      aw.id,
      aw."siriusId",
      aw."contactId",
      aw."displayName",
      aw.given,
      aw.family,
      assignment_statuses."priorStatus",
      assignment_statuses."currentStatus",
      assignment_statuses."nextStatus",
      aw."ratingValue",
      aw."memberStatusId",
      aw."memberStatusName",
      aw."memberStatusSequence"
    FROM available_workers aw
    LEFT JOIN assignment_statuses ON assignment_statuses.worker_id = aw.id
    ${orderBy}
  `);
  return result.rows as unknown as AvailableWorkerForSheet[];
}