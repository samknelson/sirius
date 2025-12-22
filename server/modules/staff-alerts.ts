import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { policies } from "../policies";
import { staffAlertConfigSchema, type StaffAlertConfig } from "@shared/staffAlerts";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const VARIABLE_PREFIX = "staff_alert:";

export function registerStaffAlertRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/staff-alerts/users",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const users = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
        const formattedUsers = users.map(user => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.firstName && user.lastName 
            ? `${user.firstName} ${user.lastName}` 
            : user.email,
        }));
        res.json(formattedUsers);
      } catch (error: any) {
        console.error("Error fetching staff users:", error);
        res.status(500).json({ message: error.message || "Failed to fetch staff users" });
      }
    }
  );

  app.get(
    "/api/staff-alerts/:context",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { context } = req.params;
        const variableName = `${VARIABLE_PREFIX}${context}`;
        
        const variable = await storage.variables.getByName(variableName);
        if (!variable) {
          const emptyConfig: StaffAlertConfig = { recipients: [] };
          return res.json(emptyConfig);
        }
        
        try {
          const validated = staffAlertConfigSchema.parse(variable.value);
          res.json(validated);
        } catch (parseError) {
          const emptyConfig: StaffAlertConfig = { recipients: [] };
          res.json(emptyConfig);
        }
      } catch (error: any) {
        console.error("Error fetching staff alert config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/staff-alerts/:context",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const { context } = req.params;
        const variableName = `${VARIABLE_PREFIX}${context}`;
        
        const parseResult = staffAlertConfigSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({ 
            message: "Invalid configuration format",
            errors: parseResult.error.errors 
          });
        }
        
        const config = parseResult.data;
        
        // Validate that all user IDs are authorized staff/admin users
        if (config.recipients.length > 0) {
          const authorizedUsers = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
          const authorizedUserIds = new Set(authorizedUsers.map(u => u.id));
          
          const invalidUserIds = config.recipients
            .filter(r => !authorizedUserIds.has(r.userId))
            .map(r => r.userId);
          
          if (invalidUserIds.length > 0) {
            return res.status(400).json({
              message: "Invalid user IDs in configuration",
              invalidUserIds,
            });
          }
        }
        
        const existingVariable = await storage.variables.getByName(variableName);
        
        if (existingVariable) {
          await storage.variables.update(existingVariable.id, { value: config });
        } else {
          await storage.variables.create({
            name: variableName,
            value: config,
          });
        }
        
        res.json({ message: "Configuration saved", config });
      } catch (error: any) {
        console.error("Error saving staff alert config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );
}
