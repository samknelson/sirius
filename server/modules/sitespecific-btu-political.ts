import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "./components";
import { storage } from "../storage";
import { lookupRepresentatives, CivicApiError } from "../services/google-civics";
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
      const addresses = await storage.contacts.addresses.getContactPostalByContact(worker.contactId);
      const primary = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
      if (!primary) return res.json({ address: null });
      const parts = [primary.street, primary.city, primary.state, primary.postalCode].filter(Boolean);
      res.json({ address: parts.join(", ") });
    } catch (error: unknown) {
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
        const addresses = await storage.contacts.addresses.getContactPostalByContact(worker.contactId);
        const primary = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
        if (!primary) {
          return res.status(400).json({ message: "No address provided and worker has no primary address on file." });
        }
        const parts = [primary.street, primary.city, primary.state, primary.postalCode].filter(Boolean);
        address = parts.join(", ");
      }

      const result = await lookupRepresentatives(address, { districtCacheStorage: storage.btuPolitical });

      let officialIds: string[];
      if (result.cacheHit && result.cachedOfficialIds) {
        officialIds = result.cachedOfficialIds;
      } else {
        officialIds = [];
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
        if (result.districtKey && officialIds.length > 0) {
          const parts = result.districtKey.split("|");
          await storage.btuPolitical.setDistrictCache(
            result.districtKey, parts[0] || "", parts[1] || "", parts[2] || "", parts[3] || "", officialIds
          );
        }
      }

      await storage.btuPolitical.setWorkerReps(workerId, officialIds, result.normalizedAddress);

      const reps = await storage.btuPolitical.getWorkerReps(workerId);
      res.json({
        normalizedAddress: result.normalizedAddress,
        representatives: reps,
        count: reps.length,
        cacheHit: result.cacheHit,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.message === "COMPONENT_TABLE_NOT_FOUND") {
        return res.status(503).json({ message: "Political profile tables not found." });
      }
      if (err.message?.includes("API_KEY")) {
        return res.status(503).json({ message: "Required API keys are not configured. Please set GOOGLE_CIVICS_API_KEY and OPEN_STATES_API_KEY." });
      }
      if (error instanceof CivicApiError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Failed to lookup representatives:", error);
      res.status(500).json({ message: "Failed to lookup representatives" });
    }
  });

  let activeBulkJob: { id: string; controller: AbortController } | null = null;

  app.post("/api/sitespecific/btu/political/bulk-lookup", requireAuth, requirePermission("staff"), componentMiddleware, async (req, res) => {
    if (activeBulkJob) {
      return res.status(409).json({ message: "A bulk lookup is already in progress. Please wait for it to finish or cancel it first." });
    }

    const skipExisting = req.body.skipExisting !== false;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const jobId = `bulk-${Date.now()}`;
    const controller = new AbortController();
    activeBulkJob = { id: jobId, controller };
    const signal = controller.signal;

    try {
      const allWorkers = await storage.workers.getAllWorkers();
      const total = allWorkers.length;
      let processed = 0;
      let succeeded = 0;
      let skippedNoAddress = 0;
      let skippedExisting = 0;
      let cacheHits = 0;
      let failed = 0;
      const errors: { workerId: string; error: string }[] = [];

      sendEvent({ type: "start", total });

      for (const worker of allWorkers) {
        if (signal.aborted) {
          sendEvent({ type: "cancelled", processed, succeeded, skippedNoAddress, skippedExisting, cacheHits, failed });
          res.end();
          return;
        }

        processed++;

        try {
          if (skipExisting) {
            const existingReps = await storage.btuPolitical.getWorkerReps(worker.id);
            if (existingReps.length > 0) {
              skippedExisting++;
              if (processed % 10 === 0 || processed === total) {
                sendEvent({ type: "progress", processed, total, succeeded, skippedNoAddress, skippedExisting, cacheHits, failed });
              }
              continue;
            }
          }

          const addresses = await storage.contacts.addresses.getContactPostalByContact(worker.contactId);
          const primary = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
          if (!primary) {
            skippedNoAddress++;
            if (processed % 10 === 0 || processed === total) {
              sendEvent({ type: "progress", processed, total, succeeded, skippedNoAddress, skippedExisting, cacheHits, failed });
            }
            continue;
          }

          const parts = [primary.street, primary.city, primary.state, primary.postalCode].filter(Boolean);
          const address = parts.join(", ");

          const result = await lookupRepresentatives(address, { districtCacheStorage: storage.btuPolitical });

          let officialIds: string[];
          if (result.cacheHit && result.cachedOfficialIds) {
            cacheHits++;
            officialIds = result.cachedOfficialIds;
          } else {
            officialIds = [];
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
            if (result.districtKey && officialIds.length > 0) {
              const dkParts = result.districtKey.split("|");
              await storage.btuPolitical.setDistrictCache(
                result.districtKey, dkParts[0] || "", dkParts[1] || "", dkParts[2] || "", dkParts[3] || "", officialIds
              );
            }
          }

          await storage.btuPolitical.setWorkerReps(worker.id, officialIds, result.normalizedAddress);
          succeeded++;
        } catch (err: unknown) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ workerId: worker.id, error: msg });
        }

        sendEvent({ type: "progress", processed, total, succeeded, skippedNoAddress, skippedExisting, cacheHits, failed });

        if (!signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      sendEvent({ type: "complete", processed, total, succeeded, skippedNoAddress, skippedExisting, cacheHits, failed, errors: errors.slice(0, 50) });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      sendEvent({ type: "error", message: err.message });
    } finally {
      activeBulkJob = null;
      res.end();
    }
  });

  app.post("/api/sitespecific/btu/political/bulk-lookup/cancel", requireAuth, requirePermission("staff"), componentMiddleware, async (_req, res) => {
    if (activeBulkJob) {
      activeBulkJob.controller.abort();
      res.json({ message: "Cancellation requested" });
    } else {
      res.json({ message: "No bulk lookup in progress" });
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
