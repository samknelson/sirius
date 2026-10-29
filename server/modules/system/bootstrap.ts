import type { Express } from "express";
import { storage } from "../../storage";
import { getEnvironmentVariable } from "../../config/env-registry";

/** A configured operator account closes public provisioning even if its
 * reconciliation failed. Share this decision with the first-run status UI. */
async function bootstrapRefusal(): Promise<string | null> {
  if (getEnvironmentVariable("LOCAL_AUTH_EMAIL")?.trim()) {
    return "Public bootstrap is disabled because administrator provisioning is operator-managed";
  }
  return await storage.users.hasAnyUsers()
    ? "Bootstrap is only allowed when no users exist"
    : null;
}

export function registerBootstrapRoutes(app: Express) {
  // GET /api/bootstrap/needed - Report whether public first-run setup is available.
  app.get("/api/bootstrap/needed", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      res.json({ needed: (await bootstrapRefusal()) === null });
    } catch (error) {
      res.status(500).json({ message: "Failed to check bootstrap status" });
    }
  });

  // POST /api/bootstrap - Create admin role with all permissions and first user (only if no users exist)
  app.post("/api/bootstrap", async (req, res) => {
    try {
      const refusal = await bootstrapRefusal();
      if (refusal) {
        return res.status(403).json({ message: refusal });
      }

      const { email, firstName, lastName } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
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

      // If a local credential is configured via env for this email, attach it
      // now so the operator can log in immediately without a restart.
      try {
        const { ensureLocalAdminAccount } = await import("../../auth/local-seed");
        await ensureLocalAdminAccount();
      } catch (seedError) {
        console.error("Local credential seeding after bootstrap failed:", seedError);
      }

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
