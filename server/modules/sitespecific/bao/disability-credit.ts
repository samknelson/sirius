import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
import crypto from "crypto";
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
  getNextQueuedDcCaseId,
  performDcCaseAction,
  mutateEvidenceAndRecompute,
  type DcCaseAction,
} from "../../../services/sitespecific/bao/dc-workflow";
import { fileSystemService, FileSystemNotConfiguredError } from "../../../services/files";
import {
  resolveUsableContextConfig,
  expandDirectoryTemplate,
  isExtensionAllowed,
} from "../../../services/entity-files/config";
import { insertFileSchema } from "@shared/schema";
import { listDcApprovalQueue } from "../../../services/sitespecific/bao/dc-reporting";
import { buildDcYearUsage } from "@shared/sitespecific/bao/dc-reporting";
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

const intakeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const attestationsSchema = z.object({
  dcFormOnFile: z.boolean().optional(),
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

const extendSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  confirmDuplicate: z.boolean().optional(),
  /** Optional initial eligible additional months (first-of-month Ymds). */
  months: z.array(z.string().regex(/^\d{4}-\d{2}-01$/)).max(60).optional(),
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
    DC_FORM_ATTESTATION_REQUIRES_FORM: [
      422,
      "A current document must be classified as a DC form before it can be attested as on file",
    ],
    EXTENSION_PARENT_NOT_APPROVED: [409, "Only an approved case can be extended"],
    EXTENSION_REASON_REQUIRED: [400, "An extension reason is required"],
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
        const yearUsage = buildDcYearUsage(applicable);
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

  // -------------------------------------------------------------------------
  // Document-first member intake: one multipart submission either OPENS an
  // eligible case with its first document attached, or ADDS the document to
  // the worker's existing open case — atomically (bytes first, then the case
  // + files + document rows in ONE transaction under the worker lock, so a
  // failed insert leaves only a sweepable orphan object and NO case).
  // Member uploads stay docType "other" until an MSR classifies them.
  // -------------------------------------------------------------------------
  app.post(
    "/api/workers/:workerId/sitespecific/bao/dc/intake",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dc", (req) => req.params.workerId),
    intakeUpload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId;
        if (!req.file) {
          res.status(400).json({ message: "No file provided" });
          return;
        }
        const usable = await resolveUsableContextConfig("bao-dc-case");
        if (!usable.config) {
          res.status(503).json({ message: usable.reason });
          return;
        }
        if (!isExtensionAllowed(req.file.originalname, usable.config.allowed)) {
          res.status(400).json({
            message: `File type not allowed. Allowed extensions: ${usable.config.allowed!.join(", ")}`,
          });
          return;
        }
        const actor = await actorId(req);

        // Pick the target case OUTSIDE the tx only to resolve the storage
        // path; the authoritative re-check happens under the worker lock.
        const openCases = await dc.listOpenCasesForWorker(workerId);
        let eligibilityBasis: Awaited<
          ReturnType<typeof computeDcEligibilityForWorker>
        >["basis"] | null = null;
        if (openCases.length === 0) {
          const eligibility = await computeDcEligibilityForWorker(workerId, todayYmd());
          if (!eligibility.eligible) {
            res.status(422).json({
              message: "Worker is not currently eligible for Disability Credit",
              code: "NOT_ELIGIBLE",
            });
            return;
          }
          eligibilityBasis = eligibility.basis;
        }
        const targetCaseId =
          openCases.length > 0
            ? openCases[openCases.length - 1].id
            : crypto.randomUUID();

        const directory = expandDirectoryTemplate(usable.config.directory, {
          ":worker-id": workerId,
          ":case-id": targetCaseId,
        });
        const safeName = req.file.originalname.split(/[/\\]/).pop() || "file";
        const customPath = `${directory ? directory + "/" : ""}${Date.now()}-${safeName.replace(/[^\w.\-]+/g, "_").slice(0, 200)}`;

        // Bytes first — a failure below leaves a sweepable orphan object.
        const uploadResult = await fileSystemService.upload({
          fileSystemId: usable.config.file_system,
          fileName: req.file.originalname,
          fileContent: req.file.buffer,
          mimeType: req.file.mimetype,
          customPath,
        });

        const fileData = insertFileSchema.parse({
          fileName: req.file.originalname,
          storagePath: uploadResult.storagePath,
          mimeType: req.file.mimetype,
          size: uploadResult.size,
          uploadedBy: actor,
          entityType: "entity-files:bao-dc-case",
          entityId: targetCaseId,
          fileSystemId: usable.config.file_system,
          metadata: null,
        });
        const displayName = req.file.originalname.slice(0, 255);

        const result = await dc.withWorkerSerialization(workerId, async () => {
          // Authoritative in-tx re-check: attach to the newest open case if
          // one exists (even if it appeared concurrently), else open the
          // pre-identified case id.
          const openNow = await dc.listOpenCasesForWorker(workerId);
          if (openNow.length > 0) {
            const caseId = openNow[openNow.length - 1].id;
            const document = await dc.attachCaseDocumentWithFile(
              caseId,
              { ...fileData, entityId: caseId },
              displayName,
              { uploadedByUserId: actor },
            );
            return { theCase: openNow[openNow.length - 1], document, created: false };
          }
          if (!eligibilityBasis) {
            // The open case this submission was going to extend closed
            // concurrently — refuse rather than open an unvetted case.
            throw new Error("QUALIFYING_BASIS_REQUIRED");
          }
          const staff = await isStaff(req);
          const theCase = await dc.openCase({
            id: targetCaseId,
            workerId,
            openedYmd: todayYmd(),
            qualifyingBasis: eligibilityBasis,
            intakeChannel: staff ? "msr" : "member_portal",
            createdByUserId: actor,
          });
          const document = await dc.attachCaseDocumentWithFile(
            theCase.id,
            fileData,
            displayName,
            { uploadedByUserId: actor },
          );
          return { theCase, document, created: true };
        });
        res.status(201).json({
          case: result.theCase,
          document: result.document,
          created: result.created,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          res.status(400).json({ message: "Invalid request", errors: error.errors });
          return;
        }
        if (error instanceof FileSystemNotConfiguredError) {
          res.status(503).json({ message: error.message });
          return;
        }
        handleDcError(res, error);
      }
    },
  );

  // Extend an approved case — STAFF only. Records an auditable extension
  // request (required reason) as a NEW linked draft case routed through the
  // normal review/approval flow; the original case stays approved.
  app.post(
    "/api/sitespecific/bao/dc/cases/:caseId/extend",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = extendSchema.parse(req.body ?? {});
        const actor = await actorId(req);
        const extension = await dc.openCaseExtension(req.params.caseId, {
          reason: body.reason,
          actorUserId: actor,
          allowDuplicate: body.confirmDuplicate === true,
        });
        let months = undefined;
        if (body.months && body.months.length > 0) {
          months = await dc.replaceCaseMonths(extension.id, body.months, {
            actorUserId: actor,
          });
        }
        res.status(201).json({ case: extension, ...(months ? { months } : {}) });
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
        // Queue continuation: after finishing this case, offer the oldest
        // still-open queued case so MSRs/approvers can keep working.
        const nextCaseId = await getNextQueuedDcCaseId([req.params.caseId]);
        res.json({ ...result, nextCaseId });
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
        // Shared live-query service — the SAME rows the dashboard shows.
        res.json(await listDcApprovalQueue());
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );

  // Next still-open queued case (oldest first), excluding ?after=<caseId>.
  // Resolves null cleanly when the queue is empty or drained concurrently.
  app.get(
    "/api/sitespecific/bao/dc/queue/next",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const after = typeof req.query.after === "string" ? [req.query.after] : [];
        res.json({ nextCaseId: await getNextQueuedDcCaseId(after) });
      } catch (error) {
        handleDcError(res, error);
      }
    },
  );
}
