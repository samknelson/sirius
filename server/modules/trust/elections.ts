import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { WorkerTrustElectionValidationError } from "../../storage/trust/elections";
import { ENROLLMENT_TYPES, type EnrollmentType } from "@shared/schema";
import { guardNoActiveCobraCase } from "../../plugins/wizards/enrollment/foundation";

type RequireAccess = (
  policy: string,
  getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined,
) => (req: Request, res: Response, next: NextFunction) => void;
type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

function handleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid data", details: error.errors });
  }
  if (error instanceof WorkerTrustElectionValidationError) {
    return res.status(400).json({ error: error.message, field: error.field });
  }
  console.error(fallback, error);
  if (error instanceof Error) {
    return res.status(500).json({ error: fallback, details: error.message });
  }
  return res.status(500).json({ error: fallback });
}

/**
 * Enforce the per-benefit-type "Only one of this type" rule for manually
 * created/edited elections, mirroring the enrollment wizards' submit check.
 * A type without the flag allows multiple benefits as before. The Life Event
 * wizard's carry-forward calls storage directly and is intentionally NOT
 * gated here, so elections that predate a newly-set rule still carry forward.
 */
async function assertSingleSelectBenefitTypes(
  benefitIds: unknown,
): Promise<void> {
  if (!Array.isArray(benefitIds) || benefitIds.length < 2) return;
  const allBenefits = await storage.trustBenefits.getAllTrustBenefits();
  const byId = new Map(allBenefits.map((b: any) => [b.id, b]));
  const countByType = new Map<string, { name: string; count: number }>();
  for (const id of benefitIds) {
    const benefit = byId.get(id as string);
    if (!benefit?.benefitTypeOnlyOne || !benefit.benefitType) continue;
    const entry = countByType.get(benefit.benefitType) ?? {
      name: benefit.benefitTypeName ?? "this type",
      count: 0,
    };
    entry.count += 1;
    countByType.set(benefit.benefitType, entry);
  }
  for (const { name, count } of countByType.values()) {
    if (count > 1) {
      throw new WorkerTrustElectionValidationError(
        "benefitIds",
        `Only one ${name} benefit can be selected. Please choose a single ${name} benefit.`,
      );
    }
  }
}

export function registerWorkerTrustElectionsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  const electionsComponent = requireComponent("trust.elections");

  // List elections for a worker (staff-only)
  app.get(
    "/api/workers/:id/trust-elections",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
        const policyId = (req.query.policyId as string | undefined) || undefined;
        const sortRaw = (req.query.sort as string | undefined) || 'startDesc';
        const sort = sortRaw === 'startAsc' ? 'startAsc' : 'startDesc';
        const rows = await storage.workerTrustElections.searchViews({
          workerId: req.params.id,
          activeOnly,
          policyId,
          sort,
        });
        res.json(rows);
      } catch (error) {
        handleError(res, error, "Failed to fetch trust elections");
      }
    },
  );

  // Get current (active) election for a worker — visible to anyone with worker.view
  app.get(
    "/api/workers/:id/trust-elections/current",
    requireAuth,
    electionsComponent,
    requireAccess('worker.view', (req) => req.params.id),
    async (req: Request, res: Response) => {
      try {
        const row = await storage.workerTrustElections.getActiveViewByWorker(req.params.id);
        res.json(row ?? null);
      } catch (error) {
        handleError(res, error, "Failed to fetch current trust election");
      }
    },
  );

  // First-time enrollment eligibility for a worker (staff-only).
  // First-time enrollment is only offered when the worker has NO active
  // election covering a Medical or Dental benefit. Baseline AD&D/Life-only
  // workers still qualify. The wizard's create hook enforces the same gate
  // server-side; this endpoint drives the launch button's enabled state.
  app.get(
    "/api/workers/:id/trust-elections/first-time-eligibility",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const cobraBlock = await guardNoActiveCobraCase(
          storage,
          req.params.id,
        );
        if (cobraBlock) {
          res.json({ eligible: false, reason: cobraBlock });
          return;
        }
        const hasMedicalOrDental =
          await storage.workerTrustElections.hasActiveMedicalOrDentalElection(
            req.params.id,
          );
        res.json({
          eligible: !hasMedicalOrDental,
          reason: hasMedicalOrDental
            ? "This worker already has an active medical or dental election, so first-time enrollment is not available."
            : undefined,
        });
      } catch (error) {
        handleError(res, error, "Failed to check first-time enrollment eligibility");
      }
    },
  );

  // Life-event eligibility for a worker (staff-only). A life event change is
  // only offered when the worker HAS an active election (the inverse of
  // first-time enrollment). The wizard's create hook enforces the same gate
  // server-side; this endpoint drives the launch button's enabled state.
  app.get(
    "/api/workers/:id/trust-elections/life-event-eligibility",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const active = await storage.workerTrustElections.getActiveByWorker(
          req.params.id,
        );
        res.json({
          eligible: !!active,
          reason: active
            ? undefined
            : "This worker has no active election, so a life event change is not available.",
        });
      } catch (error) {
        handleError(res, error, "Failed to check life event eligibility");
      }
    },
  );

  // Staff enrollment review queue: elections across all workers, optionally
  // filtered to one enrollment type (first_time / life_event / open_enrollment).
  // Registered BEFORE "/api/trust-elections/:id" so the literal path is not
  // captured as an :id param.
  app.get(
    "/api/trust-elections",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const enrollmentTypeRaw = (req.query.enrollmentType as string | undefined) || undefined;
        const enrollmentType = ENROLLMENT_TYPES.includes(enrollmentTypeRaw as EnrollmentType)
          ? (enrollmentTypeRaw as EnrollmentType)
          : undefined;
        const activeOnly = req.query.activeOnly === 'true' || req.query.activeOnly === '1';
        const sortRaw = (req.query.sort as string | undefined) || 'startDesc';
        const sort = sortRaw === 'startAsc' ? 'startAsc' : 'startDesc';
        const rows = await storage.workerTrustElections.searchViews({
          enrollmentType,
          activeOnly,
          sort,
        });
        res.json(rows);
      } catch (error) {
        handleError(res, error, "Failed to fetch enrollment queue");
      }
    },
  );

  // Get one election (staff-only)
  app.get(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const row = await storage.workerTrustElections.getViewById(req.params.id);
        if (!row) return res.status(404).json({ error: "Trust election not found" });
        res.json(row);
      } catch (error) {
        handleError(res, error, "Failed to fetch trust election");
      }
    },
  );

  // Create
  app.post(
    "/api/workers/:id/trust-elections",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        await assertSingleSelectBenefitTypes(req.body?.benefitIds);
        const created = await storage.workerTrustElections.create(req.params.id, req.body);
        res.status(201).json(created);
      } catch (error) {
        handleError(res, error, "Failed to create trust election");
      }
    },
  );

  // Update (workerId immutable)
  app.patch(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        // Only validate when the request actually changes the benefit set.
        if (req.body?.benefitIds !== undefined) {
          await assertSingleSelectBenefitTypes(req.body.benefitIds);
        }
        const updated = await storage.workerTrustElections.update(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: "Trust election not found" });
        res.json(updated);
      } catch (error) {
        handleError(res, error, "Failed to update trust election");
      }
    },
  );

  // Delete
  app.delete(
    "/api/trust-elections/:id",
    requireAuth,
    electionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const deleted = await storage.workerTrustElections.delete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Trust election not found" });
        res.status(204).send();
      } catch (error) {
        handleError(res, error, "Failed to delete trust election");
      }
    },
  );
}
