import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { 
  loginUserSchema, 
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
  // Authentication routes
  
  // POST /api/login - User login
  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = loginUserSchema.parse(req.body);
      
      const user = await storage.getUserByUsername(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Handle legacy password field during transition
      const passwordToCheck = user.password_hash || (user as any).password;
      if (!passwordToCheck) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValid = user.password_hash 
        ? await storage.verifyPassword(password, user.password_hash)
        : password === (user as any).password; // Temporary fallback for existing users

      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Update last login timestamp
      await storage.updateUserLastLogin(user.id);

      req.session.userId = user.id;
      req.session.username = user.username;

      const userPermissions = await storage.getUserPermissions(user.id);
      
      res.json({ 
        user: { 
          id: user.id, 
          username: user.username, 
          isActive: user.isActive 
        },
        permissions: userPermissions.map(p => p.key)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid login data" });
      } else {
        res.status(500).json({ message: "Login failed" });
      }
    }
  });

  // POST /api/logout - User logout
  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // GET /api/me - Get current user info
  app.get("/api/me", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const userPermissions = await storage.getUserPermissions(user.id);
      
      res.json({
        user: { 
          id: user.id, 
          username: user.username, 
          isActive: user.isActive 
        },
        permissions: userPermissions.map(p => p.key)
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });

  // Admin routes for user management
  
  // GET /api/admin/users - Get all users (admin only)
  app.get("/api/admin/users", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const usersWithRoles = await storage.getAllUsersWithRoles();
      
      // Shape response to exclude sensitive fields
      const safeUsersWithRoles = usersWithRoles.map(user => ({
        id: user.id,
        username: user.username,
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
      const { username, password } = createUserSchema.parse(req.body);
      
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already exists" });
      }

      const hashedPassword = await storage.hashPassword(password);
      const user = await storage.createUser({
        username,
        password_hash: hashedPassword,
        isActive: true
      });

      res.status(201).json({ 
        id: user.id, 
        username: user.username, 
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
        username: user.username, 
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
        username: user.username, 
        isActive: user.isActive, 
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // PUT /api/admin/users/:id/password - Update user password (admin only)
  app.put("/api/admin/users/:id/password", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password || password.trim().length === 0) {
        return res.status(400).json({ message: "Password is required" });
      }

      const hashedPassword = await storage.hashPassword(password);
      const user = await storage.updateUser(id, { password_hash: hashedPassword });
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update password" });
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