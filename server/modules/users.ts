import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { 
  createUserSchema,
  insertRoleSchema,
  assignRoleSchema,
  assignPermissionSchema
} from "@shared/schema";

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerUserRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Admin routes for user management
  
  // GET /api/admin/users - Get all users (admin only)
  app.get("/api/admin/users", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const usersWithRoles = await storage.getAllUsersWithRoles();
      
      // Shape response to exclude sensitive fields
      const safeUsersWithRoles = usersWithRoles.map(user => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
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

  // POST /api/admin/users - Create user (admin only)
  app.post("/api/admin/users", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const userData = createUserSchema.parse(req.body);
      
      const existingUser = await storage.getUser(userData.id);
      if (existingUser) {
        return res.status(409).json({ message: "User already exists" });
      }

      const user = await storage.createUser(userData);

      res.status(201).json({ 
        id: user.id, 
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive, 
        createdAt: user.createdAt 
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid user data" });
      } else {
        res.status(500).json({ message: "Failed to create user" });
      }
    }
  });

  // GET /api/admin/users/:id - Get user details (admin only)
  app.get("/api/admin/users/:id", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ 
        id: user.id, 
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
        isActive: user.isActive, 
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user details" });
    }
  });

  // PUT /api/admin/users/:id/status - Update user status (admin only)
  app.put("/api/admin/users/:id/status", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const user = await storage.updateUser(id, { isActive });
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
  app.get("/api/admin/roles", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const roles = await storage.getAllRoles();
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch roles" });
    }
  });

  // POST /api/admin/roles - Create role (admin only)
  app.post("/api/admin/roles", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const validatedData = insertRoleSchema.parse(req.body);
      const role = await storage.createRole(validatedData);
      res.status(201).json(role);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid role data" });
      } else {
        res.status(500).json({ message: "Failed to create role" });
      }
    }
  });

  // Permission management routes
  
  // GET /api/admin/permissions - Get all permissions (admin only)
  app.get("/api/admin/permissions", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const permissions = await storage.getAllPermissions();
      res.json(permissions);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  // Assignment routes
  
  // GET /api/admin/users/:userId/roles - Get user roles (admin only)
  app.get("/api/admin/users/:userId/roles", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { userId } = req.params;
      const roles = await storage.getUserRoles(userId);
      res.json(roles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user roles" });
    }
  });

  // POST /api/admin/users/:userId/roles - Assign role to user (admin only)
  app.post("/api/admin/users/:userId/roles", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { userId } = req.params;
      const { roleId } = assignRoleSchema.parse({ userId, ...req.body });
      
      const assignment = await storage.assignRoleToUser({ userId, roleId });
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
  app.delete("/api/admin/users/:userId/roles/:roleId", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { userId, roleId } = req.params;
      const success = await storage.unassignRoleFromUser(userId, roleId);
      
      if (!success) {
        return res.status(404).json({ message: "Assignment not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to unassign role" });
    }
  });

  // POST /api/admin/roles/:roleId/permissions - Assign permission to role (admin only)
  app.post("/api/admin/roles/:roleId/permissions", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { roleId } = req.params;
      const { permissionKey } = assignPermissionSchema.parse({ roleId, ...req.body });
      
      const assignment = await storage.assignPermissionToRole({ roleId, permissionKey });
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid assignment data" });
      } else if (error instanceof Error && error.message.includes("does not exist in the registry")) {
        res.status(400).json({ message: error.message });
      } else {
        res.status(500).json({ message: "Failed to assign permission" });
      }
    }
  });
}