import { sql, type SQL } from "drizzle-orm";
import { COMM_STATUSES, getCommStatusBucket } from "@shared/commStatus";
import type {
  AssignmentExplorerQuery, AssignmentExplorerResult, AssignmentExplorerRow, AssignmentStatusCounts,
} from "../../../shared/edls-assignment-explorer";
import { getClient, runInTransaction } from "../../../../../server/storage/transaction-context";

// Derive SQL membership from the same contract used by every comm indicator.
const statuses = (bucket: "success" | "error") =>
  sql.join(COMM_STATUSES.filter(status => getCommStatusBucket(status) === bucket).map(status => sql`${status}`), sql`, `);
const notification = sql`CASE WHEN comm.id IS NULL THEN 'none'
  WHEN comm.status IN (${statuses("success")}) THEN 'sent'
  WHEN comm.status IN (${statuses("error")}) THEN 'failed'
  ELSE 'pending' END`;
const population = sql`COALESCE(we.active, false)`;

function scope(ymd: string) {
  return sql`FROM edls_assignments a
    JOIN edls_crews c ON c.id = a.crew_id
    JOIN edls_sheets s ON s.id = c.sheet_id
    JOIN workers w ON w.id = a.worker_id
    JOIN contacts contact ON contact.id = w.contact_id
    LEFT JOIN comm ON comm.id = a.comm_id
    LEFT JOIN worker_edls we ON we.worker_id = a.worker_id
    WHERE s.ymd = ${ymd} AND s.status <> 'trash'`;
}

function filters(query: AssignmentExplorerQuery): SQL {
  const clauses: SQL[] = [];
  if (query.accepted === "yes") clauses.push(sql`a.accepted IS TRUE`);
  if (query.accepted === "no") clauses.push(sql`a.accepted IS FALSE`);
  if (query.accepted === "unanswered") clauses.push(sql`a.accepted IS NULL`);
  if (query.notified !== "all") clauses.push(sql`${notification} = ${query.notified}`);
  if (query.population !== "all") clauses.push(sql`${population} = ${query.population === "yes"}`);
  return clauses.length ? sql`AND ${sql.join(clauses, sql` AND `)}` : sql``;
}

export function assignmentExplorerDetailsQuery(query: AssignmentExplorerQuery) {
  // The unique final key gives pagination and export the exact same ordering.
  return sql`SELECT a.id, s.ymd::text AS ymd, w.id AS "workerId",
    COALESCE(NULLIF(contact.display_name, ''), NULLIF(concat_ws(' ', contact.given, contact.family), ''), 'Worker') AS "workerName",
    w.sirius_id AS "workerIdentifier", s.id AS "sheetId", s.title AS "sheetTitle",
    s.status AS "sheetStatus", c.title AS "crewTitle",
    (SELECT t.name FROM options_edls_tasks t WHERE t.id = c.task_id) AS "taskName",
    COALESCE(NULLIF(a.data->>'startTime', ''), c.start_time::text) AS "startTime",
    a.accepted, comm.id AS "commId", comm.status AS "commStatus",
    ${notification} AS notified, ${population} AS "inPopulation"
    ${scope(query.ymd)} ${filters(query)}
    ORDER BY s.title, s.id, c.sequence, c.id, a.id`;
}

export interface AssignmentExplorerStorage {
  getStatusCounts(ymd: string): Promise<AssignmentStatusCounts>;
  listStatusAssignments(query: AssignmentExplorerQuery): Promise<AssignmentExplorerResult>;
  exportStatusAssignments(query: AssignmentExplorerQuery, write: (rows: AssignmentExplorerRow[]) => Promise<void>): Promise<void>;
}

export const assignmentExplorerStorage: AssignmentExplorerStorage = {
  async getStatusCounts(ymd) {
    const result = await getClient().execute(sql`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE a.accepted IS TRUE)::int AS yes,
      count(*) FILTER (WHERE a.accepted IS FALSE)::int AS no,
      count(*) FILTER (WHERE a.accepted IS NULL)::int AS unanswered,
      count(*) FILTER (WHERE ${notification} = 'sent')::int AS sent,
      count(*) FILTER (WHERE ${notification} = 'failed')::int AS failed,
      count(*) FILTER (WHERE ${notification} = 'pending')::int AS pending,
      count(*) FILTER (WHERE ${notification} = 'none')::int AS none,
      count(*) FILTER (WHERE ${population})::int AS population
      ${scope(ymd)}`);
    const row = result.rows[0] as Record<string, number>;
    return {
      total: row.total,
      accepted: { yes: row.yes, no: row.no, unanswered: row.unanswered },
      notified: { sent: row.sent, failed: row.failed, pending: row.pending, none: row.none },
      population: { yes: row.population, no: row.total - row.population },
    };
  },
  async listStatusAssignments(query) {
    return runInTransaction(async () => {
      await getClient().execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      const total = await getClient().execute(sql`SELECT count(*)::int AS total ${scope(query.ymd)} ${filters(query)}`);
      const result = await getClient().execute(sql`${assignmentExplorerDetailsQuery(query)} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      return { rows: result.rows as unknown as AssignmentExplorerRow[], total: Number(total.rows[0].total), page: query.page, pageSize: query.pageSize };
    });
  },
  async exportStatusAssignments(query, write) {
    await runInTransaction(async () => {
      // A cursor bounds memory and retains one consistent current-state snapshot,
      // even if assignments change during a slow download. No row cap.
      await getClient().execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
      await getClient().execute(sql`DECLARE edls_assignment_export NO SCROLL CURSOR FOR ${assignmentExplorerDetailsQuery(query)}`);
      try {
        for (;;) {
          const result = await getClient().execute(sql`FETCH FORWARD 500 FROM edls_assignment_export`);
          if (!result.rows.length) break;
          await write(result.rows as unknown as AssignmentExplorerRow[]);
        }
      } finally {
        await getClient().execute(sql`CLOSE edls_assignment_export`);
      }
    });
  },
};
