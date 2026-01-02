import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Employer User Settings Module
 * 
 * This module provides API endpoints for configuring employer user role requirements.
 * It manages two configuration variables:
 * - employer_user_roles_required: Array of role IDs that are required for employer users
 * - employer_user_roles_optional: Array of role IDs that are optional for employer users
 */
export function registerEmployerUserSettingsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  // GET /api/employer-user-settings - Get employer user role configuration
  app.get("/api/employer-user-settings", requireAccess('admin'), async (req, res) => {
    try {
      const requiredVariable = await storage.variables.getByName('employer_user_roles_required');
      const optionalVariable = await storage.variables.getByName('employer_user_roles_optional');
      
      res.json({
        required: requiredVariable?.value || [],
        optional: optionalVariable?.value || [],
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer user settings" });
    }
  });

  // PUT /api/employer-user-settings - Update employer user role configuration
  app.put("/api/employer-user-settings", requireAccess('admin'), async (req, res) => {
    try {
      const { required, optional } = req.body;

      if (!Array.isArray(required) || !Array.isArray(optional)) {
        return res.status(400).json({ message: "required and optional must be arrays" });
      }

      // Validate that all provided role IDs exist
      const allRoles = await storage.users.getAllRoles();
      const roleIds = allRoles.map(r => r.id);
      
      const invalidRequiredRoles = required.filter((roleId: string) => !roleIds.includes(roleId));
      const invalidOptionalRoles = optional.filter((roleId: string) => !roleIds.includes(roleId));
      
      if (invalidRequiredRoles.length > 0 || invalidOptionalRoles.length > 0) {
        return res.status(400).json({ 
          message: "Invalid role IDs provided",
          invalidRequiredRoles,
          invalidOptionalRoles
        });
      }

      // Update or create required roles variable
      const existingRequired = await storage.variables.getByName('employer_user_roles_required');
      if (existingRequired) {
        await storage.variables.update(existingRequired.id, {
          name: 'employer_user_roles_required',
          value: required
        });
      } else {
        await storage.variables.create({
          name: 'employer_user_roles_required',
          value: required
        });
      }

      // Update or create optional roles variable
      const existingOptional = await storage.variables.getByName('employer_user_roles_optional');
      if (existingOptional) {
        await storage.variables.update(existingOptional.id, {
          name: 'employer_user_roles_optional',
          value: optional
        });
      } else {
        await storage.variables.create({
          name: 'employer_user_roles_optional',
          value: optional
        });
      }

      res.json({
        required,
        optional,
        message: 'Employer user settings updated successfully',
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update employer user settings" });
    }
  });
}
