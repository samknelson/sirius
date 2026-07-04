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

    const result = await ctx.storage.readOnly.query(async (client) => {
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
      return (rows.rows as Array<Record<string, unknown>>).map((row) => ({
        memberStatus: row.member_status as string,
        msSequence: row.ms_sequence === null ? null : Number(row.ms_sequence),
        sheetStatus: row.sheet_status as string,
        workerCount: Number(row.worker_count ?? 0),
      }));
    });

    const memberStatuses: string[] = [];
    const seenStatuses = new Set<string>();
    const grid: Record<string, Record<string, number>> = {};

    for (const row of result) {
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

    return { memberStatuses, grid };
  },

  client: {
    component: "edls-summary:EdlsSummary",
    order: 11,
    fullWidth: true,
  },
};

registerDashboardPlugin(edlsSummaryPlugin);
