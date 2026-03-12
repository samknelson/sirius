import type { Express } from "express";
import { storage } from "../storage";

export function registerBootstrapRoutes(app: Express) {
  // GET /api/bootstrap/needed - Check if bootstrap is needed (no users in database)
  app.get("/api/bootstrap/needed", async (req, res) => {
    try {
      const hasUsers = await storage.users.hasAnyUsers();
      res.json({ needed: !hasUsers });
    } catch (error) {
      res.status(500).json({ message: "Failed to check bootstrap status" });
    }
  });

  // POST /api/bootstrap - Create admin role with all permissions and first user (only if no users exist)
  app.post("/api/bootstrap", async (req, res) => {
    try {
      const { email, firstName, lastName } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Check if any users already exist
      const hasUsers = await storage.users.hasAnyUsers();
      if (hasUsers) {
        return res.status(403).json({ message: "Bootstrap is only allowed when no users exist" });
      }

      // Get all permissions from the registry
      const allPermissions = await storage.users.getAllPermissions();

      // Create admin role
      const adminRole = await storage.users.createRole({
        name: "admin",
        description: "Administrator role with all permissions"
      });

      // Assign all permissions to admin role
      for (const permission of allPermissions) {
        await storage.users.assignPermissionToRole({
          roleId: adminRole.id,
          permissionKey: permission.key
        });
      }

      // Create first user
      const newUser = await storage.users.createUser({
        email,
        firstName: firstName || null,
        lastName: lastName || null,
        accountStatus: 'pending',
        isActive: true
      });

      // Assign admin role to user
      await storage.users.assignRoleToUser({
        userId: newUser.id,
        roleId: adminRole.id
      });

      res.json({
        message: "Bootstrap completed successfully",
        user: {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName
        },
        role: {
          id: adminRole.id,
          name: adminRole.name
        }
      });
    } catch (error) {
      console.error("Bootstrap error:", error);
      res.status(500).json({ message: "Failed to complete bootstrap" });
    }
  });
}
