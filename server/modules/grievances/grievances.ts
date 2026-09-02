import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { storage } from "../../storage";
import { requireComponent, isComponentEnabled } from "../components";
import { buildContext, getAccessStorage } from "../../services/access-policy-evaluator";
import {
  GRIEVANCE_CARDINALITIES,
  grievanceTimelineAdjustmentSchema,
  APPEAL_META_KEY,
  APPEAL_ONLY_COMPONENT,
  APPEAL_WORKFLOW_VARIABLE,
  appealWorkflowSettingsSchema,
  type AppealWorkflowSettings,
  trustBenefits,
  trustProviders,
  workers,
  optionsGrievanceDenialReason,
  optionsGrievanceStatus,
} from "@shared/schema";
import { getClient } from "../../storage/transaction-context";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const createGrievanceSchema = z
  .object({
    siriusId: z.string().trim().min(1).nullish(),
    classDescription: z.string().trim().min(1).nullish(),
    categoryId: z.string().uuid("A valid category is required"),
    cardinality: z.enum(GRIEVANCE_CARDINALITIES).default("individual"),
    bargainingUnitId: z.string().uuid().nullish(),
  })
  .refine((v) => v.cardinality === "class" || v.classDescription == null, {
    message: "A class description is only allowed for class grievances",
    path: ["classDescription"],
  });

