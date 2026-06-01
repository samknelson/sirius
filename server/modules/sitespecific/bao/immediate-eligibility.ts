import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoEmployerImmediateEligibilityRequestSchema,
  updateBaoEmployerImmediateEligibilityRequestSchema,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "BAO Immediate Eligibility table does not exist. Please enable the BAO component first.";

export function registerBaoImmediateEligibilityRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  const eligibilityStorage = storage.baoImmediateEligibility;
  const componentMiddleware = requireComponent("sitespecific.bao");
  const requireStaff = requirePermission("staff");

  app.get(
    "/api/sitespecific/bao/immediate-eligibility/employer/:employerId",
    requireAuth,
    requireStaff,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await eligibilityStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const record = await eligibilityStorage.getByEmployerId(req.params.employerId);
        res.json(record || null);
      } catch (error) {
        console.error("Failed to fetch BAO immediate eligibility by employer:", error);
        res.status(500).json({ message: "Failed to fetch immediate eligibility" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/immediate-eligibility",
    requireAuth,
    requireStaff,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await eligibilityStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const { data: _ignoredData, ...parsed } = createBaoEmployerImmediateEligibilityRequestSchema.parse(req.body);
        const record = await eligibilityStorage.create(parsed);
        res.status(201).json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res
            .status(409)
            .json({ message: "Immediate eligibility already exists for this employer" });
        }
        console.error("Failed to create BAO immediate eligibility:", error);
        res.status(500).json({ message: "Failed to create immediate eligibility" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/immediate-eligibility/:id",
    requireAuth,
    requireStaff,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await eligibilityStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const { data: _ignoredData, ...parsed } = updateBaoEmployerImmediateEligibilityRequestSchema.parse(req.body);
        const record = await eligibilityStorage.update(req.params.id, parsed);
        if (!record) {
          return res.status(404).json({ message: "Immediate eligibility not found" });
        }
        res.json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        console.error("Failed to update BAO immediate eligibility:", error);
        res.status(500).json({ message: "Failed to update immediate eligibility" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/immediate-eligibility/:id",
    requireAuth,
    requireStaff,
    componentMiddleware,
    async (req, res) => {
      try {
        if (!(await eligibilityStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const deleted = await eligibilityStorage.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Immediate eligibility not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete BAO immediate eligibility:", error);
        res.status(500).json({ message: "Failed to delete immediate eligibility" });
      }
    },
  );
}
