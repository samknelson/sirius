import { registerDashboardPlugin } from "../registry";
import type { DashboardPlugin } from "../types";
import { sql } from "drizzle-orm";

export const edlsSummaryPlugin: DashboardPlugin = {
  id: "edls-summary",
  name: "EDLS Daily Summary",
  description:
    "Worker assignment counts by member status and sheet status for a selected day",
  requiredComponent: "edls",
  requiredPolicy: "edls.coordinator",
  needsReadOnlyDb: true,

  async content(ctx) {
    const ymd = ctx.query.ymd;
    if (!ymd || typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      throw Object.assign(new Error("ymd query parameter required in YYYY-MM-DD format"), {
        status: 400,
      });
    }

    const { assignmentRows, demandRows, industryIds, assignedWorkerIds } = await ctx.storage.readOnly.query(async (client) => {
      const rows = await client.execute(sql`
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
            AND EXISTS (SELECT 1 FROM worker_msh_denorm wmd WHERE wmd.worker_id = w.id AND wmd.ms_id = oms2.id)
          ORDER BY oms2.sequence ASC NULLS LAST, oms2.name
          LIMIT 1
        ) oms ON true
        WHERE a.ymd = ${ymd}
          AND s.status != 'trash'
        GROUP BY oms.name, oms.sequence, s.status
        ORDER BY oms.sequence NULLS LAST, oms.name
      `);
      const demand = await client.execute(sql`
        SELECT
          s.status AS sheet_status,
          SUM(c.worker_count)::int AS slot_count
        FROM edls_crews c
        JOIN edls_sheets s ON s.id = c.sheet_id
        WHERE s.ymd = ${ymd}
          AND s.status != 'trash'
        GROUP BY s.status
      `);
      const industries = await client.execute(sql`
        SELECT DISTINCT emp.industry_id AS industry_id
        FROM edls_sheets s
        JOIN employers emp ON emp.id = s.employer_id
        WHERE s.ymd = ${ymd}
          AND s.status != 'trash'
      `);
      const assigned = await client.execute(sql`
        SELECT DISTINCT a.worker_id AS worker_id
        FROM edls_assignments a
        JOIN edls_crews c ON c.id = a.crew_id
        JOIN edls_sheets s ON s.id = c.sheet_id
        WHERE a.ymd = ${ymd}
          AND s.status != 'trash'
      `);
      return {
        industryIds: (industries.rows as Array<Record<string, unknown>>).map(
          (row) => (row.industry_id ?? null) as string | null,
        ),
        assignedWorkerIds: new Set(
          (assigned.rows as Array<Record<string, unknown>>).map((row) => row.worker_id as string),
        ),
        assignmentRows: (rows.rows as Array<Record<string, unknown>>).map((row) => ({
          memberStatus: row.member_status as string,
          msSequence: row.ms_sequence === null ? null : Number(row.ms_sequence),
          sheetStatus: row.sheet_status as string,
          workerCount: Number(row.worker_count ?? 0),
        })),
        demandRows: (demand.rows as Array<Record<string, unknown>>).map((row) => ({
          sheetStatus: row.sheet_status as string,
          slotCount: Number(row.slot_count ?? 0),
        })),
      };
    });

    // Unassigned column: workers in the EDLS population (per the existing
    // available-workers function) who have no assignment on this day.
    // Population logic is deliberately delegated to getAvailableWorkersForSheet;
    // we only pick the industry (used for member-status resolution) from the
    // day's sheets — exactly one distinct industry, else null.
    const industryId = industryIds.length === 1 ? industryIds[0] : null;
    const population = await ctx.storage.edlsAssignments.getAvailableWorkersForSheet(
      ymd,
      industryId,
    );

    const unassigned: Record<string, number> = {};
    const unassignedSequence: Record<string, number | null> = {};
    let unassignedTotal = 0;
    for (const worker of population) {
      if (assignedWorkerIds.has(worker.id)) continue;
      const ms = worker.memberStatusName ?? "Unassigned";
      unassigned[ms] = (unassigned[ms] || 0) + 1;
      if (!(ms in unassignedSequence)) {
        unassignedSequence[ms] = worker.memberStatusSequence ?? null;
      }
      unassignedTotal += 1;
    }

    const memberStatuses: string[] = [];
    const seenStatuses = new Set<string>();
    const grid: Record<string, Record<string, number>> = {};

    for (const row of assignmentRows) {
      const ms = row.memberStatus;
      const sheetStatus = row.sheetStatus;
      const count = row.workerCount;
      if (!seenStatuses.has(ms)) {
        seenStatuses.add(ms);
        memberStatuses.push(ms);
      }
      if (!grid[ms]) grid[ms] = {};
      grid[ms][sheetStatus] = count;
    }

    // Member statuses that only appear in the unassigned map still get a row,
    // ordered by their member-status sequence (nulls last, then name).
    const unassignedOnly = Object.keys(unassigned)
      .filter((ms) => !seenStatuses.has(ms))
      .sort((a, b) => {
        const sa = unassignedSequence[a];
        const sb = unassignedSequence[b];
        if (sa !== sb) return (sa ?? Infinity) - (sb ?? Infinity);
        return a.localeCompare(b);
      });
    for (const ms of unassignedOnly) {
      seenStatuses.add(ms);
      memberStatuses.push(ms);
    }

    const demand: Record<string, number> = {};
    for (const row of demandRows) {
      demand[row.sheetStatus] = row.slotCount;
    }

    return { memberStatuses, grid, demand, unassigned, unassignedTotal };
  },

  client: {
    component: "edls-summary:EdlsSummary",
    order: 11,
    fullWidth: true,
  },
};

registerDashboardPlugin(edlsSummaryPlugin);
