import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getClient } from "../../storage/transaction-context";
import { dispatchJobGroups } from "@shared/schema";
import { or, isNull, gte, asc, sql } from "drizzle-orm";
import { getTodayYmd } from "@shared/utils/date";
import { getEdlsSettings } from "./supervisor-context";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

export function registerEdlsTosRoutes(app: Express, requireAuth: RequireAuth) {
  const edlsComponent = requireComponent("edls");
  const tosComponent = requireComponent("worker.tos");

  app.get(
    "/api/edls/job-groups/active",
    requireAuth,
    edlsComponent,
    tosComponent,
    requireAccess("edls.any"),
    async (req: Request, res: Response) => {
      try {
        const todayYmd = getTodayYmd();
        const client = getClient();
        const rows = await client
          .select({ id: dispatchJobGroups.id, name: dispatchJobGroups.name })
          .from(dispatchJobGroups)
          .where(or(isNull(dispatchJobGroups.endYmd), gte(dispatchJobGroups.endYmd, todayYmd)))
          .orderBy(asc(dispatchJobGroups.name));
        res.json(rows);
      } catch (err) {
        console.error("Failed to list active job groups:", err);
        res.status(500).json({ message: "Failed to list active job groups" });
      }
    }
  );

  app.get(
    "/api/edls/tos",
    requireAuth,
    edlsComponent,
    tosComponent,
    requireAccess("edls.any"),
    async (req: Request, res: Response) => {
      try {
        const startYmd = getTodayYmd();
        const endYmd = typeof req.query.endYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endYmd)
          ? req.query.endYmd
          : undefined;
        const supervisorId = typeof req.query.supervisorId === "string" && req.query.supervisorId
          ? req.query.supervisorId : undefined;
        const facilityId = typeof req.query.facilityId === "string" && req.query.facilityId
          ? req.query.facilityId : undefined;
        const jobGroupId = typeof req.query.jobGroupId === "string" && req.query.jobGroupId
          ? req.query.jobGroupId : undefined;

        const tosRecords = await storage.workerTos.listActiveWithWorker();
        const workerIds = tosRecords.map((t) => t.workerId);

        const assignmentFilters = { startYmd, endYmd, supervisorId, facilityId, jobGroupId };
        const filterActive = !!(supervisorId || facilityId || jobGroupId);

        const assignmentsByWorker = await storage.edlsAssignments.getAssignmentsForWorkerIds(
          workerIds,
          assignmentFilters
        );

        // Look up EDLS settings to resolve configured worker ID type and default employer industry.
        const settings = await getEdlsSettings();
        let employerIndustryId: string | null = null;
        if (settings.employer) {
          const employer = await storage.employers.getEmployer(settings.employer);
          employerIndustryId = employer?.industryId ?? null;
        }

        // Configured worker ID values, keyed by workerId.
        const edlsIdMap = new Map<string, string>();
        if (settings.worker_id_type && workerIds.length > 0) {
          const rows = await storage.workerIds.getWorkerIdsByTypeForWorkerIds(
            settings.worker_id_type,
            workerIds
          );
          for (const row of rows) edlsIdMap.set(row.workerId, row.value);
        }

        // Industry-scoped member status code, keyed by workerId.
        const memberStatusMap = new Map<string, string>();
        if (employerIndustryId && workerIds.length > 0) {
          const client = getClient();
          const result = await client.execute(sql`
            SELECT w.id AS "workerId", ms.code AS "code"
            FROM workers w
            CROSS JOIN LATERAL (
              SELECT ms.code
              FROM UNNEST(w.denorm_ms_ids) AS ms_id
              INNER JOIN options_worker_ms ms ON ms.id = ms_id AND ms.industry_id = ${employerIndustryId}
              LIMIT 1
            ) ms
            WHERE w.id IN (${sql.join(workerIds.map((id) => sql`${id}`), sql`, `)})
          `);
          for (const r of result.rows as unknown as Array<{ workerId: string; code: string | null }>) {
            if (r.code) memberStatusMap.set(r.workerId, r.code);
          }
        }

        const enriched = tosRecords.map((tos) => {
          const all = assignmentsByWorker.get(tos.workerId) ?? [];
          const today = all.find((a) => a.ymd === startYmd) ?? null;
          const future = all.filter((a) => a.ymd > startYmd);
          return {
            tos,
            edlsId: edlsIdMap.get(tos.workerId) ?? null,
            memberStatusCode: memberStatusMap.get(tos.workerId) ?? null,
            today,
            future,
          };
        });

        const filtered = filterActive
          ? enriched.filter((e) => e.today !== null || e.future.length > 0)
          : enriched;

        res.json({
          items: filtered,
          filterActive,
          workerIdTypeConfigured: !!settings.worker_id_type,
        });
      } catch (err) {
        console.error("Failed to fetch EDLS TOS list:", err);
        res.status(500).json({ message: "Failed to fetch EDLS TOS list" });
      }
    }
  );
}