const editWorkerSchema = z
  .object({
    primary: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const updateGrievanceSchema = z
  .object({
    siriusId: z.string().trim().min(1).nullish(),
    classDescription: z.string().trim().min(1).nullish(),
    categoryId: z.string().uuid().optional(),
    cardinality: z.enum(GRIEVANCE_CARDINALITIES).optional(),
    timelineTemplateId: z.string().uuid().nullable().optional(),
    bargainingUnitId: z.string().uuid().nullable().optional(),
    employerContactId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const searchGrievancesSchema = z.object({
  workerId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  employerId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
  kind: z.preprocess(emptyToUndefined, z.enum(["appeal"]).optional()),
});

/**
 * Schema for the appeal intake POST body. `statusId` is optional here because
 * in appeal-only (BAO) mode the initial status comes from the configured
 * appeal workflow settings instead of the client; outside appeal-only mode
 * the route still requires it.
 */
const createAppealSchema = z.object({
  categoryId: z.string().uuid("A valid category is required"),
  statusId: z.string().uuid("A valid status is required").optional(),
  workerId: z.string().uuid("A valid worker is required"),
  benefitId: z.string().uuid("A valid benefit is required"),
  denialReasonId: z.string().uuid("A valid denial reason is required"),
});

/**
 * Whether this deployment runs the appeal-only surface: the BAO component
 * selects it. When active, generic grievance creation is rejected and appeal
 * intake applies the configured appeal workflow defaults.
 */
async function isAppealOnlyMode(): Promise<boolean> {
  return isComponentEnabled(APPEAL_ONLY_COMPONENT);
}

/**
 * Load and validate the BAO appeal workflow settings. Returns an error string
 * (never throws) when the variable is missing or malformed so the intake
 * route can fail loudly with an actionable message.
 */
async function loadAppealWorkflowSettings(): Promise<
  { ok: true; settings: AppealWorkflowSettings } | { ok: false; message: string }
> {
  const row = await storage.variables.getByName(APPEAL_WORKFLOW_VARIABLE);
  if (!row) {
    return {
      ok: false,
      message: `Appeal workflow settings are not configured. An administrator must set the "${APPEAL_WORKFLOW_VARIABLE}" variable (initial status and timeline template) before appeals can be created.`,
    };
  }
  const parsed = appealWorkflowSettingsSchema.safeParse(row.value);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Appeal workflow settings are invalid. An administrator must correct the "${APPEAL_WORKFLOW_VARIABLE}" variable (initial status and timeline template).`,
    };
  }
  return { ok: true, settings: parsed.data };
}

const linkWorkerSchema = z.object({ workerId: z.string().uuid("A valid worker is required") });
const linkEmployerSchema = z.object({ employerId: z.string().uuid("A valid employer is required") });

const addUserSchema = z.object({
  userId: z.string().uuid("A valid user is required"),
  roleId: z.string().uuid("A valid role is required"),
  data: z.unknown().optional(),
});
const updateUserSchema = z
  .object({
    roleId: z.string().uuid("A valid role is required").optional(),
    data: z.unknown().optional(),
  })
  .refine((v) => v.roleId !== undefined || v.data !== undefined, {
    message: "Provide a role or data to update",
  });

const addLineSchema = z.object({
  optionId: z.string().uuid().nullish(),
  description: z.string().trim().min(1, "A description is required"),
});

const updateLineSchema = z
  .object({
    optionId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).optional(),
    sequence: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });

// Settlements: `numeric(10,2)` allows up to 8 integer digits and 2 decimals.
// Amounts travel as decimal strings to preserve exact precision.
const settlementAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,2})?$/, "Amount must be a number with up to 2 decimal places");

// Multi-value reference to `options_grievance_settlement_type`. The client
// sends the full list of selected type ids; an empty array clears them.
const settlementTypeIdsSchema = z.array(z.string().trim().min(1));

const addSettlementSchema = z
  .object({
    description: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    amount: z.preprocess(emptyToUndefined, settlementAmountSchema.optional()),
    typeIds: settlementTypeIdsSchema.optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.amount !== undefined ||
      (v.typeIds !== undefined && v.typeIds.length > 0),
    {
      message: "Provide a description, an amount, or a settlement type",
    },
  );

const updateSettlementSchema = z
  .object({
    description: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).nullable().optional(),
    ),
    amount: z.preprocess(emptyToUndefined, settlementAmountSchema.nullable().optional()),
    typeIds: settlementTypeIdsSchema.optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.amount !== undefined ||
      v.typeIds !== undefined,
    {
      message: "At least one field must be provided",
    },
  );

// Status history. `date` is an ISO timestamp; it may be omitted on create
// (the server stamps "now") but is required to be in the past when given.
const addStatusHistorySchema = z.object({
  statusId: z.string().uuid("A valid status is required"),
  date: z.coerce.date().optional(),
});

const updateStatusHistorySchema = z
  .object({
    statusId: z.string().uuid("A valid status is required").optional(),
    date: z.coerce.date().optional(),
  })
  .refine((v) => v.statusId !== undefined || v.date !== undefined, {
    message: "At least one field must be provided",
  });

// Timeline adjustment on a status history entry: null clears it.
const setTimelineAdjustmentSchema = z.object({
  adjustment: grievanceTimelineAdjustmentSchema.nullable(),
});

const setContractSchema = z.object({
  contractId: z.string().uuid("A valid contract is required"),
});

const addSectionsSchema = z.object({
  sectionIds: z
    .array(z.string().uuid("A valid section is required"))
    .min(1, "Select at least one section"),
});

const moveSectionSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export function registerGrievanceRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
  const gate = [requireAuth, requireComponent("grievance"), requireAccess("staff")] as const;

  app.get("/api/grievances", ...gate, async (req, res) => {
    try {
      const parsed = searchGrievancesSchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query parameters", errors: parsed.error.flatten() });
      }
      const records = await storage.grievances.search(parsed.data);
      res.json(records);
    } catch (error) {
      console.error("Failed to fetch grievances:", error);
      res.status(500).json({ message: "Failed to fetch grievances" });
    }
  });

  app.post("/api/grievances", ...gate, async (req, res) => {
    try {
      // Appeal-only (BAO) deployments have exactly one case type: appeals.
      // Generic grievance creation is rejected here (not just hidden in the
      // client) so direct API calls cannot create a second case type.
      if (await isAppealOnlyMode()) {
        return res.status(403).json({
          message:
            "Generic grievance creation is disabled: this deployment is appeal-only. Use the appeal intake (POST /api/grievances/appeal).",
        });
      }
      const parsed = createGrievanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const {
        siriusId,
        classDescription,
        categoryId,
        cardinality,
        bargainingUnitId,
      } = parsed.data;

      // Only admins may set the grievance ID by hand. For everyone else it is
      // auto-generated by the storage layer (passing null triggers generation).
      const context = await buildContext(req);
      const accessStorage = getAccessStorage();
      const isAdmin =
        context.user && accessStorage
          ? await accessStorage.hasPermission(context.user.id, "admin")
          : false;

      const created = await storage.grievances.create({
        siriusId: isAdmin ? (siriusId ?? null) : null,
        classDescription: cardinality === "class" ? (classDescription ?? null) : null,
        categoryId,
        cardinality,
        bargainingUnitId: bargainingUnitId ?? null,
      });

      const fresh = await storage.grievances.getWithDetails(created.id);
      res.status(201).json(fresh);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Grievance ID already in use" });
      }
      console.error("Failed to create grievance:", error);
      res.status(500).json({ message: "Failed to create grievance" });
    }
  });

  // ---- Appeal routes (must precede /:id to avoid capture) -----------------

  /**
   * List active trust benefits with their provider name for the appeal intake
   * form. The carrier is derived from the benefit's provider relationship; this
   * endpoint exposes only the fields the intake form needs.
   */
  app.get("/api/grievances/appeal/benefits", ...gate, async (req, res) => {
    try {
      const client = getClient();
      const rows = await client
        .select({
          id: trustBenefits.id,
          name: trustBenefits.name,
          providerId: trustBenefits.providerId,
          providerName: trustProviders.name,
        })
        .from(trustBenefits)
        .leftJoin(trustProviders, eq(trustBenefits.providerId, trustProviders.id))
        .where(eq(trustBenefits.isActive, true))
        .orderBy(asc(trustBenefits.name));
      res.json(rows);
    } catch (error) {
      console.error("Failed to fetch appeal benefits:", error);
      res.status(500).json({ message: "Failed to fetch benefits" });
    }
  });

  /**
   * Create an appeal grievance:
   *  - Validates category, status, worker, benefit, and denial reason all exist.
   *  - Derives the carrier from the benefit's provider relationship (no
   *    separate carrier entry required).
   *  - Creates an individual grievance with `data.appealMeta` set, links the
   *    worker, and adds the initial status history entry.
   *  - Returns the created grievance (including appeal metadata) so the client
   *    can redirect straight to the detail page for letter upload.
   */
  app.post("/api/grievances/appeal", ...gate, async (req, res) => {
    try {
      const parsed = createAppealSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const { categoryId, workerId, benefitId, denialReasonId } = parsed.data;

      // Resolve the initial status and (in appeal-only mode) the default
      // timeline template. Appeal-only deployments take both from the
      // configured appeal workflow settings — staff never choose an
      // arbitrary initial status. Other deployments keep the pre-existing
      // behavior: the client supplies the status, no template is assigned.
      const appealOnly = await isAppealOnlyMode();
      let statusId: string;
      let timelineTemplateId: string | null = null;
      if (appealOnly) {
        const loaded = await loadAppealWorkflowSettings();
        if (!loaded.ok) {
          return res.status(409).json({ message: loaded.message });
        }
        statusId = loaded.settings.initialStatusId;
        timelineTemplateId = loaded.settings.timelineTemplateId;
        const template = await storage.grievanceTimelineTemplates.get(timelineTemplateId);
        if (!template) {
          return res.status(409).json({
            message:
              "The configured appeal timeline template no longer exists. An administrator must update the appeal workflow settings.",
          });
        }
      } else {
        if (!parsed.data.statusId) {
          return res.status(400).json({ message: "A valid status is required" });
        }
        statusId = parsed.data.statusId;
      }

      const client = getClient();

      // Validate worker exists.
      const [workerRow] = await client
        .select({ id: workers.id })
        .from(workers)
        .where(eq(workers.id, workerId))
        .limit(1);
      if (!workerRow) {
        return res.status(400).json({ message: "Worker not found" });
      }

      const [benefit] = await client
        .select({ id: trustBenefits.id, name: trustBenefits.name, providerId: trustBenefits.providerId })
        .from(trustBenefits)
        .where(eq(trustBenefits.id, benefitId))
        .limit(1);
      if (!benefit) {
        return res.status(400).json({ message: "Benefit not found" });
      }

      // Validate denial reason exists.
      const [denialReason] = await client
        .select({ id: optionsGrievanceDenialReason.id })
        .from(optionsGrievanceDenialReason)
        .where(eq(optionsGrievanceDenialReason.id, denialReasonId))
        .limit(1);
      if (!denialReason) {
        return res.status(400).json({ message: "Denial reason not found" });
      }

      // Validate status exists. In appeal-only mode a missing status means
      // the CONFIGURATION is stale (the client never supplied it), so answer
      // with an actionable conflict instead of an input error.
      const [statusRow] = await client
        .select({ id: optionsGrievanceStatus.id })
        .from(optionsGrievanceStatus)
        .where(eq(optionsGrievanceStatus.id, statusId))
        .limit(1);
      if (!statusRow) {
        if (appealOnly) {
          return res.status(409).json({
            message:
              "The configured initial appeal status no longer exists. An administrator must update the appeal workflow settings.",
          });
        }
        return res.status(400).json({ message: "Status not found" });
      }

      // Create the appeal grievance. The appeal metadata lives in `data` so no
      // new table is required; the carrier (provider) is always derived at read
      // time from `benefit.providerId`.
      const appealMeta = {
        kind: "appeal" as const,
        benefitId,
        denialReasonId,
      };

      const created = await storage.grievances.create({
        categoryId,
        cardinality: "individual",
        timelineTemplateId,
        data: { [APPEAL_META_KEY]: appealMeta } as unknown as null,
      });

      // Link the worker (individual grievance — storage enforces single-worker
      // constraint transactionally).
      const workerResult = await storage.grievances.addWorkerForGrievance(created.id, workerId);
      if ("error" in workerResult) {
        // The grievance was created; surface the partial-failure gracefully so
        // the caller can navigate to the grievance and fix the worker link.
        console.error("Failed to link worker to new appeal grievance:", workerResult.error);
        const fresh = await storage.grievances.getWithDetails(created.id);
        return res.status(201).json({ ...fresh, _warnings: ["Worker could not be linked — add from the grievance page"] });
      }

      // Add the initial status history entry.
      const statusDate = new Date();
      await storage.grievanceStatusHistory.create(created.id, { statusId, date: statusDate });

      const fresh = await storage.grievances.getWithDetails(created.id);
      res.status(201).json(fresh);
    } catch (error: any) {
      console.error("Failed to create appeal grievance:", error);
      res.status(500).json({ message: "Failed to create appeal" });
    }
  });

  app.get("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const record = await storage.grievances.getWithDetails(req.params.id);
      if (!record) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      res.json(record);
    } catch (error) {
      console.error("Failed to fetch grievance:", error);
      res.status(500).json({ message: "Failed to fetch grievance" });
    }
  });

  app.patch("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const parsed = updateGrievanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }

      const existing = await storage.grievances.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Grievance not found" });
      }

      // Only admins may change the grievance ID. Non-admins may re-submit the
      // unchanged value (the edit form always sends it), which is a no-op.
      const context = await buildContext(req);
      const accessStorage = getAccessStorage();
      const isAdmin =
        context.user && accessStorage
          ? await accessStorage.hasPermission(context.user.id, "admin")
          : false;
      if (parsed.data.siriusId !== undefined && !isAdmin) {
        const requestedSiriusId = parsed.data.siriusId ?? null;
        if (requestedSiriusId !== (existing.siriusId ?? null)) {
          return res.status(403).json({ message: "Only admins can change the grievance ID." });
        }
      }

      const newCardinality = parsed.data.cardinality ?? existing.cardinality;
      const newClassDescription =
        parsed.data.classDescription !== undefined
          ? (parsed.data.classDescription ?? null)
          : existing.classDescription;

      // A class description may only exist on a class grievance. Switching away
      // from class requires clearing it in the same request.
      if (newCardinality !== "class" && newClassDescription != null) {
        return res.status(400).json({
          message:
            "A class description is only allowed for class grievances. Clear it before changing the cardinality.",
        });
      }

      // Reject cardinality transitions that the currently-linked workers violate.
      if (
        parsed.data.cardinality !== undefined &&
        parsed.data.cardinality !== existing.cardinality
      ) {
        const stats = await storage.grievances.getWorkerStats(req.params.id);
        if (newCardinality === "class" && stats.count > 0) {
          return res.status(400).json({
            message: "Remove all workers before changing this grievance to a class grievance.",
          });
        }
        if (newCardinality === "individual" && stats.count > 1) {
          return res.status(400).json({
            message:
              "An individual grievance can have at most one worker. Remove the extra workers first.",
          });
        }
        if (newCardinality === "multiple" && stats.primaryCount > 0) {
          return res.status(400).json({
            message: "A multiple grievance cannot have a lead worker. Clear the lead first.",
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (parsed.data.siriusId !== undefined && isAdmin)
        data.siriusId = parsed.data.siriusId ?? null;
      if (parsed.data.classDescription !== undefined)
        data.classDescription = parsed.data.classDescription ?? null;
      if (parsed.data.categoryId !== undefined) data.categoryId = parsed.data.categoryId;
      if (parsed.data.cardinality !== undefined) data.cardinality = parsed.data.cardinality;
      if (parsed.data.timelineTemplateId !== undefined)
        data.timelineTemplateId = parsed.data.timelineTemplateId;
      if (parsed.data.bargainingUnitId !== undefined)
        data.bargainingUnitId = parsed.data.bargainingUnitId;
      if (parsed.data.employerContactId !== undefined)
        data.employerContactId = parsed.data.employerContactId;

      await storage.grievances.update(req.params.id, data);
      const fresh = await storage.grievances.getWithDetails(req.params.id);
      res.json(fresh);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Grievance ID already in use" });
      }
      console.error("Failed to update grievance:", error);
      res.status(500).json({ message: "Failed to update grievance" });
    }
  });

  app.delete("/api/grievances/:id", ...gate, async (req, res) => {
    try {
      const existing = await storage.grievances.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const deleted = await storage.grievances.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete grievance:", error);
      res.status(500).json({ message: "Failed to delete grievance" });
    }
  });

  // ----- Deadline threshold config -----
  // The variable itself is edited through the admin variables UI.
  // Deadline thresholds are read via GET /api/variables/by-name/
  // grievance.deadline_thresholds (staff + grievance component in the
  // variable read-access registry); the client validates and defaults.

  // ----- Timeline steps (read-only) -----
  // Computed rows from grievance_steps_denorm — written ONLY by the
  // grievance_timeline denorm plugin (recomputes on status-history saves and
  // timeline-template changes). There are deliberately NO mutation routes.

  app.get("/api/grievances/:id/timeline-steps", ...gate, async (req, res) => {
    try {
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const steps = await storage.grievanceStepsDenorm.listForGrievance(req.params.id);
      res.json(steps);
    } catch (error) {
      console.error("Failed to fetch grievance timeline steps:", error);
      res.status(500).json({ message: "Failed to fetch timeline steps" });
    }
  });

  // ----- Status history -----
  // The grievance's current status is derived from these entries (latest date
  // wins); mutations recompute `is_current` transactionally in storage.

  app.get("/api/grievances/:id/status-history", ...gate, async (req, res) => {
    try {
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const entries = await storage.grievanceStatusHistory.list(req.params.id);
      res.json(entries);
    } catch (error) {
      console.error("Failed to fetch grievance status history:", error);
      res.status(500).json({ message: "Failed to fetch status history" });
    }
  });

  app.post("/api/grievances/:id/status-history", ...gate, async (req, res) => {
    try {
      const parsed = addStatusHistorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      // When no date is supplied (the edit page's "set status now" card), the
      // server stamps the time — this avoids a client clock ahead of the DB
      // tripping the not-in-the-future CHECK constraint.
      const date = parsed.data.date ?? new Date();
      if (date.getTime() > Date.now()) {
        return res.status(400).json({ message: "The date cannot be in the future" });
      }
      const created = await storage.grievanceStatusHistory.create(req.params.id, {
        statusId: parsed.data.statusId,
        date,
      });
      res.status(201).json(created);
    } catch (error: any) {
      if (error?.code === "23503") {
        return res.status(400).json({ message: "Unknown status" });
      }
      if (
        error?.code === "23505" &&
        error?.constraint === "grievance_status_history_grievance_date_unique"
      ) {
        return res.status(409).json({ message: "An entry with that date already exists for this grievance" });
      }
      if (error?.code === "23505") {
        return res.status(409).json({ message: "The status history changed concurrently. Please try again." });
      }
      if (error?.code === "23514") {
        return res.status(400).json({ message: "The date cannot be in the future" });
      }
      console.error("Failed to add grievance status history entry:", error);
      res.status(500).json({ message: "Failed to add status history entry" });
    }
  });

  app.patch("/api/grievances/:id/status-history/:entryId", ...gate, async (req, res) => {
    try {
      const parsed = updateStatusHistorySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      if (parsed.data.date !== undefined && parsed.data.date.getTime() > Date.now()) {
        return res.status(400).json({ message: "The date cannot be in the future" });
      }
      const updated = await storage.grievanceStatusHistory.update(
        req.params.id,
        req.params.entryId,
        parsed.data,
      );
      if (!updated) {
        return res.status(404).json({ message: "Status history entry not found" });
      }
      res.json(updated);
    } catch (error: any) {
      if (error?.code === "23503") {
        return res.status(400).json({ message: "Unknown status" });
      }
      if (
        error?.code === "23505" &&
        error?.constraint === "grievance_status_history_grievance_date_unique"
      ) {
        return res.status(409).json({ message: "An entry with that date already exists for this grievance" });
      }
      if (error?.code === "23505") {
        return res.status(409).json({ message: "The status history changed concurrently. Please try again." });
      }
      if (error?.code === "23514") {
        return res.status(400).json({ message: "The date cannot be in the future" });
      }
      console.error("Failed to update grievance status history entry:", error);
      res.status(500).json({ message: "Failed to update status history entry" });
    }
  });

  app.put(
    "/api/grievances/:id/status-history/:entryId/timeline-adjustment",
    ...gate,
    async (req, res) => {
      try {
        const parsed = setTimelineAdjustmentSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }
        const updated = await storage.grievanceStatusHistory.setTimelineAdjustment(
          req.params.id,
          req.params.entryId,
          parsed.data.adjustment,
        );
        if (!updated) {
          return res.status(404).json({ message: "Status history entry not found" });
        }
        res.json(updated);
      } catch (error) {
        console.error("Failed to set grievance timeline adjustment:", error);
        res.status(500).json({ message: "Failed to set timeline adjustment" });
      }
    },
  );

  app.delete("/api/grievances/:id/status-history/:entryId", ...gate, async (req, res) => {
    try {
      const deleted = await storage.grievanceStatusHistory.delete(
        req.params.id,
        req.params.entryId,
      );
      if (!deleted) {
        return res.status(404).json({ message: "Status history entry not found" });
      }
      res.status(204).end();
    } catch (error) {
      console.error("Failed to delete grievance status history entry:", error);
      res.status(500).json({ message: "Failed to delete status history entry" });
    }
  });

  app.post("/api/grievances/:id/workers", ...gate, async (req, res) => {
    try {
      const parsed = linkWorkerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      // Cardinality enforcement (class rejection, individual single-worker
      // limit, and implicit-lead assignment) happens atomically inside the
      // storage method under a grievance row lock, so concurrent adds cannot
      // exceed the individual limit.
      const result = await storage.grievances.addWorkerForGrievance(
        req.params.id,
        parsed.data.workerId,
      );
      if ("error" in result) {
        if (result.error === "not-found") {
          return res.status(404).json({ message: "Grievance not found" });
        }
        if (result.error === "class") {
          return res.status(400).json({ message: "Class grievances cannot have workers." });
        }
        return res
          .status(400)
          .json({ message: "An individual grievance can have only one worker." });
      }
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.status(201).json(workers);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Worker is already linked to this grievance" });
      }
      console.error("Failed to link worker to grievance:", error);
      res.status(500).json({ message: "Failed to link worker" });
    }
  });

  app.patch("/api/grievances/:id/workers/:workerId", ...gate, async (req, res) => {
    try {
      const parsed = editWorkerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }

      if (parsed.data.primary === true) {
        if (grievance.cardinality === "class") {
          return res.status(400).json({ message: "Class grievances cannot have workers." });
        }
        if (grievance.cardinality === "multiple") {
          return res
            .status(400)
            .json({ message: "A multiple grievance cannot have a lead worker." });
        }
      }

      // An individual grievance's only worker is always its lead; it cannot be
      // demoted to a non-lead state.
      if (parsed.data.primary === false && grievance.cardinality === "individual") {
        return res
          .status(400)
          .json({ message: "The worker on an individual grievance is always the lead." });
      }

      const updated = await storage.grievances.updateWorker(
        req.params.id,
        req.params.workerId,
        { primary: parsed.data.primary },
      );
      if (!updated) {
        return res.status(404).json({ message: "Worker link not found" });
      }
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.json(workers);
    } catch (error) {
      console.error("Failed to update grievance worker:", error);
      res.status(500).json({ message: "Failed to update worker" });
    }
  });

  app.delete("/api/grievances/:id/workers/:workerId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeWorker(req.params.id, req.params.workerId);
      if (!removed) {
        return res.status(404).json({ message: "Worker link not found" });
      }
      const workers = await storage.grievances.listWorkers(req.params.id);
      res.json(workers);
    } catch (error) {
      console.error("Failed to unlink worker from grievance:", error);
      res.status(500).json({ message: "Failed to unlink worker" });
    }
  });

  app.post("/api/grievances/:id/employers", ...gate, async (req, res) => {
    try {
      const parsed = linkEmployerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      await storage.grievances.addEmployer(req.params.id, parsed.data.employerId);
      const employers = await storage.grievances.listEmployers(req.params.id);
      res.status(201).json(employers);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(409).json({ message: "Employer is already linked to this grievance" });
      }
      console.error("Failed to link employer to grievance:", error);
      res.status(500).json({ message: "Failed to link employer" });
    }
  });

  app.delete("/api/grievances/:id/employers/:employerId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeEmployer(req.params.id, req.params.employerId);
      if (!removed) {
        return res.status(404).json({ message: "Employer link not found" });
      }
      const employers = await storage.grievances.listEmployers(req.params.id);
      res.json(employers);
    } catch (error) {
      console.error("Failed to unlink employer from grievance:", error);
      res.status(500).json({ message: "Failed to unlink employer" });
    }
  });

  // ---- Users ---------------------------------------------------------------

  app.post("/api/grievances/:id/users", ...gate, async (req, res) => {
    try {
      const parsed = addUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      if (!(await storage.grievances.userExists(parsed.data.userId))) {
        return res.status(400).json({ message: "User not found" });
      }
      if (!(await storage.grievances.roleOptionExists(parsed.data.roleId))) {
        return res.status(400).json({ message: "Role not found" });
      }
      const permittedRoleIds =
        await storage.grievances.rolePermittedSystemRoleIds(parsed.data.roleId);
      if (
        permittedRoleIds.length > 0 &&
        !(await storage.users.userHasAnyRole(parsed.data.userId, permittedRoleIds))
      ) {
        return res.status(400).json({
          message:
            "This user does not hold a system role permitted for the selected grievance role",
        });
      }
      await storage.grievances.addUser(req.params.id, {
        userId: parsed.data.userId,
        roleId: parsed.data.roleId,
        data: parsed.data.data,
      });
      const usersList = await storage.grievances.listUsers(req.params.id);
      res.status(201).json(usersList);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res
          .status(409)
          .json({ message: "This user already holds that role on this grievance" });
      }
      if (error?.code === "23503") {
        return res
          .status(409)
          .json({ message: "The selected user or role no longer exists" });
      }
      console.error("Failed to assign user to grievance:", error);
      res.status(500).json({ message: "Failed to assign user" });
    }
  });

  app.patch("/api/grievances/:id/users/:rowId", ...gate, async (req, res) => {
    try {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      if (parsed.data.roleId !== undefined) {
        if (!(await storage.grievances.roleOptionExists(parsed.data.roleId))) {
          return res.status(400).json({ message: "Role not found" });
        }
        const permittedRoleIds =
          await storage.grievances.rolePermittedSystemRoleIds(parsed.data.roleId);
        if (permittedRoleIds.length > 0) {
          const assignment = await storage.grievances.getUserAssignment(
            req.params.id,
            req.params.rowId,
          );
          if (!assignment) {
            return res.status(404).json({ message: "User assignment not found" });
          }
          if (!(await storage.users.userHasAnyRole(assignment.userId, permittedRoleIds))) {
            return res.status(400).json({
              message:
                "This user does not hold a system role permitted for the selected grievance role",
            });
          }
        }
      }
      const updated = await storage.grievances.updateUser(req.params.id, req.params.rowId, {
        roleId: parsed.data.roleId,
        data: parsed.data.data,
      });
      if (!updated) {
        return res.status(404).json({ message: "User assignment not found" });
      }
      const usersList = await storage.grievances.listUsers(req.params.id);
      res.json(usersList);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res
          .status(409)
          .json({ message: "This user already holds that role on this grievance" });
      }
      if (error?.code === "23503") {
        return res
          .status(409)
          .json({ message: "The selected role no longer exists" });
      }
      console.error("Failed to update grievance user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/grievances/:id/users/:rowId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeUser(req.params.id, req.params.rowId);
      if (!removed) {
        return res.status(404).json({ message: "User assignment not found" });
      }
      const usersList = await storage.grievances.listUsers(req.params.id);
      res.json(usersList);
    } catch (error) {
      console.error("Failed to remove user from grievance:", error);
      res.status(500).json({ message: "Failed to remove user" });
    }
  });

  // ---- Complaints ----------------------------------------------------------

  app.post("/api/grievances/:id/complaints", ...gate, async (req, res) => {
    try {
      const parsed = addLineSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      if (parsed.data.optionId) {
        const exists = await storage.grievances.complaintOptionExists(parsed.data.optionId);
        if (!exists) {
          return res.status(400).json({ message: "Selected complaint option does not exist" });
        }
      }
      await storage.grievances.addComplaint(req.params.id, {
        complaintId: parsed.data.optionId ?? null,
        description: parsed.data.description,
      });
      const complaints = await storage.grievances.listComplaints(req.params.id);
      res.status(201).json(complaints);
    } catch (error) {
      console.error("Failed to add complaint to grievance:", error);
      res.status(500).json({ message: "Failed to add complaint" });
    }
  });

  app.patch("/api/grievances/:id/complaints/:rowId", ...gate, async (req, res) => {
    try {
      const parsed = updateLineSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      if (parsed.data.optionId) {
        const exists = await storage.grievances.complaintOptionExists(parsed.data.optionId);
        if (!exists) {
          return res.status(400).json({ message: "Selected complaint option does not exist" });
        }
      }
      const updated = await storage.grievances.updateComplaint(req.params.id, req.params.rowId, {
        complaintId: parsed.data.optionId,
        description: parsed.data.description,
        sequence: parsed.data.sequence,
      });
      if (!updated) {
        return res.status(404).json({ message: "Complaint not found" });
      }
      const complaints = await storage.grievances.listComplaints(req.params.id);
      res.json(complaints);
    } catch (error) {
      console.error("Failed to update grievance complaint:", error);
      res.status(500).json({ message: "Failed to update complaint" });
    }
  });

  app.delete("/api/grievances/:id/complaints/:rowId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeComplaint(req.params.id, req.params.rowId);
      if (!removed) {
        return res.status(404).json({ message: "Complaint not found" });
      }
      const complaints = await storage.grievances.listComplaints(req.params.id);
      res.json(complaints);
    } catch (error) {
      console.error("Failed to remove grievance complaint:", error);
      res.status(500).json({ message: "Failed to remove complaint" });
    }
  });

  // ---- Remedies ------------------------------------------------------------

  app.post("/api/grievances/:id/remedies", ...gate, async (req, res) => {
    try {
      const parsed = addLineSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      if (parsed.data.optionId) {
        const exists = await storage.grievances.remedyOptionExists(parsed.data.optionId);
        if (!exists) {
          return res.status(400).json({ message: "Selected remedy option does not exist" });
        }
      }
      await storage.grievances.addRemedy(req.params.id, {
        remedyId: parsed.data.optionId ?? null,
        description: parsed.data.description,
      });
      const remedies = await storage.grievances.listRemedies(req.params.id);
      res.status(201).json(remedies);
    } catch (error) {
      console.error("Failed to add remedy to grievance:", error);
      res.status(500).json({ message: "Failed to add remedy" });
    }
  });

  app.patch("/api/grievances/:id/remedies/:rowId", ...gate, async (req, res) => {
    try {
      const parsed = updateLineSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      if (parsed.data.optionId) {
        const exists = await storage.grievances.remedyOptionExists(parsed.data.optionId);
        if (!exists) {
          return res.status(400).json({ message: "Selected remedy option does not exist" });
        }
      }
      const updated = await storage.grievances.updateRemedy(req.params.id, req.params.rowId, {
        remedyId: parsed.data.optionId,
        description: parsed.data.description,
        sequence: parsed.data.sequence,
      });
      if (!updated) {
        return res.status(404).json({ message: "Remedy not found" });
      }
      const remedies = await storage.grievances.listRemedies(req.params.id);
      res.json(remedies);
    } catch (error) {
      console.error("Failed to update grievance remedy:", error);
      res.status(500).json({ message: "Failed to update remedy" });
    }
  });

  app.delete("/api/grievances/:id/remedies/:rowId", ...gate, async (req, res) => {
    try {
      const removed = await storage.grievances.removeRemedy(req.params.id, req.params.rowId);
      if (!removed) {
        return res.status(404).json({ message: "Remedy not found" });
      }
      const remedies = await storage.grievances.listRemedies(req.params.id);
      res.json(remedies);
    } catch (error) {
      console.error("Failed to remove grievance remedy:", error);
      res.status(500).json({ message: "Failed to remove remedy" });
    }
  });

  // ---- Settlements ---------------------------------------------------------
  // Gated by the `grievance.settlement` component (which itself requires the
  // `grievance` component to be enabled).

  const settlementGate = [
    requireAuth,
    requireComponent("grievance.settlement"),
    requireAccess("staff"),
  ] as const;

  app.get("/api/grievances/:id/settlements", ...settlementGate, async (req, res) => {
    try {
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const settlements = await storage.grievanceSettlements.list(req.params.id);
      res.json(settlements);
    } catch (error) {
      console.error("Failed to fetch grievance settlements:", error);
      res.status(500).json({ message: "Failed to fetch settlements" });
    }
  });

  app.post("/api/grievances/:id/settlements", ...settlementGate, async (req, res) => {
    try {
      const parsed = addSettlementSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      await storage.grievanceSettlements.create(req.params.id, {
        description: parsed.data.description ?? null,
        amount: parsed.data.amount ?? null,
        typeIds: parsed.data.typeIds ?? null,
      });
      const settlements = await storage.grievanceSettlements.list(req.params.id);
      res.status(201).json(settlements);
    } catch (error) {
      console.error("Failed to add settlement to grievance:", error);
      res.status(500).json({ message: "Failed to add settlement" });
    }
  });

  app.patch("/api/grievances/:id/settlements/:settlementId", ...settlementGate, async (req, res) => {
    try {
      const parsed = updateSettlementSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const existing = await storage.grievanceSettlements.get(
        req.params.id,
        req.params.settlementId,
      );
      if (!existing) {
        return res.status(404).json({ message: "Settlement not found" });
      }
      await storage.grievanceSettlements.update(
        req.params.id,
        req.params.settlementId,
        {
          description: parsed.data.description,
          amount: parsed.data.amount,
          typeIds: parsed.data.typeIds,
        },
      );
      const settlements = await storage.grievanceSettlements.list(req.params.id);
      res.json(settlements);
    } catch (error) {
      console.error("Failed to update grievance settlement:", error);
      res.status(500).json({ message: "Failed to update settlement" });
    }
  });

  app.delete("/api/grievances/:id/settlements/:settlementId", ...settlementGate, async (req, res) => {
    try {
      const existing = await storage.grievanceSettlements.get(
        req.params.id,
        req.params.settlementId,
      );
      if (!existing) {
        return res.status(404).json({ message: "Settlement not found" });
      }
      await storage.grievanceSettlements.delete(
        req.params.id,
        req.params.settlementId,
      );
      const settlements = await storage.grievanceSettlements.list(req.params.id);
      res.json(settlements);
    } catch (error) {
      console.error("Failed to remove grievance settlement:", error);
      res.status(500).json({ message: "Failed to remove settlement" });
    }
  });

  // ---- Contract link -------------------------------------------------------
  // Gated by the `grievance.contract` component (which itself requires the
  // `grievance` and `contract` components to be enabled).

  const contractGate = [
    requireAuth,
    requireComponent("grievance.contract"),
    requireAccess("staff"),
  ] as const;

  // The linked contract (or null) plus the ordered linked sections.
  app.get("/api/grievances/:id/contract", ...contractGate, async (req, res) => {
    try {
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const [contract, sections] = await Promise.all([
        storage.grievanceContracts.getLink(req.params.id),
        storage.grievanceContracts.getSections(req.params.id),
      ]);
      res.json({ contract: contract ?? null, sections });
    } catch (error) {
      console.error("Failed to fetch grievance contract:", error);
      res.status(500).json({ message: "Failed to fetch contract" });
    }
  });

  // The linked contract's full article/section outline for the section picker.
  app.get(
    "/api/grievances/:id/contract/catalog",
    ...contractGate,
    async (req, res) => {
      try {
        const grievance = await storage.grievances.get(req.params.id);
        if (!grievance) {
          return res.status(404).json({ message: "Grievance not found" });
        }
        const catalog = await storage.grievanceContracts.getCatalog(req.params.id);
        if (catalog === undefined) {
          return res
            .status(404)
            .json({ message: "No contract is linked to this grievance" });
        }
        res.json({ articles: catalog });
      } catch (error) {
        console.error("Failed to fetch grievance contract catalog:", error);
        res.status(500).json({ message: "Failed to fetch contract catalog" });
      }
    },
  );

  // Set (or change) the linked contract. Changing it is blocked while sections
  // are still linked — the storage layer enforces this hard block.
  app.put("/api/grievances/:id/contract", ...contractGate, async (req, res) => {
    try {
      const parsed = setContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid request body", errors: parsed.error.flatten() });
      }
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const result = await storage.grievanceContracts.setContract(
        req.params.id,
        parsed.data.contractId,
      );
      if ("error" in result) {
        if (result.error === "contract-not-found") {
          return res.status(400).json({ message: "Selected contract does not exist" });
        }
        return res.status(409).json({
          message: "Remove the linked sections before changing the contract",
        });
      }
      const [contract, sections] = await Promise.all([
        storage.grievanceContracts.getLink(req.params.id),
        storage.grievanceContracts.getSections(req.params.id),
      ]);
      res.json({ contract: contract ?? null, sections });
    } catch (error) {
      console.error("Failed to set grievance contract:", error);
      res.status(500).json({ message: "Failed to set contract" });
    }
  });

  // Clear the linked contract. Blocked while sections are still linked.
  app.delete("/api/grievances/:id/contract", ...contractGate, async (req, res) => {
    try {
      const grievance = await storage.grievances.get(req.params.id);
      if (!grievance) {
        return res.status(404).json({ message: "Grievance not found" });
      }
      const result = await storage.grievanceContracts.clearContract(req.params.id);
      if ("error" in result) {
        return res.status(409).json({
          message: "Remove the linked sections before clearing the contract",
        });
      }
      res.json({ contract: null, sections: [] });
    } catch (error) {
      console.error("Failed to clear grievance contract:", error);
      res.status(500).json({ message: "Failed to clear contract" });
    }
  });

  // Link one or more of the contract's sections to the grievance.
  app.post(
    "/api/grievances/:id/contract/sections",
    ...contractGate,
    async (req, res) => {
      try {
        const parsed = addSectionsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }
        const grievance = await storage.grievances.get(req.params.id);
        if (!grievance) {
          return res.status(404).json({ message: "Grievance not found" });
        }
        const result = await storage.grievanceContracts.addSections(
          req.params.id,
          parsed.data.sectionIds,
        );
        if ("error" in result) {
          if (result.error === "no-contract") {
            return res
              .status(400)
              .json({ message: "Link a contract before adding sections" });
          }
          return res.status(400).json({
            message: "One or more sections do not belong to the linked contract",
          });
        }
        res.status(201).json(result.sections);
      } catch (error) {
        console.error("Failed to link contract sections to grievance:", error);
        res.status(500).json({ message: "Failed to link sections" });
      }
    },
  );

  // Unlink a section from the grievance.
  app.delete(
    "/api/grievances/:id/contract/sections/:linkId",
    ...contractGate,
    async (req, res) => {
      try {
        const removed = await storage.grievanceContracts.removeSection(
          req.params.id,
          req.params.linkId,
        );
        if (!removed) {
          return res.status(404).json({ message: "Section link not found" });
        }
        const sections = await storage.grievanceContracts.getSections(req.params.id);
        res.json(sections);
      } catch (error) {
        console.error("Failed to unlink contract section from grievance:", error);
        res.status(500).json({ message: "Failed to unlink section" });
      }
    },
  );

  // Reorder a linked section up or down.
  app.patch(
    "/api/grievances/:id/contract/sections/:linkId/move",
    ...contractGate,
    async (req, res) => {
      try {
        const parsed = moveSectionSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ message: "Invalid request body", errors: parsed.error.flatten() });
        }
        const sections = await storage.grievanceContracts.moveSection(
          req.params.id,
          req.params.linkId,
          parsed.data.direction,
        );
        res.json(sections);
      } catch (error) {
        console.error("Failed to reorder grievance contract section:", error);
        res.status(500).json({ message: "Failed to reorder section" });
      }
    },
  );
}
