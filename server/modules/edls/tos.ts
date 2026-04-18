import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getClient } from "../../storage/transaction-context";
import { dispatchJobGroups } from "@shared/schema";
import { and, or, isNull, gte, asc } from "drizzle-orm";

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
        const today = new Date();
        const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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
        const startYmd = typeof req.query.startYmd === "string" ? req.query.startYmd : undefined;
        const endYmd = typeof req.query.endYmd === "string" ? req.query.endYmd : undefined;
        const supervisorId = typeof req.query.supervisorId === "string" && req.query.supervisorId
          ? req.query.supervisorId : undefined;
        const facilityId = typeof req.query.facilityId === "string" && req.query.facilityId
          ? req.query.facilityId : undefined;
        const jobGroupId = typeof req.query.jobGroupId === "string" && req.query.jobGroupId
          ? req.query.jobGroupId : undefined;

        const tosRecords = await storage.workerTos.listActiveWithWorker();

        const assignmentFilters = { startYmd, endYmd, supervisorId, facilityId, jobGroupId };
        const filterActive = !!(supervisorId || facilityId || jobGroupId);

        const workerIds = tosRecords.map((t) => t.workerId);
        const assignmentsByWorker = await storage.edlsAssignments.getAssignmentsForWorkerIds(
          workerIds,
          assignmentFilters
        );

        const enriched = tosRecords.map((tos) => ({
          tos,
          assignments: assignmentsByWorker.get(tos.workerId) ?? [],
        }));

        const filtered = filterActive
          ? enriched.filter((e) => e.assignments.length > 0)
          : enriched;

        res.json({ items: filtered, filterActive });
      } catch (err) {
        console.error("Failed to fetch EDLS TOS list:", err);
        res.status(500).json({ message: "Failed to fetch EDLS TOS list" });
      }
    }
  );
}
