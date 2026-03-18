import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "./components";
import { storage } from "../storage";
import { lookupRepresentatives } from "../services/google-civics";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const lookupSchema = z.object({
  address: z.string().optional(),
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
      const workers = await storage.btuPolitical.getWorkersWithDetailsByOfficialId(req.params.id);
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

  app.get("/api/workers/:workerId/political/primary-address", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const worker = await storage.workers.getWorker(req.params.workerId);
      if (!worker) return res.status(404).json({ message: "Worker not found" });
      const addresses = await storage.contacts.getContactPostalByContact(worker.contactId);
      const primary = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
      if (!primary) return res.json({ address: null });
      const parts = [primary.street, primary.city, primary.state, primary.postalCode].filter(Boolean);
      res.json({ address: parts.join(", ") });
    } catch (error: any) {
      console.error("Failed to fetch primary address:", error);
      res.status(500).json({ message: "Failed to fetch primary address" });
    }
  });

  app.post("/api/workers/:workerId/political/lookup", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    try {
      const parsed = lookupSchema.safeParse({ ...req.body, workerId: req.params.workerId });
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { workerId } = parsed.data;
      let { address } = parsed.data;

      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      if (!address || !address.trim()) {
        const addresses = await storage.contacts.getContactPostalByContact(worker.contactId);
        const primary = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
        if (!primary) {
          return res.status(400).json({ message: "No address provided and worker has no primary address on file." });
        }
        const parts = [primary.street, primary.city, primary.state, primary.postalCode].filter(Boolean);
        address = parts.join(", ");
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

      const rows: Record<string, string | number>[] = [];
      for (const official of officials) {
        const workers = await storage.btuPolitical.getWorkersWithDetailsByOfficialId(official.id);
        for (const worker of workers) {
          rows.push({
            "Representative Name": official.name,
            "Office": official.officeName,
            "Level": official.level,
            "Division": official.division || "",
            "Party": official.party || "",
            "Rep Phone": (official.phones || []).join("; "),
            "Rep Email": (official.emails || []).join("; "),
            "Worker Name": worker.workerName || "",
            "Worker Address": worker.address || "",
          });
        }
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
