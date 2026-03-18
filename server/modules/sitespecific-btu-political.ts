import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "./components";
import { storage } from "../storage";
import { lookupRepresentatives } from "../services/google-civics";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const lookupSchema = z.object({
  address: z.string().min(1, "Address is required"),
  workerId: z.string().min(1, "Worker ID is required"),
});

export function registerBtuPoliticalRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  const componentMiddleware = requireComponent("sitespecific.btu.political");

  app.get("/api/sitespecific/btu/political/officials", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const officials = await storage.btuPolitical.getOfficials();
      res.json(officials);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found. Please enable the BTU Political Profile component." });
      }
      console.error("Failed to fetch political officials:", error);
      res.status(500).json({ message: "Failed to fetch officials" });
    }
  });

  app.get("/api/sitespecific/btu/political/officials/:id", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const official = await storage.btuPolitical.getOfficial(req.params.id);
      if (!official) return res.status(404).json({ message: "Official not found" });
      res.json(official);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      console.error("Failed to fetch official:", error);
      res.status(500).json({ message: "Failed to fetch official" });
    }
  });

  app.get("/api/sitespecific/btu/political/officials/:id/workers", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const workers = await storage.btuPolitical.getWorkersByOfficialId(req.params.id);
      res.json(workers);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      console.error("Failed to fetch workers for official:", error);
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  app.get("/api/workers/:workerId/political/reps", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const reps = await storage.btuPolitical.getWorkerReps(req.params.workerId);
      res.json(reps);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      console.error("Failed to fetch worker reps:", error);
      res.status(500).json({ message: "Failed to fetch worker representatives" });
    }
  });

  app.post("/api/workers/:workerId/political/lookup", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const parsed = lookupSchema.safeParse({ ...req.body, workerId: req.params.workerId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { address, workerId } = parsed.data;

      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      const result = await lookupRepresentatives(address);

      const officialIds: string[] = [];
      for (const civicOfficial of result.officials) {
        const official = await storage.btuPolitical.upsertOfficial({
          name: civicOfficial.name,
          officeName: civicOfficial.officeName,
          level: civicOfficial.level,
          division: civicOfficial.division,
          party: civicOfficial.party,
          phones: civicOfficial.phones,
          emails: civicOfficial.emails,
          photoUrl: civicOfficial.photoUrl,
          urls: civicOfficial.urls,
          channels: civicOfficial.channels,
          ocdDivisionId: civicOfficial.ocdDivisionId,
        });
        officialIds.push(official.id);
      }

      await storage.btuPolitical.setWorkerReps(workerId, officialIds, result.normalizedAddress);

      const reps = await storage.btuPolitical.getWorkerReps(workerId);
      res.json({
        normalizedAddress: result.normalizedAddress,
        representatives: reps,
        count: reps.length,
      });
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      if (error.message?.includes("GOOGLE_CIVICS_API_KEY")) {
        return res.status(503).json({ message: "Google Civic Information API key is not configured." });
      }
      console.error("Failed to lookup representatives:", error);
      res.status(500).json({ message: "Failed to lookup representatives" });
    }
  });

  app.get("/api/sitespecific/btu/political/report", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const officials = await storage.btuPolitical.getOfficials();

      const report = await Promise.all(
        officials.map(async (official) => {
          const workers = await storage.btuPolitical.getWorkersByOfficialId(official.id);
          return {
            ...official,
            workerCount: workers.length,
          };
        })
      );

      res.json(report);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      console.error("Failed to generate political report:", error);
      res.status(500).json({ message: "Failed to generate report" });
    }
  });

  app.get("/api/sitespecific/btu/political/report/csv", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const { stringify } = await import("csv-stringify/sync");
      const officials = await storage.btuPolitical.getOfficials();

      const rows: any[] = [];
      for (const official of officials) {
        const workers = await storage.btuPolitical.getWorkersByOfficialId(official.id);
        rows.push({
          Name: official.name,
          Office: official.officeName,
          Level: official.level,
          Division: official.division || "",
          Party: official.party || "",
          Phone: (official.phones || []).join("; "),
          Email: (official.emails || []).join("; "),
          "Worker Count": workers.length,
        });
      }

      const csv = stringify(rows, { header: true });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=political-profiles-report.csv");
      res.send(csv);
    } catch (error: any) {
      if (error.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      console.error("Failed to generate CSV report:", error);
      res.status(500).json({ message: "Failed to generate CSV report" });
    }
  });
}
