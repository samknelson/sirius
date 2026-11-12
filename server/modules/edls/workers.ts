import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { checkAccessInline, requireAccess } from "../../services/access-policy-evaluator";
import { requireComponent } from "../components";
import { getEdlsSettings } from "./supervisor-context";
import { getTodayYmd } from "@shared/utils/date";
import { isComponentEnabledSync } from "../../services/component-cache";

type RequireAuth = (req: Request, res: Response, next: () => void) => void;

type AssignmentDetail = NonNullable<
  Awaited<ReturnType<typeof storage.edlsAssignments.getWorkerAssignmentDetails>>
>["prior"];

type AssignmentDetailWithAccess = Exclude<AssignmentDetail, null> & {
  canViewSheet: boolean;
};

async function addSheetAccessToAssignmentDetails(
  req: Request,
  details: NonNullable<Awaited<ReturnType<typeof storage.edlsAssignments.getWorkerAssignmentDetails>>>,
) {
  const sheetIds = [details.prior, details.current, details.next]
    .filter((detail): detail is Exclude<AssignmentDetail, null> => detail !== null)
    .map((detail) => detail.sheetId);
  const uniqueSheetIds = [...new Set(sheetIds)];
  const accessResults = await Promise.all(
    uniqueSheetIds.map(async (sheetId) => [
      sheetId,
      (await checkAccessInline(req, "edls.sheet.view", sheetId)).granted,
    ] as const),
  );
  const sheetAccess = new Map(accessResults);

  const withAccess = (detail: AssignmentDetail): AssignmentDetailWithAccess | null =>
    detail ? { ...detail, canViewSheet: sheetAccess.get(detail.sheetId) === true } : null;

  return {
    ...details,
    prior: withAccess(details.prior),
    current: withAccess(details.current),
    next: withAccess(details.next),
  };
}

const setActiveSchema = z.object({
  active: z.boolean(),
});

const calendarYmdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}, "Invalid calendar date");

const directoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  name: z.string().optional(),
  active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  memberStatusId: z.string().optional(),
  idTypeId: z.string().optional(),
  idValue: z.string().optional(),
  ratingId: z.string().optional(),
  ratingValue: z.coerce.number().int().optional(),
  referenceDate: calendarYmdSchema.optional(),
  currentAssignment: z.enum(["include", "exclude"]).optional(),
  nextAssignment: z.enum(["include", "exclude"]).optional(),
});

const assignmentDetailsQuerySchema = z.object({
  referenceDate: calendarYmdSchema.optional(),
});

export function registerWorkerEdlsRoutes(app: Express, requireAuth: RequireAuth) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/edls/workers",
    requireAuth,
    edlsComponent,
    requireAccess("edls.any"),
    async (req: Request, res: Response) => {
      try {
        const query = directoryQuerySchema.parse(req.query);
        const settings = await getEdlsSettings();
        let industryId: string | null = null;
        if (settings.employer) {
          industryId = (await storage.employers.getEmployer(settings.employer))?.industryId ?? null;
        }
        const ratingsEnabled = isComponentEnabledSync("worker.ratings");
        const referenceYmd = query.referenceDate ?? getTodayYmd();
        const result = await storage.edlsWorkerDirectory.list({
          ...query,
          memberStatusId: industryId ? query.memberStatusId : undefined,
          ratingId: ratingsEnabled ? query.ratingId : undefined,
          ratingValue: ratingsEnabled ? query.ratingValue : undefined,
          industryId,
          referenceYmd,
        });
        res.json({ ...result, industryId, ratingsEnabled, referenceDate: referenceYmd });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid directory filters", details: error.errors });
        }
        console.error("Error fetching EDLS worker directory:", error);
        res.status(500).json({ error: "Failed to fetch EDLS worker directory" });
      }
    },
  );

  app.get(
    "/api/edls/workers/:id/assignment-details",
    requireAuth,
    edlsComponent,
    requireAccess("edls.any"),
    async (req: Request, res: Response) => {
      try {
        const query = assignmentDetailsQuerySchema.parse(req.query);
        const details = await storage.edlsAssignments.getWorkerAssignmentDetails(
          req.params.id,
          query.referenceDate ?? getTodayYmd(),
        );
        if (!details) return res.status(404).json({ message: "Worker not found" });
        res.json(await addSheetAccessToAssignmentDetails(req, details));
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid reference date", details: error.errors });
        }
        console.error("Error fetching EDLS worker assignment details:", error);
        res.status(500).json({ error: "Failed to fetch worker assignment details" });
      }
    },
  );

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
