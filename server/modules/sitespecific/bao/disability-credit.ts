import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  buildContext,
  checkAccessInline,
} from "../../../services/access-policy-evaluator";
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  BAO_DC_CASE_STATUSES,
  BAO_DC_DOCUMENT_TYPES,
  type BaoDcAttestations,
} from "@shared/schema";
import {
  computeDcEligibilityForWorker,
} from "../../../services/sitespecific/bao/dc-eligibility";
import {
  getDcCaseBundle,
  performDcCaseAction,
  mutateEvidenceAndRecompute,
  type DcCaseAction,
} from "../../../services/sitespecific/bao/dc-workflow";
import { DcSelectionInvalidError } from "../../../storage/sitespecific/bao/disability-credit";
import { logger } from "../../../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const todayYmd = () => new Date().toISOString().slice(0, 10);

const openCaseSchema = z.object({
  confirmDuplicate: z.boolean().optional(),
});

const monthsSchema = z.object({
  months: z.array(z.string().regex(/^\d{4}-\d{2}-01$/)).max(60),
});

const attestationsSchema = z.object({
  signed: z.boolean().optional(),
  restrictionsNoted: z.boolean().optional(),
  fields: z
    .object({
      doctorAddress: z.boolean().optional(),
      doctorPhone: z.boolean().optional(),
      dates: z.boolean().optional(),
    })
    .optional(),
});

const documentUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  docType: z.enum(BAO_DC_DOCUMENT_TYPES).optional(),
});

const actionSchema = z.object({
  action: z.enum(["mark_ready", "queue", "bounce", "approve", "deny", "withdraw"]),
  reason: z.string().max(2000).optional(),
  expectedStatus: z.enum(BAO_DC_CASE_STATUSES).optional(),
});

const noteSchema = z.object({
  body: z.string().min(1).max(10000),
  correctsNoteId: z.string().optional(),
});

