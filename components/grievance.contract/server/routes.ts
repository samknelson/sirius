import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../../server/storage";
import { requireComponent } from "../../../server/modules/components";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PolicyMiddleware = (
  policy: any,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

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

export function registerGrievanceContractRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requireAccess: PolicyMiddleware,
) {
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
