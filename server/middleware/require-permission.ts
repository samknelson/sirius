import type { NextFunction, Request, Response } from "express";
import { getEffectiveUser } from "../modules/masquerade";
import { storage } from "../storage";

function permissionMiddleware(permissionKey: string, allowAdminBypass: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;
    if (!user || !user.claims) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const session = req.session as any;
    const { dbUser } = await getEffectiveUser(session, user);
    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }

    const isAdmin = allowAdminBypass
      && await storage.users.userHasPermission(dbUser.id, "admin");
    const hasPermission = isAdmin
      || await storage.users.userHasPermission(dbUser.id, permissionKey);
    if (!hasPermission) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }

    next();
  };
}

export function requirePermission(permissionKey: string) {
  return permissionMiddleware(permissionKey, false);
}

export function requirePermissionOrAdmin(permissionKey: string) {
  return permissionMiddleware(permissionKey, true);
}
