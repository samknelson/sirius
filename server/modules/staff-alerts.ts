import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
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
    requireAccess('admin'),
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
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { context } = req.params;
        const variableName = `${VARIABLE_PREFIX}${context}`;
        
        const variable = await storage.variables.getByName(variableName);
        if (!variable) {
          const emptyConfig: StaffAlertConfig = { recipients: [] };
          return res.json({ config: emptyConfig, warnings: [] });
        }
        
        let config: StaffAlertConfig;
        try {
          config = staffAlertConfigSchema.parse(variable.value);
        } catch (parseError) {
          const emptyConfig: StaffAlertConfig = { recipients: [] };
          return res.json({ config: emptyConfig, warnings: [] });
        }
        
        // Check for missing contacts
        const warnings: Array<{ userId: string; email: string; message: string }> = [];
        if (config.recipients.length > 0) {
          const authorizedUsers = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
          const authorizedUsersMap = new Map(authorizedUsers.map(u => [u.id, u]));
          
          for (const recipient of config.recipients) {
            const user = authorizedUsersMap.get(recipient.userId);
            if (user && user.email) {
              const contact = await storage.contacts.getContactByEmail(user.email);
              if (!contact) {
                warnings.push({
                  userId: recipient.userId,
                  email: user.email,
                  message: `No contact record found with email "${user.email}". Alerts will fail for this user until a contact is created.`,
                });
              }
            } else if (user && !user.email) {
              warnings.push({
                userId: recipient.userId,
                email: '',
                message: `User has no email address. Alerts will fail for this user.`,
              });
            }
          }
        }
        
        res.json({ config, warnings });
      } catch (error: any) {
        console.error("Error fetching staff alert config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/staff-alerts/:context",
    requireAuth,
    requireAccess('admin'),
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
        const warnings: Array<{ userId: string; email: string; message: string }> = [];
        
        if (config.recipients.length > 0) {
          const authorizedUsers = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
          const authorizedUserIds = new Set(authorizedUsers.map(u => u.id));
          const authorizedUsersMap = new Map(authorizedUsers.map(u => [u.id, u]));
          
          const invalidUserIds = config.recipients
            .filter(r => !authorizedUserIds.has(r.userId))
            .map(r => r.userId);
          
          if (invalidUserIds.length > 0) {
            return res.status(400).json({
              message: "Invalid user IDs in configuration",
              invalidUserIds,
            });
          }
          
          // Check if each recipient has a matching contact record
          for (const recipient of config.recipients) {
            const user = authorizedUsersMap.get(recipient.userId);
            if (user && user.email) {
              const contact = await storage.contacts.getContactByEmail(user.email);
              if (!contact) {
                warnings.push({
                  userId: recipient.userId,
                  email: user.email,
                  message: `No contact record found with email "${user.email}". Alerts will fail for this user until a contact is created.`,
                });
              }
            } else if (user && !user.email) {
              warnings.push({
                userId: recipient.userId,
                email: '',
                message: `User has no email address. Alerts will fail for this user.`,
              });
            }
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
        
        res.json({ 
          message: warnings.length > 0 
            ? "Configuration saved with warnings" 
            : "Configuration saved", 
          config,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      } catch (error: any) {
        console.error("Error saving staff alert config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );
}
