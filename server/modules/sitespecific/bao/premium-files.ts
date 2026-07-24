import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { NO_UNPAID_PREMIUMS } from "../../../storage/sitespecific/bao/premium-files";
import { generateBaoPremiumFileRequestSchema } from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "Premium files table does not exist. Please enable the BAO component first.";

function csvEscape(value: string | null | undefined): string {
  const s = value ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registerBaoPremiumFilesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const filesStorage = storage.baoPremiumFiles;
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/premium/files",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await filesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const providerId =
          typeof req.query.providerId === "string" && req.query.providerId
            ? req.query.providerId
            : undefined;
        const files = await filesStorage.list({ providerId });
        res.json(files);
      } catch (error) {
        console.error("Failed to list premium files:", error);
        res.status(500).json({ message: "Failed to list premium files" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/premium/files/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await filesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const file = await filesStorage.get(req.params.id);
        if (!file) {
          return res.status(404).json({ message: "Premium file not found" });
        }
        res.json(file);
      } catch (error) {
        console.error("Failed to get premium file:", error);
        res.status(500).json({ message: "Failed to get premium file" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/premium/files/:id/rows",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await filesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const file = await filesStorage.get(req.params.id);
        if (!file) {
          return res.status(404).json({ message: "Premium file not found" });
        }
        const rows = await filesStorage.getRows(req.params.id);
        res.json(rows);
      } catch (error) {
        console.error("Failed to get premium file rows:", error);
        res.status(500).json({ message: "Failed to get premium file rows" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/premium/files/:id/csv",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await filesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const file = await filesStorage.get(req.params.id);
        if (!file) {
          return res.status(404).json({ message: "Premium file not found" });
        }
        const rows = await filesStorage.getRows(req.params.id);
        const header = "Statement Month,Worker,Benefit,Amount";
        const lines = rows.map((r) =>
          [
            csvEscape(r.statementYmd?.slice(0, 7) ?? ""),
            csvEscape(r.workerName),
            csvEscape(r.benefitName),
            csvEscape(r.amount),
          ].join(","),
        );
        const csv = [header, ...lines].join("\n") + "\n";
        const stamp = (file.generatedAt instanceof Date
          ? file.generatedAt.toISOString()
          : String(file.generatedAt)
        ).slice(0, 10);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="premium-file-${stamp}-${file.id.slice(0, 8)}.csv"`,
        );
        res.send(csv);
      } catch (error) {
        console.error("Failed to export premium file CSV:", error);
        res.status(500).json({ message: "Failed to export premium file CSV" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/premium/files/generate",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await filesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const parsed = generateBaoPremiumFileRequestSchema.parse(req.body);
        let accountId = parsed.accountId;
        if (!accountId) {
          const provider = await storage.trustProviders.getTrustProvider(parsed.providerId);
          if (!provider) {
            return res.status(400).json({ message: "Trust provider not found" });
          }
          const linked = (provider.data as Record<string, unknown> | null)?.ledgerAccountId;
          if (typeof linked !== "string" || !linked) {
            return res.status(400).json({
              message:
                "This provider has no linked ledger account. Set one on the provider's Edit tab first.",
            });
          }
          accountId = linked;
        }
        const file = await filesStorage.generate(parsed.providerId, accountId);
        if (!file) {
          return res.status(400).json({
            message:
              "The provider has no ledger entity account for that account. Premium charges must exist before a file can be generated.",
          });
        }
        res.status(201).json(file);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.message === NO_UNPAID_PREMIUMS) {
          return res.status(409).json({
            message: "No unpaid premium months found — everything is already covered by a premium file.",
          });
        }
        console.error("Failed to generate premium file:", error);
        res.status(500).json({ message: "Failed to generate premium file" });
      }
    },
  );
}
