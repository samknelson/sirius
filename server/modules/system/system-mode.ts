import type { Express } from "express";
import { storage } from "../../storage";

export function registerSystemModeRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any
) {
  // Reads go through GET /api/variables/by-name/system_mode (public in the
  // variable read-access registry); this module only keeps the write route.

  // PUT /api/system-mode - Update system mode (requires admin policy)
  app.put("/api/system-mode", requireAccess('admin'), async (req, res) => {
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
