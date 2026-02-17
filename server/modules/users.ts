import type { Express, Request, Response, NextFunction } from "express";
import { createClerkClient } from "@clerk/express";
import { storage } from "../storage";
import { 
  createUserSchema,
  insertRoleSchema,
  assignRoleSchema,
  assignPermissionSchema
} from "@shared/schema";
import { requireAccess, clearAccessCache } from "../services/access-policy-evaluator";
import { logger } from "../logger";

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerUserRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Admin routes for user management
  
  // GET /api/admin/users/search - Search users by email (admin only)
  // MIGRATED to new access control system
  app.get("/api/admin/users/search", requireAccess('admin'), async (req, res) => {
    try {
      const query = (req.query.q as string || '').toLowerCase();
      
      if (!query || query.length < 2) {
        return res.json([]);
      }
      
      const usersWithRoles = await storage.users.getAllUsersWithRoles();
      
      // Filter users by email (case-insensitive partial match)
      const matchedUsers = usersWithRoles.filter(user => 
        user.email?.toLowerCase().includes(query)
      ).slice(0, 20); // Limit to 20 results
      
      // Shape response to exclude sensitive fields
      const safeUsers = matchedUsers.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        accountStatus: user.accountStatus,
        isActive: user.isActive,
      }));
      
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to search users" });
    }
  });
  
  // GET /api/admin/users/by-email/:email - Get user by email (admin only)
  app.get("/api/admin/users/by-email/:email", requireAccess('admin'), async (req, res) => {
    try {
      const { email } = req.params;
      const decodedEmail = decodeURIComponent(email);
      
      const user = await storage.users.getUserByEmail(decodedEmail);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        accountStatus: user.accountStatus,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLogin: user.lastLogin,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // GET /api/admin/users - Get all users (admin only)
  // MIGRATED to new access control system
  app.get("/api/admin/users", requireAccess('admin'), async (req, res) => {
    try {
      const usersWithRoles = await storage.users.getAllUsersWithRoles();
      
      // Shape response to exclude sensitive fields
      const safeUsersWithRoles = usersWithRoles.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        accountStatus: user.accountStatus,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        roles: user.roles
      }));
      
      res.json(safeUsersWithRoles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // POST /api/admin/users - Create user (admin only, email-based provisioning)
  // Automatically creates a Clerk account and links auth identity
  app.post("/api/admin/users", requireAccess('admin'), async (req, res) => {
    try {
      const userData = createUserSchema.parse(req.body);
      
      const existingUser = await storage.users.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(409).json({ message: "User with this email already exists" });
      }

      let clerkWarning: string | undefined;
      let clerkUserId: string | undefined;
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;

      if (clerkSecretKey && clerkPublishableKey) {
        const clerk = createClerkClient({ secretKey: clerkSecretKey, publishableKey: clerkPublishableKey });

        try {
          const existingClerkUsers = await clerk.users.getUserList({
            emailAddress: [userData.email],
          });
          if (existingClerkUsers.data.length > 0) {
            const existingClerkUser = existingClerkUsers.data[0];
            const existingIdentity = await storage.authIdentities.getByProviderAndExternalId("clerk", existingClerkUser.id);
            if (existingIdentity) {
              return res.status(409).json({ 
                message: "This email is already associated with an existing Clerk account linked to another user." 
              });
            }
            clerkUserId = existingClerkUser.id;
            logger.info("Found existing unlinked Clerk account for provisioned user", {
              clerkUserId: existingClerkUser.id,
              email: userData.email,
            });
          }
        } catch (lookupErr) {
          logger.warn("Failed to look up existing Clerk user, proceeding with creation", { error: lookupErr });
        }
      }

      const user = await storage.users.createUser(userData);

      if (clerkSecretKey && clerkPublishableKey) {
        try {
          const clerk = createClerkClient({ secretKey: clerkSecretKey, publishableKey: clerkPublishableKey });

          if (!clerkUserId) {
            const newClerkUser = await clerk.users.createUser({
              emailAddress: [userData.email],
              firstName: userData.firstName || undefined,
              lastName: userData.lastName || undefined,
              skipPasswordChecks: true,
              skipPasswordRequirement: true,
            });
            clerkUserId = newClerkUser.id;
            logger.info("Created Clerk account for provisioned user", {
              userId: user.id,
              clerkUserId: newClerkUser.id,
              email: userData.email,
            });
          }

          await storage.authIdentities.create({
            userId: user.id,
            providerType: "clerk",
            externalId: clerkUserId,
            email: userData.email,
            displayName: `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || undefined,
          });

          await storage.users.updateUser(user.id, {
            accountStatus: "linked",
          });

          logger.info("Auth identity linked for provisioned user", {
            userId: user.id,
            clerkUserId,
          });
        } catch (clerkErr: any) {
          logger.error("Failed to create/link Clerk account for provisioned user", {
            userId: user.id,
            email: userData.email,
            error: clerkErr?.message || clerkErr,
          });
          clerkWarning = "Clerk account could not be created automatically. User will need to sign up manually.";
        }
      }

      const updatedUser = await storage.users.getUser(user.id);

      const responseData: any = { 
        id: updatedUser?.id || user.id, 
        email: updatedUser?.email || user.email,
        firstName: updatedUser?.firstName || user.firstName,
        lastName: updatedUser?.lastName || user.lastName,
        accountStatus: updatedUser?.accountStatus || user.accountStatus,
        isActive: updatedUser?.isActive ?? user.isActive, 
        createdAt: updatedUser?.createdAt || user.createdAt 
      };
      if (clerkWarning) {
        responseData.clerkWarning = clerkWarning;
      }
      res.status(201).json(responseData);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid user data" });
      } else {
        console.error("Failed to create user:", error);
        res.status(500).json({ message: "Failed to create user" });
      }
    }
  });

  // GET /api/admin/users/:id - Get user details (admin only)
  // MIGRATED to new access control system
  app.get("/api/admin/users/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const user = await storage.users.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        accountStatus: user.accountStatus,
        isActive: user.isActive, 
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user details" });
    }
  });

  // PUT /api/admin/users/:id/status - Update user status (admin only)
  // MIGRATED to new access control system
  app.put("/api/admin/users/:id/status", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const user = await storage.users.updateUser(id, { isActive });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        id: user.id, 
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive, 
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Role management routes
  
  // GET /api/admin/roles - Get all roles (admin only)
  // MIGRATED to new access control system
  app.get("/api/admin/roles", requireAccess('admin'), async (req, res) => {
    try {
      const roles = await storage.users.getAllRoles();
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  // POST /api/admin/roles - Create role (admin only)
  // MIGRATED to new access control system
  app.post("/api/admin/roles", requireAccess('admin'), async (req, res) => {
    try {
      const validatedData = insertRoleSchema.parse(req.body);
      const role = await storage.users.createRole(validatedData);
      res.status(201).json(role);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid role data" });
      } else {
        res.status(500).json({ message: "Failed to create role" });
      }
    }
  });

  // PUT /api/admin/roles/:id - Update role (admin only)
  app.put("/api/admin/roles/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertRoleSchema.partial().parse(req.body);
      
      const role = await storage.users.updateRole(id, validatedData);
      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }
      
      res.json(role);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid role data" });
      } else {
        res.status(500).json({ message: "Failed to update role" });
      }
    }
  });

  // DELETE /api/admin/roles/:id - Delete role (admin only)
  app.delete("/api/admin/roles/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.users.deleteRole(id);
      
      if (!success) {
        return res.status(404).json({ message: "Role not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  // Permission management routes
  
  // GET /api/admin/permissions - Get all permissions (admin only)
  app.get("/api/admin/permissions", requireAccess('admin'), async (req, res) => {
    try {
      const permissions = await storage.users.getAllPermissions();
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  // Logging routes
  
  // GET /api/users/:userId/logs - Get all logs related to a user (requires staff permission)
  app.get("/api/users/:userId/logs", requireAuth, requireAccess('staff'), async (req, res) => {
    try {
      const { userId } = req.params;
      const { module, operation, startDate, endDate } = req.query;

      // Query by host entity ID: user ID
      // This will capture all logs for:
      // - User record changes (hostEntityId = userId)
      // - Role assignments for this user (hostEntityId = userId)
      const logs = await storage.logs.getLogsByHostEntityIds({
        hostEntityIds: [userId],
        module: typeof module === 'string' ? module : undefined,
        operation: typeof operation === 'string' ? operation : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        limit: 500,
      });

      res.json(logs);
    } catch (error) {
      console.error("Failed to fetch user logs:", error);
      res.status(500).json({ message: "Failed to fetch user logs" });
    }
  });

  // Assignment routes
  
  // GET /api/users/:userId/roles - Get user roles (authenticated users)
  // Users can view their own roles or any user's roles if they're logged in
  app.get("/api/users/:userId/roles", requireAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const roles = await storage.users.getUserRoles(userId);
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user roles" });
    }
  });
  
  // GET /api/admin/users/:userId/roles - Get user roles (admin only)
  app.get("/api/admin/users/:userId/roles", requireAccess('admin'), async (req, res) => {
    try {
      const { userId } = req.params;
      const roles = await storage.users.getUserRoles(userId);
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user roles" });
    }
  });

  // POST /api/admin/users/:userId/roles - Assign role to user (admin only)
  app.post("/api/admin/users/:userId/roles", requireAccess('admin'), async (req, res) => {
    try {
      const { userId } = req.params;
      const { roleId } = assignRoleSchema.parse({ userId, ...req.body });
      
      const assignment = await storage.users.assignRoleToUser({ userId, roleId });
      clearAccessCache(); // Invalidate policy cache when user roles change
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid assignment data" });
      } else {
        res.status(500).json({ message: "Failed to assign role" });
      }
    }
  });

  // DELETE /api/admin/users/:userId/roles/:roleId - Unassign role from user (admin only)
  app.delete("/api/admin/users/:userId/roles/:roleId", requireAccess('admin'), async (req, res) => {
    try {
      const { userId, roleId } = req.params;
      const success = await storage.users.unassignRoleFromUser(userId, roleId);
      
      if (!success) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      
      clearAccessCache(); // Invalidate policy cache when user roles change
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to unassign role" });
    }
  });

  // GET /api/admin/role-permissions - Get all role-permission assignments (admin only)
  app.get("/api/admin/role-permissions", requireAccess('admin'), async (req, res) => {
    try {
      const rolePermissions = await storage.users.getAllRolePermissions();
      res.json(rolePermissions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch role-permission assignments" });
    }
  });

  // POST /api/admin/roles/:roleId/permissions - Assign permission to role (admin only)
  app.post("/api/admin/roles/:roleId/permissions", requireAccess('admin'), async (req, res) => {
    try {
      const { roleId } = req.params;
      const { permissionKey } = assignPermissionSchema.parse({ roleId, ...req.body });
      
      const assignment = await storage.users.assignPermissionToRole({ roleId, permissionKey });
      clearAccessCache(); // Invalidate policy cache when permissions change
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid assignment data" });
      } else if (error instanceof Error && error.message.includes("does not exist in the registry")) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof Error && error.message.includes("duplicate key value")) {
        res.status(409).json({ message: "This permission is already assigned to this role" });
      } else {
        res.status(500).json({ message: "Failed to assign permission" });
      }
    }
  });

  // POST /api/admin/roles/:roleId/permissions/bulk - Bulk assign permissions to role (admin only)
  app.post("/api/admin/roles/:roleId/permissions/bulk", requireAccess('admin'), async (req, res) => {
    try {
      const { roleId } = req.params;
      const { permissionKeys } = req.body;
      
      if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) {
        return res.status(400).json({ message: "permissionKeys must be a non-empty array" });
      }
      
      const assignments = await storage.users.assignPermissionsToRoleBulk(roleId, permissionKeys);
      clearAccessCache(); // Invalidate policy cache when permissions change
      res.status(201).json({ 
        message: `${assignments.length} permission(s) assigned successfully`,
        assignments 
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("does not exist in the registry")) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to assign permissions" });
      }
    }
  });

  // DELETE /api/admin/roles/:roleId/permissions/:permissionKey - Unassign permission from role (admin only)
  app.delete("/api/admin/roles/:roleId/permissions/:permissionKey", requireAccess('admin'), async (req, res) => {
    try {
      const { roleId, permissionKey } = req.params;
      const success = await storage.users.unassignPermissionFromRole(roleId, permissionKey);
      
      if (!success) {
        return res.status(404).json({ message: "Permission assignment not found" });
      }
      
      clearAccessCache(); // Invalidate policy cache when permissions change
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to unassign permission" });
    }
  });
}