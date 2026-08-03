import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Uploads selectable as a payment's "Upload source" allocation method:
 * completed BAO Monthly Hours uploads with stored withholding allocations for
 * the employer behind the given (employer) EA, whose worker EAs all sit on
 * the same ledger account, and which are not consumed by another payment.
 * Pass `paymentId` to include the uploads that payment already holds (edit).
 */
export function registerBaoWithholdingUploadsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/withholding-uploads",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const eaId = req.query.eaId as string | undefined;
        if (!eaId) {
          return res.status(400).json({ message: "eaId query parameter is required" });
        }
        const paymentId = (req.query.paymentId as string | undefined) || undefined;

        const ea = await storage.ledger.ea.get(eaId);
        if (!ea) {
          return res.status(404).json({ message: "EA entry not found" });
        }
        if (ea.entityType !== "employer") {
          // Upload sources only apply to employer EAs — an empty list keeps
          // the payment form's picker hidden without a special error path.
          return res.json([]);
        }
        if (!(await storage.baoWithholdingAllocations.tableExists())) {
          return res.json([]);
        }

        const uploads = await storage.baoWithholdingAllocations.listEligibleUploads({
          employerId: ea.entityId,
          accountId: ea.accountId,
          includePaymentId: paymentId,
        });
        res.json(uploads);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch withholding uploads" });
      }
    },
  );
}
