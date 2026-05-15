import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { insertFreemanCrewleadSchema } from "../../../../shared/schema/sitespecific/freeman/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerFreemanCrewleadsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const crewleadsStorage = storage.freemanCrewleads;
  const componentMiddleware = requireComponent("sitespecific.freeman");
  const viewerGate = requireAccess("edls.any");
  const managerGate = requirePermission("edls.manager");

  const tableUnavailable = (res: Response) =>
    res.status(503).json({
      message:
        "Freeman Crew Leads table does not exist. Please enable the Freeman component first.",
    });

  app.get(
    "/api/sitespecific/freeman/crewleads",
    requireAuth,
    componentMiddleware,
    viewerGate,
    async (_req, res) => {
      try {
        if (!(await crewleadsStorage.tableExists())) return tableUnavailable(res);
        const records = await crewleadsStorage.getAll();
        res.json(records);
      } catch (error) {
        console.error("Failed to fetch Freeman crew leads:", error);
        res.status(500).json({ message: "Failed to fetch crew leads" });
      }
    },
  );

  app.get(
    "/api/sitespecific/freeman/crewleads/:id",
    requireAuth,
    componentMiddleware,
    viewerGate,
    async (req, res) => {
      try {
        if (!(await crewleadsStorage.tableExists())) return tableUnavailable(res);
        const record = await crewleadsStorage.get(req.params.id);
        if (!record) return res.status(404).json({ message: "Crew lead not found" });
        res.json(record);
      } catch (error) {
        console.error("Failed to fetch Freeman crew lead:", error);
        res.status(500).json({ message: "Failed to fetch crew lead" });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/crewleads",
    requireAuth,
    componentMiddleware,
    managerGate,
    async (req, res) => {
      try {
        if (!(await crewleadsStorage.tableExists())) return tableUnavailable(res);
        const parsed = insertFreemanCrewleadSchema.parse(req.body);
        const record = await crewleadsStorage.create(parsed);
        res.status(201).json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res
            .status(409)
            .json({ message: "A crew lead with this Sirius ID already exists" });
        }
        console.error("Failed to create Freeman crew lead:", error);
        res.status(500).json({ message: "Failed to create crew lead" });
      }
    },
  );

  const updateHandler = async (req: Request, res: Response) => {
    try {
      if (!(await crewleadsStorage.tableExists())) return tableUnavailable(res);
      const parsed = insertFreemanCrewleadSchema.partial().parse(req.body);
      const record = await crewleadsStorage.update(req.params.id, parsed);
      if (!record) return res.status(404).json({ message: "Crew lead not found" });
      res.json(record);
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A crew lead with this Sirius ID already exists" });
      }
      console.error("Failed to update Freeman crew lead:", error);
      res.status(500).json({ message: "Failed to update crew lead" });
    }
  };

  app.put(
    "/api/sitespecific/freeman/crewleads/:id",
    requireAuth,
    componentMiddleware,
    managerGate,
    updateHandler,
  );
  app.patch(
    "/api/sitespecific/freeman/crewleads/:id",
    requireAuth,
    componentMiddleware,
    managerGate,
    updateHandler,
  );

  app.delete(
    "/api/sitespecific/freeman/crewleads/:id",
    requireAuth,
    componentMiddleware,
    managerGate,
    async (req, res) => {
      try {
        if (!(await crewleadsStorage.tableExists())) return tableUnavailable(res);
        const success = await crewleadsStorage.delete(req.params.id);
        if (!success) return res.status(404).json({ message: "Crew lead not found" });
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to delete Freeman crew lead:", error);
        res.status(500).json({ message: "Failed to delete crew lead" });
      }
    },
  );
}
