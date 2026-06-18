import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Admin-only metadata endpoints backing the event-notifier admin UI. Currently
 * exposes the staff/admin user list the "staff-recipients" config field renders
 * a picker from (used by staff-mode notifiers such as `trust-wmb-scan`).
 */
export function registerEventNotifierMetaRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/event-notifier/staff-users",
    requireAuth,
    requireAccess("admin"),
    async (_req, res) => {
      try {
        const users = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
        const formatted = users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email,
        }));
        res.json(formatted);
      } catch (error: any) {
        console.error("Error fetching staff users:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to fetch staff users" });
      }
    }
  );
}
