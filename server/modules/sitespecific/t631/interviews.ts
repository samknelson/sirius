import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { insertSitespecificT631JobInterviewSchema } from "../../../../shared/schema/sitespecific/t631/interviews-schema";
import type { SitespecificT631JobInterview } from "../../../../shared/schema/sitespecific/t631/interviews-schema";
import { checkAccessInline } from "../../../services/access-policy-evaluator";
import { getEffectiveUser } from "../../masquerade";
import { runInTransaction } from "../../../storage/transaction-context";
import { jobInterviewsAvailable } from "../../../../shared/access-policies/sitespecific/t631/job-interviews";
import {
  INTERVIEW_STATUSES,
  EMPLOYER_VISIBLE_STATUSES,
  type InterviewPersona,
  type InterviewStatus,
  validateTransition,
  validateCommentEdits,
  mergeComments,
  readComments,
  allowedTargetStatuses,
  editableCommentSlots,
} from "./interview-rules";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerT631InterviewsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const interviewsStorage = storage.t631Interviews;
  const componentMiddleware = requireComponent("sitespecific.t631.interviews");
  // Same policy the core dispatch admin routes use (see modules/dispatch/*).
  const adminGate = requireAccess("admin");

  const tableUnavailable = (res: Response) =>
    res.status(503).json({
      message:
        "T631 job interviews table does not exist. Please enable the Teamsters 631 Interviews component first.",
    });

  app.get(
    "/api/sitespecific/t631/interviews",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const { workerId, jobId } = req.query as { workerId?: string; jobId?: string };
        if (workerId) return res.json(await interviewsStorage.getByWorker(workerId));
        if (jobId) return res.json(await interviewsStorage.getByJob(jobId));
        return res
          .status(400)
          .json({ message: "Provide a workerId or jobId query parameter" });
      } catch (error) {
        console.error("Failed to fetch T631 interviews:", error);
        res.status(500).json({ message: "Failed to fetch interviews" });
      }
    },
  );

  app.get(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const record = await interviewsStorage.get(req.params.id);
        if (!record) return res.status(404).json({ message: "Interview not found" });
        res.json(record);
      } catch (error) {
        console.error("Failed to fetch T631 interview:", error);
        res.status(500).json({ message: "Failed to fetch interview" });
      }
    },
  );

  app.post(
    "/api/sitespecific/t631/interviews",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const parsed = insertSitespecificT631JobInterviewSchema.parse(req.body);
        const record = await interviewsStorage.create(parsed);
        res.status(201).json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res
            .status(409)
            .json({ message: "This worker already has an interview for this job" });
        }
        if (error?.code === "23503") {
          return res
            .status(400)
            .json({ message: "Worker or dispatch job does not exist" });
        }
        console.error("Failed to create T631 interview:", error);
        res.status(500).json({ message: "Failed to create interview" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        // worker/job are immutable after creation: an interview belongs to one
        // [job, worker] pair; re-pointing it would silently rewrite history.
        const parsed = insertSitespecificT631JobInterviewSchema
          .partial()
          .omit({ workerId: true, jobId: true })
          .parse(req.body);
        // Same row lock as the persona transition endpoint so an admin edit
        // can't race a concurrent transition from a stale read.
        const record = await runInTransaction(async () => {
          const locked = await interviewsStorage.getForUpdate(req.params.id);
          if (!locked) return undefined;
          return interviewsStorage.update(locked.id, parsed);
        });
        if (!record) return res.status(404).json({ message: "Interview not found" });
        res.json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        console.error("Failed to update T631 interview:", error);
        res.status(500).json({ message: "Failed to update interview" });
      }
    },
  );

  // ------------------------------------------------------------------
  // Persona-scoped views + status transitions.
  //
  // Personas (a caller may hold several; capabilities are the union):
  //   staff    — 'staff' policy
  //   employer — contact linked to the job's employer (employer.mine)
  //   worker   — the interview's worker is the caller's own worker record
  // All rules live in ./interview-rules (pure, verifier-covered); routes
  // only resolve WHO the caller is.
  // ------------------------------------------------------------------

  type ResolvedCaller = {
    isStaff: boolean;
    contactId?: string;
    workerId?: string;
  };

  const resolveCaller = async (req: Request): Promise<ResolvedCaller> => {
    const isStaff = (await checkAccessInline(req, "staff")).granted;
    const user = (req as any).user;
    const session = (req as any).session;
    const { dbUser } = await getEffectiveUser(session, user);
    if (!dbUser?.email) return { isStaff };
    const contact = await storage.contacts?.getContactByEmail?.(dbUser.email);
    if (!contact) return { isStaff };
    const worker = await storage.workers.getWorkerByContactId(contact.id);
    return { isStaff, contactId: contact.id, workerId: worker?.id };
  };

  // Employer persona = the SAME check the job tab policy delegates to
  // (employer.mine: 'employer' permission + contact linked to the employer),
  // so the direct API can't be more permissive than the protected UI.
  // employer.mine also grants staff, so callers must subtract isStaff when
  // they need "employer and not staff".
  const isEmployerFor = async (
    req: Request,
    employerId: string | null | undefined,
  ): Promise<boolean> => {
    if (!employerId) return false;
    return (await checkAccessInline(req, "employer.mine", employerId)).granted;
  };

  const personasForInterview = async (
    req: Request,
    caller: ResolvedCaller,
    interview: Pick<SitespecificT631JobInterview, "workerId" | "jobId">,
    jobEmployerId: string | null | undefined,
  ): Promise<InterviewPersona[]> => {
    const personas: InterviewPersona[] = [];
    if (caller.isStaff) personas.push("staff");
    else if (await isEmployerFor(req, jobEmployerId)) personas.push("employer");
    if (caller.workerId && caller.workerId === interview.workerId) personas.push("worker");
    return personas;
  };

  /** UI affordances the server actually enforces, per interview row. */
  const viewerCapabilities = (personas: InterviewPersona[], status: InterviewStatus) => ({
    personas,
    allowedTargetStatuses: allowedTargetStatuses(personas, status),
    editableCommentSlots: editableCommentSlots(personas),
  });

  // Interviews for one job: staff see all, linked employers see only
  // accepted/passed/failed. Workers do not access the job-side view.
  app.get(
    "/api/sitespecific/t631/interviews/views/job/:jobId",
    requireAuth,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const job = await storage.dispatchJobs.getWithRelations(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });
        // Mirror the tab policy: interviews must be relevant for this job
        // (interview-required plugin on the job type, or existing rows).
        if (!(await jobInterviewsAvailable(storage, job))) {
          return res.status(404).json({ message: "Interviews are not enabled for this job" });
        }

        const caller = await resolveCaller(req);
        const isEmployer = !caller.isStaff && (await isEmployerFor(req, job.employerId));
        if (!caller.isStaff && !isEmployer) {
          return res.status(403).json({ message: "No access to interviews for this job" });
        }

        let interviews = await interviewsStorage.getByJob(job.id);
        if (!caller.isStaff) {
          interviews = interviews.filter((i) =>
            EMPLOYER_VISIBLE_STATUSES.has(i.status as InterviewStatus),
          );
        }

        const rows = await Promise.all(
          interviews.map(async (interview) => {
            const worker = await storage.workers.getWorker(interview.workerId);
            const contact = worker ? await storage.contacts.getContact(worker.contactId) : undefined;
            const phones = contact
              ? await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contact.id)
              : [];
            const primaryPhone =
              phones.find((p: any) => p.isPrimary)?.phoneNumber ?? phones[0]?.phoneNumber ?? null;
            const personas: InterviewPersona[] = caller.isStaff ? ["staff"] : ["employer"];
            return {
              id: interview.id,
              workerId: interview.workerId,
              jobId: interview.jobId,
              status: interview.status,
              comments: readComments(interview.data),
              worker: worker
                ? {
                    id: worker.id,
                    siriusId: worker.siriusId,
                    name: contact?.displayName ?? "Unknown",
                    email: contact?.email ?? null,
                    phone: primaryPhone,
                  }
                : null,
              viewer: viewerCapabilities(personas, interview.status as InterviewStatus),
            };
          }),
        );

        res.json({
          job: { id: job.id, title: job.title, employerName: job.employer?.name ?? null },
          viewer: { isStaff: caller.isStaff, isEmployer },
          interviews: rows,
        });
      } catch (error) {
        console.error("Failed to fetch T631 job interviews view:", error);
        res.status(500).json({ message: "Failed to fetch interviews" });
      }
    },
  );

  // Offers view: staff-only. Lists workers who WOULD be eligible for this
  // job if the interview eligibility plugin were ignored, marked with any
  // existing interview for the job so staff can see who's been offered.
  app.get(
    "/api/sitespecific/t631/interviews/views/job/:jobId/offers",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const job = await storage.dispatchJobs.getWithRelations(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });
        if (!(await jobInterviewsAvailable(storage, job))) {
          return res.status(404).json({ message: "Interviews are not enabled for this job" });
        }

        const { limit: limitParam, offset: offsetParam, name: nameParam } = req.query;
        const limit = Math.min(parseInt(limitParam as string) || 100, 500);
        const offset = parseInt(offsetParam as string) || 0;
        const filters: { name?: string; excludePluginIds: string[] } = {
          // The whole point of this view: eligibility WITHOUT the interview
          // requirement. All other plugins still apply. Dispatch create and
          // accept are unaffected (they always run the full plugin set).
          excludePluginIds: ["sitespecific_t631_interview"],
        };
        if (nameParam && typeof nameParam === "string" && nameParam.trim()) {
          filters.name = nameParam.trim();
        }

        const { createDispatchEligibleWorkersStorage } = await import(
          "../../../storage/dispatch/eligible-workers"
        );
        const eligible = await createDispatchEligibleWorkersStorage().getEligibleWorkersForJob(
          job.id,
          limit,
          offset,
          filters,
        );

        const interviews = await interviewsStorage.getByJob(job.id);
        const byWorker = new Map(interviews.map((i) => [i.workerId, i]));

        res.json({
          job: { id: job.id, title: job.title, employerName: job.employer?.name ?? null },
          total: eligible.total,
          workers: eligible.workers.map((w) => {
            const interview = byWorker.get(w.id);
            return {
              id: w.id,
              siriusId: w.siriusId,
              name: w.displayName,
              interview: interview
                ? { id: interview.id, status: interview.status }
                : null,
            };
          }),
        });
      } catch (error) {
        console.error("Failed to fetch T631 interview offers view:", error);
        res.status(500).json({ message: "Failed to fetch interview offers" });
      }
    },
  );

  // Staff offer creation: the generic POST above is admin-only, but the
  // Offers subtab is a staff feature. Narrow scope: status is forced to
  // "offered"; nothing else is settable.
  app.post(
    "/api/sitespecific/t631/interviews/views/job/:jobId/offers",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const job = await storage.dispatchJobs.getWithRelations(req.params.jobId);
        if (!job) return res.status(404).json({ message: "Dispatch job not found" });
        if (!(await jobInterviewsAvailable(storage, job))) {
          return res.status(404).json({ message: "Interviews are not enabled for this job" });
        }
        const { workerId } = z.object({ workerId: z.string().min(1) }).strict().parse(req.body);

        // Enforce the same eligibility contract the Offers list shows: the
        // worker must be eligible under every enabled plugin EXCEPT the
        // interview requirement. Direct API calls can't offer interviews to
        // workers blocked by bans, skills, status, etc.
        const worker = await storage.workers.getWorker(workerId);
        if (!worker) return res.status(400).json({ message: "Worker does not exist" });
        const { createDispatchEligibleWorkersStorage } = await import(
          "../../../storage/dispatch/eligible-workers"
        );
        const eligible = await createDispatchEligibleWorkersStorage().getEligibleWorkersForJob(
          job.id,
          1,
          0,
          {
            siriusId: worker.siriusId,
            excludePluginIds: ["sitespecific_t631_interview"],
          },
        );
        if (!eligible.workers.some((w) => w.id === workerId)) {
          return res.status(422).json({
            message:
              "This worker is not eligible for the job (aside from the interview requirement), so an interview cannot be offered",
          });
        }

        const record = await interviewsStorage.create({
          workerId,
          jobId: job.id,
          status: "offered",
        });
        res.status(201).json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res
            .status(409)
            .json({ message: "This worker already has an interview for this job" });
        }
        if (error?.code === "23503") {
          return res.status(400).json({ message: "Worker does not exist" });
        }
        console.error("Failed to create T631 interview offer:", error);
        res.status(500).json({ message: "Failed to create interview offer" });
      }
    },
  );

  // Lightweight existence check used by WorkerLayout to hide the worker
  // Interviews tab when there are no interview rows. Same gating as the
  // worker view below.
  app.get(
    "/api/sitespecific/t631/interviews/views/worker/:workerId/exists",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.view", (req) => req.params.workerId),
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return res.json({ exists: false });
        const rows = await interviewsStorage.getByWorker(req.params.workerId);
        res.json({ exists: rows.length > 0 });
      } catch (error) {
        console.error("Failed T631 worker interviews existence check:", error);
        res.status(500).json({ message: "Failed to check interviews" });
      }
    },
  );

  // A worker's interviews: staff or the worker themselves (worker.view
  // policy — providers get a read-only view with no capabilities).
  app.get(
    "/api/sitespecific/t631/interviews/views/worker/:workerId",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.view", (req) => req.params.workerId),
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const caller = await resolveCaller(req);
        const isSelf = !!caller.workerId && caller.workerId === req.params.workerId;

        const interviews = await interviewsStorage.getByWorker(req.params.workerId);
        const rows = await Promise.all(
          interviews.map(async (interview) => {
            const job = await storage.dispatchJobs.getWithRelations(interview.jobId);
            const facilityLink = job
              ? await storage.dispatchJobFacility.getByJob(job.id).catch(() => undefined)
              : undefined;
            const personas: InterviewPersona[] = [];
            if (caller.isStaff) personas.push("staff");
            if (isSelf) personas.push("worker");
            return {
              id: interview.id,
              workerId: interview.workerId,
              jobId: interview.jobId,
              status: interview.status,
              comments: readComments(interview.data),
              job: job
                ? {
                    id: job.id,
                    title: job.title,
                    employerName: job.employer?.name ?? null,
                    facilityName: facilityLink?.facility?.name ?? null,
                    startDate: job.startYmd ?? null,
                    description: job.description ?? null,
                  }
                : null,
              viewer: viewerCapabilities(personas, interview.status as InterviewStatus),
            };
          }),
        );

        res.json({
          viewer: { isStaff: caller.isStaff, isSelf },
          interviews: rows,
        });
      } catch (error) {
        console.error("Failed to fetch T631 worker interviews view:", error);
        res.status(500).json({ message: "Failed to fetch interviews" });
      }
    },
  );

  const transitionSchema = z
    .object({
      status: z.enum(INTERVIEW_STATUSES as [InterviewStatus, ...InterviewStatus[]]).optional(),
      comments: z
        .object({
          worker: z.string().max(5000).optional(),
          employer: z.string().max(5000).optional(),
          staff: z.string().max(5000).optional(),
        })
        .strict()
        .optional(),
    })
    .strict();

  // Status transition and/or comment save. Persona rules enforced here
  // regardless of what the UI offered; the row is locked for the whole
  // validate-then-update window so a concurrent transition can't let a
  // stale one through.
  app.post(
    "/api/sitespecific/t631/interviews/:id/transition",
    requireAuth,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const body = transitionSchema.parse(req.body);

        const existing = await interviewsStorage.get(req.params.id);
        if (!existing) return res.status(404).json({ message: "Interview not found" });
        const job = await storage.dispatchJobs.get(existing.jobId);

        const caller = await resolveCaller(req);
        const personas = await personasForInterview(req, caller, existing, job?.employerId);
        if (personas.length === 0) {
          return res.status(403).json({ message: "No access to this interview" });
        }
        // Employers only ever SEE accepted/passed/failed — an employer-only
        // caller must not learn about (or comment on) other statuses via the
        // direct API. 404, not 403: the row is invisible to them.
        const employerOnly = !personas.includes("staff") && !personas.includes("worker");

        type TransitionResult =
          | { error: 403 | 404; message: string }
          | { error?: undefined; updated: SitespecificT631JobInterview };
        const result = await runInTransaction<TransitionResult>(async () => {
          const locked = await interviewsStorage.getForUpdate(req.params.id);
          if (!locked) return { error: 404 as const, message: "Interview not found" };
          if (
            employerOnly &&
            !EMPLOYER_VISIBLE_STATUSES.has(locked.status as InterviewStatus)
          ) {
            return { error: 404 as const, message: "Interview not found" };
          }

          const current = locked.status as InterviewStatus;
          const transition = validateTransition(personas, current, body.status);
          if (!transition.ok) return { error: 403 as const, message: transition.reason! };
          const commentCheck = validateCommentEdits(personas, body.comments);
          if (!commentCheck.ok) return { error: 403 as const, message: commentCheck.reason! };

          const updated = await interviewsStorage.update(locked.id, {
            status: body.status ?? current,
            data: mergeComments(locked.data, body.comments),
          });
          if (!updated) return { error: 404 as const, message: "Interview not found" };
          return { updated };
        });

        if (result.error !== undefined) {
          return res.status(result.error).json({ message: result.message });
        }
        const updated = result.updated;
        res.json({
          id: updated.id,
          workerId: updated.workerId,
          jobId: updated.jobId,
          status: updated.status,
          comments: readComments(updated.data),
          viewer: viewerCapabilities(personas, updated.status as InterviewStatus),
        });
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        console.error("Failed to transition T631 interview:", error);
        res.status(500).json({ message: "Failed to update interview" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const deleted = await interviewsStorage.delete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Interview not found" });
        res.status(204).end();
      } catch (error) {
        console.error("Failed to delete T631 interview:", error);
        res.status(500).json({ message: "Failed to delete interview" });
      }
    },
  );
}
