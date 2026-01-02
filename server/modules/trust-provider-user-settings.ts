import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Trust Provider User Settings Module
 * 
 * This module provides API endpoints for configuring trust provider user role requirements.
 * It manages two configuration variables:
 * - trust_provider_user_roles_required: Array of role IDs that are required for trust provider users
 * - trust_provider_user_roles_optional: Array of role IDs that are optional for trust provider users
 */
export function registerTrustProviderUserSettingsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  // GET /api/trust-provider-user-settings - Get trust provider user role configuration
  app.get("/api/trust-provider-user-settings", requireAccess('admin'), async (req, res) => {
    try {
      const requiredVariable = await storage.variables.getByName('trust_provider_user_roles_required');
      const optionalVariable = await storage.variables.getByName('trust_provider_user_roles_optional');
      
      res.json({
        required: requiredVariable?.value || [],
        optional: optionalVariable?.value || [],
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trust provider user settings" });
    }
  });

  // PUT /api/trust-provider-user-settings - Update trust provider user role configuration
  app.put("/api/trust-provider-user-settings", requireAccess('admin'), async (req, res) => {
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
      const existingRequired = await storage.variables.getByName('trust_provider_user_roles_required');
      if (existingRequired) {
        await storage.variables.update(existingRequired.id, {
          name: 'trust_provider_user_roles_required',
          value: required
        });
      } else {
        await storage.variables.create({
          name: 'trust_provider_user_roles_required',
          value: required
        });
      }

      // Update or create optional roles variable
      const existingOptional = await storage.variables.getByName('trust_provider_user_roles_optional');
      if (existingOptional) {
        await storage.variables.update(existingOptional.id, {
          name: 'trust_provider_user_roles_optional',
          value: optional
        });
      } else {
        await storage.variables.create({
          name: 'trust_provider_user_roles_optional',
          value: optional
        });
      }

      res.json({
        required,
        optional,
        message: 'Trust provider user settings updated successfully',
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update trust provider user settings" });
    }
  });
}
