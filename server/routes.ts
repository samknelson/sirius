import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertWorkerSchema, 
  loginUserSchema, 
  createUserSchema,
  insertRoleSchema,
  insertPermissionSchema,
  assignRoleSchema,
  assignPermissionSchema
} from "@shared/schema";

// Session type extension
declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

// Authentication middleware
const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};

// Permission middleware
const requirePermission = (permissionKey: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    const hasPermission = await storage.userHasPermission(req.session.userId, permissionKey);
    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    
    next();
  };
};

export async function registerRoutes(app: Express): Promise<Server> {
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
      const users = await storage.getAllUsers();
      res.json(users.map(u => ({ 
        id: u.id, 
        username: u.username, 
        isActive: u.isActive, 
        createdAt: u.createdAt 
      })));
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
        createdAt: user.createdAt 
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

  // POST /api/admin/permissions - Create permission (admin only)
  app.post("/api/admin/permissions", requireAuth, requirePermission("admin.manage"), async (req, res) => {
    try {
      const validatedData = insertPermissionSchema.parse(req.body);
      const permission = await storage.createPermission(validatedData);
      res.status(201).json(permission);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid permission data" });
      } else {
        res.status(500).json({ message: "Failed to create permission" });
      }
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
      const { permissionId } = assignPermissionSchema.parse({ roleId, ...req.body });
      
      const assignment = await storage.assignPermissionToRole({ roleId, permissionId });
      res.status(201).json(assignment);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid assignment data" });
      } else {
        res.status(500).json({ message: "Failed to assign permission" });
      }
    }
  });

  // Worker routes (protected with authentication and permissions)
  
  // GET /api/workers - Get all workers (requires workers.view permission)
  app.get("/api/workers", requireAuth, requirePermission("workers.view"), async (req, res) => {
    try {
      const workers = await storage.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // POST /api/workers - Create a new worker (requires workers.manage permission)
  app.post("/api/workers", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const validatedData = insertWorkerSchema.parse(req.body);
      const worker = await storage.createWorker(validatedData);
      res.status(201).json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to create worker" });
      }
    }
  });

  // PUT /api/workers/:id - Update a worker (requires workers.manage permission)
  app.put("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertWorkerSchema.partial().parse(req.body);
      const worker = await storage.updateWorker(id, validatedData);
      
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to update worker" });
      }
    }
  });

  // DELETE /api/workers/:id - Delete a worker (requires workers.manage permission)
  app.delete("/api/workers/:id", requireAuth, requirePermission("workers.manage"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteWorker(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
