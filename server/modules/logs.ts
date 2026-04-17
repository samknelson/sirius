import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";

const logsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default("1"),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default("50"),
  module: z.string().optional(),
  operation: z.string().optional(),
  search: z.string().optional(),
});

export function registerLogRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  // GET /api/logs - Get all logs with pagination and filtering (requires admin policy)
  app.get("/api/logs", requireAccess('admin'), async (req, res) => {
    try {
      const params = logsQuerySchema.parse(req.query);
      const result = await storage.logs.getLogs({
        page: params.page,
        limit: params.limit,
        module: params.module,
        operation: params.operation,
        search: params.search,
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ 
        error: "Failed to fetch logs",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // GET /api/logs/filters - Get unique modules and operations for filter dropdowns (requires admin policy)
  app.get("/api/logs/filters", requireAccess('admin'), async (req, res) => {
    try {
      const filters = await storage.logs.getLogFilters();
      res.json(filters);
    } catch (error) {
      console.error("Error fetching log filters:", error);
      res.status(500).json({ 
        error: "Failed to fetch log filters",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // GET /api/logs/by-entity - Unified endpoint to get logs by host entity ID
  // Resolves the entity type (worker / employer / facility) and aggregates host
  // entity IDs to include the associated contact id(s), so contact-side activity
  // (emails, addresses, phone numbers, name) shows up alongside the parent entity's
  // own logs. Access policy is selected based on entity type:
  //   - worker         -> worker.view
  //   - employer       -> employer.manage
  //   - facility       -> facility.view
  //   - other / unknown-> staff
  // NOTE: This route must be defined BEFORE /api/logs/:id to avoid route matching conflicts
  app.get("/api/logs/by-entity", requireAuth, async (req, res, next) => {
    const { hostEntityId } = req.query;
    if (!hostEntityId || typeof hostEntityId !== 'string') {
      return res.status(400).json({ message: "hostEntityId is required" });
    }

    // Resolve entity type and pick the matching policy.
    const safeGet = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch { return null; }
    };

    const worker = await safeGet(() => storage.workers.getWorker(hostEntityId));
    if (worker) {
      (req as any).logHostIds = worker.contactId ? [worker.id, worker.contactId] : [worker.id];
      return requireAccess('worker.view', () => worker.id)(req, res, next);
    }

    const facility = await safeGet(() => storage.facilities.get(hostEntityId));
    if (facility) {
      (req as any).logHostIds = facility.contactId ? [facility.id, facility.contactId] : [facility.id];
      return requireAccess('facility.view', () => facility.id)(req, res, next);
    }

    const employer = await safeGet(() => storage.employers.getEmployer(hostEntityId));
    if (employer) {
      const employerContacts = await safeGet(() => storage.employerContacts.listByEmployer(employer.id)) ?? [];
      (req as any).logHostIds = [employer.id, ...employerContacts.map((ec) => ec.contactId)];
      return requireAccess('employer.manage', () => employer.id)(req, res, next);
    }

    // Unknown entity type - fall back to staff and use the id as-is.
    (req as any).logHostIds = [hostEntityId];
    return requireAccess('staff')(req, res, next);
  }, async (req, res) => {
    try {
      const { module, operation, startDate, endDate } = req.query;
      const hostEntityIds: string[] = (req as any).logHostIds ?? [];

      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds,
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch logs by entity:", error);
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  // GET /api/logs/:id - Get a single log by ID (requires admin policy)
  app.get("/api/logs/:id", requireAccess('admin'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
      }

      const log = await storage.logs.getLogById(id);

      if (!log) {
        return res.status(404).json({ error: "Log not found" });
      }

      res.json(log);
    } catch (error) {
      console.error("Error fetching log:", error);
      res.status(500).json({ 
        error: "Failed to fetch log",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // GET /api/workers/:workerId/logs - Get all logs related to a worker (requires staff permission)
  app.get("/api/workers/:workerId/logs", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Get the worker to ensure it exists and get the contactId
      const worker = await storage.workers.getWorker(workerId);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }

      // Query by host entity IDs: worker ID and contact ID
      // This will capture all logs for:
      // - Worker (hostEntityId = workerId)
      // - Worker IDs (hostEntityId = workerId)
      // - Worker employment history (hostEntityId = workerId)
      // - Contact (hostEntityId = contactId)
      // - Addresses (hostEntityId = contactId)
      // - Phone numbers (hostEntityId = contactId)
      const hostEntityIds: string[] = [workerId];
      if (worker.contactId) {
        hostEntityIds.push(worker.contactId);
      }

      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds,
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch worker logs:", error);
      res.status(500).json({ message: "Failed to fetch worker logs" });
    }
  });

  // GET /api/employers/:employerId/logs - Get all logs related to an employer (requires staff permission)
  app.get("/api/employers/:employerId/logs", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const { employerId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Get the employer to ensure it exists
      const employer = await storage.employers.getEmployer(employerId);
      if (!employer) {
        return res.status(404).json({ message: "Employer not found" });
      }

      // Query by host entity IDs: employer ID and all contact IDs from employer contacts
      // This will capture all logs for:
      // - Employer (hostEntityId = employerId)
      // - Employer contacts (hostEntityId = employerId)
      // - Contacts (hostEntityId = contactId for each employer contact)
      // - Addresses (hostEntityId = contactId)
      // - Phone numbers (hostEntityId = contactId)
      const hostEntityIds: string[] = [employerId];

      // Get all employer contacts for this employer
      const employerContacts = await storage.employerContacts.listByEmployer(employerId);
      
      // Add all contact IDs from employer contacts
      const contactIds = employerContacts.map(ec => ec.contactId);
      hostEntityIds.push(...contactIds);

      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds,
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch employer logs:", error);
      res.status(500).json({ message: "Failed to fetch employer logs" });
    }
  });

  // GET /api/edls/sheets/:sheetId/logs - Get all logs related to an EDLS sheet (requires edls.coordinator permission)
  app.get("/api/edls/sheets/:sheetId/logs", requireAuth, requireAccess('edls.coordinator'), async (req, res) => {
    try {
      const { sheetId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Verify the sheet exists
      const sheet = await storage.edlsSheets.get(sheetId);
      if (!sheet) {
        return res.status(404).json({ message: "Sheet not found" });
      }

      // Query by sheet ID as host entity - this captures:
      // - Sheet operations (hostEntityId = sheetId)
      // - Crew operations (hostEntityId = sheetId)
      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds: [sheetId],
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
      });

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch EDLS sheet logs:", error);
      res.status(500).json({ message: "Failed to fetch sheet logs" });
    }
  });
}
