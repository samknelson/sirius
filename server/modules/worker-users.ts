import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Worker Users Module
 * 
 * This module provides API endpoints for creating and managing user accounts
 * linked to workers. Similar to employer contacts, it uses configurable
 * required and optional roles from the worker_user_roles_* variables.
 */
export function registerWorkerUsersRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  // GET /api/workers/:id/user - Get user linked to worker
  app.get("/api/workers/:id/user", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Get worker
      const worker = await storage.workers.getWorker(id);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Get worker's contact
      const contact = await storage.contacts.getContact(worker.contactId);
      if (!contact) {
        return res.status(404).json({ message: "Worker contact not found" });
      }
      
      // Check if contact has an email
      if (!contact.email) {
        return res.json({ 
          hasUser: false,
          user: null,
          userRoleIds: [],
          requiredRoleIds: [],
          optionalRoleIds: [],
          contactEmail: null,
          hasEmail: false
        });
      }
      
      // Get worker user settings (required/optional roles)
      const requiredVariable = await storage.variables.getByName('worker_user_roles_required');
      const optionalVariable = await storage.variables.getByName('worker_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const optionalRoleIds: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Get user by email if exists
      const user = await storage.users.getUserByEmail(contact.email);
      
      if (user) {
        // Get user's current roles
        const userRoles = await storage.users.getUserRoles(user.id);
        const userRoleIds = userRoles.map(r => r.id);
        
        return res.json({
          hasUser: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: user.isActive,
            accountStatus: user.accountStatus,
          },
          userRoleIds,
          requiredRoleIds,
          optionalRoleIds,
          contactEmail: contact.email,
          hasEmail: true,
        });
      } else {
        // No user exists yet
        return res.json({
          hasUser: false,
          user: null,
          userRoleIds: [],
          requiredRoleIds,
          optionalRoleIds,
          contactEmail: contact.email,
          hasEmail: true,
        });
      }
    } catch (error) {
      console.error("Error fetching worker user:", error);
      res.status(500).json({ message: "Failed to fetch worker user" });
    }
  });

  // POST /api/workers/:id/user - Create or update user linked to worker
  app.post("/api/workers/:id/user", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Validate request body with Zod
      const requestSchema = z.object({
        firstName: z.string().optional().nullable(),
        lastName: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
        optionalRoleIds: z.array(z.string()),
      });
      
      const validationResult = requestSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Invalid request body", 
          errors: validationResult.error.errors 
        });
      }
      
      const { firstName, lastName, isActive, optionalRoleIds } = validationResult.data;
      
      // Get worker
      const worker = await storage.workers.getWorker(id);
      if (!worker) {
        return res.status(404).json({ message: "Worker not found" });
      }
      
      // Get worker's contact
      const contact = await storage.contacts.getContact(worker.contactId);
      if (!contact) {
        return res.status(404).json({ message: "Worker contact not found" });
      }
      
      // Check if contact has an email
      if (!contact.email) {
        return res.status(400).json({ 
          message: "Worker must have an email address to create a user account"
        });
      }
      
      const email = contact.email;
      
      // Get worker user settings - both required and optional roles
      const requiredVariable = await storage.variables.getByName('worker_user_roles_required');
      const optionalVariable = await storage.variables.getByName('worker_user_roles_optional');
      
      const requiredRoleIds: string[] = (Array.isArray(requiredVariable?.value) ? requiredVariable.value : []) as string[];
      const allowedOptionalRoleIds: string[] = (Array.isArray(optionalVariable?.value) ? optionalVariable.value : []) as string[];
      
      // Validate that client-provided optional roles are actually in the allowed optional roles
      const invalidRoleIds = optionalRoleIds.filter(roleId => !allowedOptionalRoleIds.includes(roleId));
      if (invalidRoleIds.length > 0) {
        return res.status(400).json({ 
          message: "Invalid optional role IDs provided",
          invalidRoleIds
        });
      }
      
      // Check if user exists
      let user = await storage.users.getUserByEmail(email);
      
      if (!user) {
        // Create new user
        user = await storage.users.createUser({
          email,
          firstName: firstName || null,
          lastName: lastName || null,
          isActive: isActive !== undefined ? isActive : true,
          accountStatus: 'active',
        });
      } else {
        // Update existing user
        user = await storage.users.updateUser(user.id, {
          firstName: firstName !== undefined ? firstName : user.firstName,
          lastName: lastName !== undefined ? lastName : user.lastName,
          isActive: isActive !== undefined ? isActive : user.isActive,
        });
        
        if (!user) {
          return res.status(500).json({ message: "Failed to update user" });
        }
      }
      
      // Get user's current roles
      const currentRoles = await storage.users.getUserRoles(user.id);
      const currentRoleIds = currentRoles.map(r => r.id);
      
      // Assign all required roles (idempotent)
      for (const roleId of requiredRoleIds) {
        if (!currentRoleIds.includes(roleId)) {
          await storage.users.assignRoleToUser({
            userId: user.id,
            roleId,
          });
        }
      }
      
      // Reconcile optional roles
      // Add new optional roles
      for (const roleId of optionalRoleIds) {
        if (!currentRoleIds.includes(roleId) && !requiredRoleIds.includes(roleId)) {
          await storage.users.assignRoleToUser({
            userId: user.id,
            roleId,
          });
        }
      }
      
      // Remove optional roles that are no longer selected
      const allDesiredRoleIds = [...requiredRoleIds, ...optionalRoleIds];
      for (const roleId of currentRoleIds) {
        // Only remove if it's an allowed optional role (not required, not a role outside our scope)
        if (allowedOptionalRoleIds.includes(roleId) && !allDesiredRoleIds.includes(roleId)) {
          await storage.users.unassignRoleFromUser(user.id, roleId);
        }
      }
      
      // Get updated roles
      const updatedRoles = await storage.users.getUserRoles(user.id);
      const updatedRoleIds = updatedRoles.map(r => r.id);
      
      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isActive: user.isActive,
          accountStatus: user.accountStatus,
        },
        userRoleIds: updatedRoleIds,
        requiredRoleIds,
        optionalRoleIds: allowedOptionalRoleIds,
        message: "User account saved successfully",
      });
    } catch (error) {
      console.error("Error saving worker user:", error);
      res.status(500).json({ message: "Failed to save worker user" });
    }
  });
}
