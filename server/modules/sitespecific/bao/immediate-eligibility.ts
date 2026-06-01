import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoEmployerImmediateEligibilityRequestSchema,
  updateBaoEmployerImmediateEligibilityRequestSchema,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "BAO Immediate Eligibility table does not exist. Please enable the BAO component first.";

export function registerBaoImmediateEligibilityRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const eligibilityStorage = storage.baoImmediateEligibility;
  const componentMiddleware = requireComponent("sitespecific.bao");

  // Resolve the employer that owns a given immediate-eligibility record so that
  // PATCH/DELETE can be authorized against that specific employer.
  const employerIdForRecord = async (req: Request): Promise<string | undefined> => {
    try {
      const record = await eligibilityStorage.get(req.params.id);
      return record?.employerId;
    } catch {
      return undefined;
    }
  };

  app.get(
    "/api/sitespecific/bao/immediate-eligibility/employer/:employerId",
    requireAuth,
    componentMiddleware,
    requireAccess("employer.view", (req) => req.params.employerId),
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
    componentMiddleware,
    requireAccess("employer.manage", (req) => req.body?.employerId),
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
    componentMiddleware,
    requireAccess("employer.manage", employerIdForRecord),
    async (req, res) => {
      try {
        if (!(await eligibilityStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        // Scope is date-window updates only. Strip `data` (out of scope) and
        // `employerId` (immutable here) so a caller authorized for this record's
        // current owner cannot re-point it at a different employer.
        const {
          data: _ignoredData,
          employerId: _ignoredEmployerId,
          ...parsed
        } = updateBaoEmployerImmediateEligibilityRequestSchema.parse(req.body);
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
    componentMiddleware,
    requireAccess("employer.manage", employerIdForRecord),
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