/** Map coded storage errors onto HTTP responses. */
function handleDcError(res: Response, error: unknown): void {
  if (error instanceof DcSelectionInvalidError) {
    res.status(422).json({
      message: "Month selection is not valid",
      code: "MONTH_SELECTION_INVALID",
      validation: error.validation,
    });
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  const map: Record<string, [number, string]> = {
    CASE_NOT_FOUND: [404, "Case not found"],
    DUPLICATE_OPEN_CASE: [409, "This worker already has an open Disability Credit case"],
    INVALID_TRANSITION: [409, "That status change is not allowed from the case's current status"],
    CASE_ALREADY_TERMINAL: [409, "The case has already been finalized"],
    STALE_CASE_STATE: [409, "The case changed while you were working — reload and try again"],
    TERMINAL_REASON_REQUIRED: [400, "A reason is required"],
    CASE_NOT_READY: [422, "The case does not pass the readiness checklist"],
    CASE_NOT_EDITABLE: [409, "The case can no longer be edited"],
    MONTHS_ONLY_IN_DRAFT: [409, "Months can only be changed while the case is in draft"],
    MONTH_NOT_EDITABLE: [409, "A queued or granted month cannot be changed here"],
    NOTE_BODY_REQUIRED: [400, "Note text is required"],
    CORRECTED_NOTE_NOT_ON_CASE: [400, "The corrected note is not on this case"],
    DOCUMENT_NOT_FOUND: [404, "Document not found"],
    QUALIFYING_BASIS_REQUIRED: [422, "Worker is not eligible for Disability Credit"],
    COMPONENT_TABLE_NOT_FOUND: [503, "Disability Credit tables are not installed"],
  };
  const hit = map[msg];
  if (hit) {
    const details = (error as Error & { details?: unknown }).details;
    res.status(hit[0]).json({ message: hit[1], code: msg, ...(details ? { details } : {}) });
    return;
  }
  logger.error("DC route failure", {
    service: "baoDisabilityCredit",
    error: msg,
  });
  res.status(500).json({ message: "Internal error" });
}

export function registerBaoDisabilityCreditRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const componentMiddleware = requireComponent("sitespecific.bao");
  const dc = storage.baoDisabilityCredit;

  const workerFromCase = async (req: Request): Promise<string | undefined> => {
    const theCase = await dc.getCase(req.params.caseId);
    return theCase?.workerId;
  };

  const actorId = async (req: Request): Promise<string> => {
    const ctx = await buildContext(req);
    const id = ctx.user?.id;
    if (!id) throw new Error("NO_USER");
    return id;
  };

  const isStaff = (req: Request) =>
    checkAccessInline(req, "staff").then((r) => r.granted);

  // -------------------------------------------------------------------------
  // Worker DC summary (tab landing): eligibility, cases, usage, letters.
  // Gated by worker.dc — staff, or the member's own record when they have a
  // case or are eligible. The SAME policy gates case creation below, so an
  // ineligible member can neither see the start action nor call the API.
  // -------------------------------------------------------------------------
  app.get(
    "/api/workers/:workerId/sitespecific/bao/dc",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dc", (req) => req.params.workerId),
    async (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId;
        const [eligibility, cases, applicable] = await Promise.all([
          computeDcEligibilityForWorker(workerId, todayYmd()),
          dc.listCasesForWorker(workerId),
          dc.listApplicableMonthsForWorker(workerId),
        ]);
        const yearUsage: Record<string, { used: number; limit: number }> = {};
        for (const m of applicable) {
          const year = m.workMonthYmd.slice(0, 4);
          yearUsage[year] = yearUsage[year] ?? { used: 0, limit: BAO_DC_ANNUAL_MONTH_LIMIT };
          yearUsage[year].used += 1;
        }
        const openCases = cases.filter((c) =>
          ["draft", "ready_for_review", "in_queue"].includes(c.status),
        );
        res.json({
          eligibility,
          cases,
          hasOpenCase: openCases.length > 0,
          yearUsage,
          isStaff: await isStaff(req),
        });
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );

  // Open a case. Staff or the member (own record, eligible — worker.dc).
  // The server re-checks eligibility; a second open case needs the explicit
  // confirmDuplicate flag after the UI warning.
  app.post(
    "/api/workers/:workerId/sitespecific/bao/dc/cases",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dc", (req) => req.params.workerId),
    async (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId;
        const body = openCaseSchema.parse(req.body ?? {});
        const eligibility = await computeDcEligibilityForWorker(workerId, todayYmd());
        if (!eligibility.eligible) {
          res.status(422).json({
            message: "Worker is not currently eligible for Disability Credit",
            code: "NOT_ELIGIBLE",
          });
          return;
        }
        const staff = await isStaff(req);
        const created = await dc.openCase({
          workerId,
          openedYmd: todayYmd(),
          qualifyingBasis: eligibility.basis,
          intakeChannel: staff ? "msr" : "member_portal",
          createdByUserId: await actorId(req),
          allowDuplicate: body.confirmDuplicate === true,
        });
        res.status(201).json(created);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Case detail bundle: staff, or the member who owns the case.
  app.get(
    "/api/sitespecific/bao/dc/cases/:caseId",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dc", workerFromCase),
    async (req: Request, res: Response) => {
      try {
        const bundle = await getDcCaseBundle(req.params.caseId);
        if (!bundle) {
          res.status(404).json({ message: "Case not found" });
          return;
        }
        res.json({ ...bundle, isStaff: await isStaff(req) });
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );

  // Notes: append-only; members may add notes to their own case too.
  app.post(
    "/api/sitespecific/bao/dc/cases/:caseId/notes",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dc", workerFromCase),
    async (req: Request, res: Response) => {
      try {
        const body = noteSchema.parse(req.body ?? {});
        const note = await dc.addCaseNote({
          caseId: req.params.caseId,
          authorUserId: await actorId(req),
          body: body.body,
          correctsNoteId: body.correctsNoteId ?? null,
        });
        res.status(201).json(note);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Month selection preview — STAFF (members never select months).
  app.post(
    "/api/sitespecific/bao/dc/cases/:caseId/months/validate",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = monthsSchema.parse(req.body ?? {});
        res.json(await dc.validateMonthSelectionForCase(req.params.caseId, body.months));
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Month selection replace — STAFF only.
  app.put(
    "/api/sitespecific/bao/dc/cases/:caseId/months",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = monthsSchema.parse(req.body ?? {});
        const months = await dc.replaceCaseMonths(req.params.caseId, body.months, {
          actorUserId: await actorId(req),
        });
        res.json(months);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Attestations — STAFF only; recompute readiness (may auto-bounce).
  app.put(
    "/api/sitespecific/bao/dc/cases/:caseId/attestations",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = attestationsSchema.parse(req.body ?? {}) as BaoDcAttestations;
        const actor = await actorId(req);
        const { result: updated, readiness, bounced } = await mutateEvidenceAndRecompute(
          req.params.caseId,
          actor,
          () => dc.updateCaseAttestations(req.params.caseId, body, actor),
        );
        res.json({ case: bounced ? await dc.getCase(updated.id) : updated, readiness, bounced });
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Reclassify/rename a document — STAFF only; recompute readiness (may
  // auto-bounce a ready/in-queue case whose evidence stops passing). The
  // generic entity-files PATCH refuses DC updates so this is the ONLY path.
  app.patch(
    "/api/sitespecific/bao/dc/cases/:caseId/documents/:documentId",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = documentUpdateSchema.parse(req.body ?? {});
        const doc = await dc.getCaseDocument(req.params.caseId, req.params.documentId);
        if (!doc) {
          res.status(404).json({ message: "Document not found" });
          return;
        }
        const { result: updated, readiness, bounced } = await mutateEvidenceAndRecompute(
          req.params.caseId,
          await actorId(req),
          () =>
            dc.updateCaseDocument(req.params.caseId, req.params.documentId, {
              name: body.name,
              docType: body.docType,
            }),
        );
        res.json({ document: updated, readiness, bounced });
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Supersede a document — STAFF only; recompute readiness (may auto-bounce).
  app.post(
    "/api/sitespecific/bao/dc/cases/:caseId/documents/:documentId/supersede",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const doc = await dc.getCaseDocument(req.params.caseId, req.params.documentId);
        if (!doc) {
          res.status(404).json({ message: "Document not found" });
          return;
        }
        const actor = await actorId(req);
        const { result: updated, readiness, bounced } = await mutateEvidenceAndRecompute(
          req.params.caseId,
          actor,
          () => dc.supersedeDocument(req.params.documentId, actor),
        );
        res.json({ document: updated, readiness, bounced });
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );

  // Lifecycle actions — STAFF only (approve/deny recheck readiness inside).
  app.post(
    "/api/sitespecific/bao/dc/cases/:caseId/actions",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = actionSchema.parse(req.body ?? {});
        const result = await performDcCaseAction(req.params.caseId, body.action as DcCaseAction, {
          actorUserId: await actorId(req),
          reason: body.reason,
          expectedStatus: body.expectedStatus,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Approval queue — STAFF; oldest first, with queue age + live readiness.
  app.get(
    "/api/sitespecific/bao/dc/queue",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (_req: Request, res: Response) => {
      try {
        const cases = await dc.listCasesByStatus("in_queue");
        const rows = await Promise.all(
          cases.map(async (c) => {
            const [bundle, events] = await Promise.all([
              getDcCaseBundle(c.id),
              dc.listEventsForCase(c.id),
            ]);
            const queuedEvent = [...events]
              .reverse()
              .find(
                (e) =>
                  e.eventType === "case_status_changed" &&
                  (e.payload as Record<string, unknown>)?.to === "in_queue",
              );
            return {
              case: c,
              queuedAt: queuedEvent?.createdAt ?? c.createdAt,
              readiness: bundle?.readiness,
              monthCount: bundle?.months.filter((m) => m.status !== "removed").length ?? 0,
            };
          }),
        );
        res.json(rows);
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );
}
