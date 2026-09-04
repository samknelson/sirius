import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const setActiveSchema = z.object({
  active: z.boolean(),
});

export function registerWorkerEdlsRoutes(app: Express, requireAuth: RequireAuth) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const workerId = req.params.id;
        const row = await storage.workerEdls.getByWorker(workerId);
        if (!row) {
          // Default state when no row exists yet: inactive, matching the strict
          // EDLS sheet picker which excludes workers with no worker_edls row.
          res.json({ workerId, active: false, exists: false });
          return;
        }
        res.json({ ...row, exists: true });
      } catch (error) {
        console.error("Error fetching worker EDLS state:", error);
        res.status(500).json({ error: "Failed to fetch worker EDLS state" });
      }
    }
  );

  /**
   * Every assignment this worker holds, across every sheet: past, today's and
   * future. The storage read is the one the worker-facing schedule page uses,
   * called with no filters so its default applies — every date, every sheet
   * status except `trash`.
   *
   * The response is narrowed to what the staff list renders. The read also
   * carries the sheet supervisor's name and email, the crew's times and
   * check-in location, and the worker's own accept/decline answer; none of
   * that belongs to this screen, so none of it is sent.
   */
  app.get(
    "/api/workers/:id/edls/assignments",
    requireAuth,
    edlsComponent,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const assignments = await storage.edlsAssignments.getAssignmentsForWorker(
          req.params.id,
        );
        res.json(
          assignments.map((a) => ({
            assignmentId: a.assignmentId,
            ymd: a.ymd,
            sheetId: a.sheetId,
            sheetTitle: a.sheetTitle,
            sheetStatus: a.sheetStatus,
            crewTitle: a.crewTitle,
            // Null whenever the dispatch.job_group component is off, which is
            // why the client drops the column rather than showing blanks.
            jobGroup: a.jobGroup,
            facility: a.facility,
            department: a.department,
          })),
        );
      } catch (error) {
        console.error("Error fetching worker EDLS assignments:", error);
        res.status(500).json({ error: "Failed to fetch worker EDLS assignments" });
      }
    }
  );

  app.put(
    "/api/workers/:id/edls",
    requireAuth,
    edlsComponent,
    requireAccess('edls.coordinator', req => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const { active } = setActiveSchema.parse(req.body);
        const updated = await storage.workerEdls.setActive(req.params.id, active);
        res.json({ ...updated, exists: true });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        console.error("Error updating worker EDLS state:", error);
        res.status(500).json({ error: "Failed to update worker EDLS state" });
      }
    }
  );
}
