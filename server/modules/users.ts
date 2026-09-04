import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { RoleInUseError, UserInUseError } from "../storage/users";
import { getEffectiveUser } from "./masquerade";
import { 
  createUserSchema,
  insertRoleSchema,
  assignRoleSchema,
  assignPermissionSchema
} from "@shared/schema";
import { userTimeZoneInputSchema } from "@shared/utils/timezone";
import { buildTimeZoneContext, getTimeZonePolicy } from "./system/timezone";
import { requireAccess, clearAccessCache } from "../services/access-policy-evaluator";
import { checkClerkConflict, provisionClerkAccount } from "../services/clerk-provisioning";
import {
  credentialUserInOkta,
  OktaCredentialingError,
} from "../services/okta-credentialing";
import { isOktaProviderActive, type OktaPersona } from "../auth/okta-admin";

async function derivePersonaForUser(userId: string): Promise<OktaPersona> {
  const workerId = await storage.authIdentities.getWorkerIdForUser(userId);
  if (workerId) return "member";
  const isEmployerContact = await storage.employerContacts.isLinkedToEmployerContact(userId);
  if (isEmployerContact) return "employer";
  return "staff";
}

// Type for middleware functions that we'll accept from the main routes
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerUserRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Self-service time zone.
  //
  // Registered before the /api/users/:userId/* routes below so the literal
  // "me" segment can never be captured as a user id.
  //
  // These act on the EFFECTIVE user: while masquerading, the masqueraded
  // person is the actor everywhere in this app, and their display preference
  // is what is being read and written. That is the established convention, not
  // an oversight.

  // GET /api/users/me/timezone - the caller's own zone plus the two facts
  // needed to interpret it (the system zone and whether policy honours a
  // personal one). Returned together because a client that has one without
  // the others cannot decide anything.
  app.get("/api/users/me/timezone", requireAuth, async (req, res) => {
    try {
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) return res.status(404).json({ message: "User not found" });
      res.json(await buildTimeZoneContext(dbUser.timezone));
    } catch (error) {
      console.error("Failed to fetch time zone settings:", error);
      res.status(500).json({ message: "Failed to fetch time zone settings" });
    }
  });

  // PUT /api/users/me/timezone - set or clear the caller's own zone.
  //
  // Refused outright when site policy says everyone uses site time: storing a
  // preference that the resolver is going to ignore would leave the person
  // with a saved setting that does nothing, and would quietly take effect
  // later if an admin ever flipped the policy back.
  app.put("/api/users/me/timezone", requireAuth, async (req, res) => {
    try {
      const { dbUser } = await getEffectiveUser(req.session as any, req.user as any);
      if (!dbUser) return res.status(404).json({ message: "User not found" });

      const policy = await getTimeZonePolicy();
      if (!policy.allowUserTimezones) {
        return res.status(403).json({
          message:
            "This site displays all dates and times in the site's time zone. Personal time zones are turned off.",
        });
      }

      const parsed = userTimeZoneInputSchema.safeParse((req.body ?? {}).timezone);
      if (!parsed.success) {
        return res.status(400).json({
          message: parsed.error.errors[0]?.message ?? "Invalid time zone",
        });
      }

      await storage.users.updateUser(dbUser.id, { timezone: parsed.data });
      res.json(await buildTimeZoneContext(parsed.data));
    } catch (error) {
      console.error("Failed to save time zone:", error);
      res.status(500).json({ message: "Failed to save time zone" });
    }
  });

  // Admin routes for user management
  
  // GET /api/admin/users/search - Search users by email (staff+)
  // Relaxed from admin to staff so staff can pick users to assign on
  // grievance roles. The response is already shaped to safe fields only
  // (id, email, names, status). An empty `q` returns the first batch of users
  // (prefill / dropdown mode); a non-empty `q` filters by email substring.
  // The optional `limit` lets callers request one extra row to detect
  // truncation. MIGRATED to new access control system
  app.get("/api/admin/users/search", requireAccess('staff'), async (req, res) => {
    try {
      const query = (req.query.q as string || '').toLowerCase();

      // Optional `roleIds` filter (CSV) restricts results to users holding
      // at least one of the given system roles (OR semantics). Used by the
      // grievance People picker to only surface users eligible for the
      // selected grievance role.
      const roleIdsRaw = req.query.roleIds;
      let roleIds: string[] | undefined;
      if (typeof roleIdsRaw === 'string' && roleIdsRaw.trim().length > 0) {
        roleIds = roleIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      // Optional `limit` lets the picker request one more than it displays so
      // it can tell whether the result set is truncated ("type to search").
      // An empty query returns the first batch (prefill / dropdown mode).
      let limit = 20;
      const limitRaw = req.query.limit;
      if (typeof limitRaw === 'string') {
        const n = parseInt(limitRaw, 10);
        if (Number.isFinite(n) && n > 0) {
          limit = Math.min(n, 50);
        }
      }

      const matchedUsers = await storage.users.searchUsers(query, roleIds, limit);
      
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

      const clerkCheck = await checkClerkConflict(userData.email);
      if (clerkCheck.conflict) {
        return res.status(409).json({ 
          message: "This email is already associated with a Clerk account linked to another user." 
        });
      }

      const user = await storage.users.createUser(userData);

      const clerkResult = await provisionClerkAccount({
        userId: user.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        existingClerkUserId: clerkCheck.existingClerkUserId,
      });

      const updatedUser = await storage.users.getUser(user.id);

      const responseData: Record<string, unknown> = { 
        id: updatedUser?.id || user.id, 
        email: updatedUser?.email || user.email,
        firstName: updatedUser?.firstName || user.firstName,
        lastName: updatedUser?.lastName || user.lastName,
        accountStatus: updatedUser?.accountStatus || user.accountStatus,
        isActive: updatedUser?.isActive ?? user.isActive, 
        createdAt: updatedUser?.createdAt || user.createdAt 
      };
      if (clerkResult.warning) {
        responseData.clerkWarning = clerkResult.warning;
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

  // POST /api/admin/users/:id/credential-okta - Admin-driven Okta credentialing for a Sirius user
  app.post("/api/admin/users/:id/credential-okta", requireAccess('admin'), async (req, res) => {
    try {
      if (!isOktaProviderActive()) {
        return res.status(400).json({
          message: "Okta is not the active authentication provider for this tenant.",
        });
      }
      const { id } = req.params;
      const user = await storage.users.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!user.email) {
        return res.status(400).json({
          message: "User must have an email address before credentialing in Okta.",
        });
      }
      const persona = await derivePersonaForUser(user.id);
      const result = await credentialUserInOkta({
        userId: user.id,
        persona,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      res.json({ ...result, persona });
    } catch (error) {
      if (error instanceof OktaCredentialingError) {
        return res.status(error.status).json({ message: error.message });
      }
      console.error("Error credentialing user in Okta:", error);
      res.status(500).json({ message: "Failed to credential user in Okta" });
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

  // DELETE /api/admin/users/:id - Permanently delete a user account (admin only)
  app.delete("/api/admin/users/:id", requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;

      // Neither the signed-in admin nor the user they are masquerading as may
      // be deleted from this session.
      const sessionUser = req.user as any;
      const { dbUser, originalUser } = await getEffectiveUser((req as any).session ?? {}, sessionUser);
      if (id === dbUser?.id || id === originalUser?.id) {
        return res.status(400).json({ message: "You cannot delete the account you are currently signed in as." });
      }

      const user = await storage.users.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const deleted = await storage.users.deleteUserAccount(id);
      if (!deleted) {
        return res.status(404).json({ message: "User not found" });
      }

      clearAccessCache();
      res.json({ success: true });
    } catch (error) {
      if (error instanceof UserInUseError) {
        return res.status(409).json({ message: error.message });
      }
      console.error("Failed to delete user:", error);
      res.status(500).json({ message: "Failed to delete user" });
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
      // Storage-layer replacement for the old FK RESTRICT: a role still
      // referenced by a dashboard config's roles array cannot be deleted.
      if (error instanceof RoleInUseError) {
        return res.status(409).json({ message: error.message });
      }
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
      clearAccessCache();
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