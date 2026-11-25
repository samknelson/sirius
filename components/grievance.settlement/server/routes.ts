import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../../server/storage";
import { requireComponent } from "../../../server/modules/components";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

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

export function registerGrievanceSettlementRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
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
}
