import type { Express } from "express";
import { storage } from "../storage";

export function registerSystemModeRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any,
  policies: any
) {
  // GET /api/system-mode - Get current system mode (no auth required for indicator display)
  app.get("/api/system-mode", async (req, res) => {
    try {
      const modeVar = await storage.variables.getByName("system_mode");
      const mode = modeVar ? (modeVar.value as string) : "dev";
      res.json({ mode });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch system mode" });
    }
  });

  // PUT /api/system-mode - Update system mode (requires admin policy)
  app.put("/api/system-mode", requireAccess(policies.admin), async (req, res) => {
    try {
      const { mode } = req.body;
      
      // Validate mode
      const validModes = ["dev", "test", "live"];
      if (!validModes.includes(mode)) {
        res.status(400).json({ message: "Invalid mode. Must be 'dev', 'test', or 'live'" });
        return;
      }
      
      // Update or create system_mode variable
      const existingVariable = await storage.variables.getByName("system_mode");
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: mode });
      } else {
        await storage.variables.create({ name: "system_mode", value: mode });
      }
      
      res.json({ mode });
    } catch (error) {
      res.status(500).json({ message: "Failed to update system mode" });
    }
  });
}
