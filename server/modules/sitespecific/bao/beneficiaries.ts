import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { baoBeneficiaryListSchema } from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerBaoBeneficiariesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const beneficiariesStorage = storage.baoBeneficiaries;
  const componentMiddleware = requireComponent("sitespecific.bao");

  const workerIdParam = (req: Request): string | undefined => req.params.workerId;

  // GET — anyone who can view the worker can read the beneficiaries.
  app.get(
    "/api/sitespecific/bao/beneficiaries/worker/:workerId",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.view", workerIdParam),
    async (req, res) => {
      try {
        const beneficiaries = await beneficiariesStorage.get(req.params.workerId);
        res.json(beneficiaries);
      } catch (error: any) {
        if (error?.message === "WORKER_NOT_FOUND") {
          return res.status(404).json({ message: "Worker not found" });
        }
        console.error("Failed to fetch BAO beneficiaries:", error);
        res.status(500).json({ message: "Failed to fetch beneficiaries" });
      }
    },
  );

  // Replace-all write — only the worker themselves or staff (worker.mine).
  const replaceAll = async (req: Request, res: Response) => {
    try {
      const beneficiaries = baoBeneficiaryListSchema.parse(req.body);
      const saved = await beneficiariesStorage.set(req.params.workerId, beneficiaries);
      res.json(saved);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error?.message === "WORKER_NOT_FOUND") {
        return res.status(404).json({ message: "Worker not found" });
      }
      console.error("Failed to save BAO beneficiaries:", error);
      res.status(500).json({ message: "Failed to save beneficiaries" });
    }
  };

  app.put(
    "/api/sitespecific/bao/beneficiaries/worker/:workerId",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.mine", workerIdParam),
    replaceAll,
  );

  // POST alias for clients that prefer POST for the same replace-all operation.
  app.post(
    "/api/sitespecific/bao/beneficiaries/worker/:workerId",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.mine", workerIdParam),
    replaceAll,
  );
}
