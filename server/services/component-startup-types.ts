import type { Express, RequestHandler } from "express";
import type { requireAccess } from "./access-policy-evaluator";
import type { ResolvedServiceRoles } from "./service-roles";

export interface ComponentStartup {
  register?: () => void | Promise<void>;
  registerRoutes?: (
    app: Express,
    requireAuth: RequestHandler,
    requirePermission: (key: string) => RequestHandler,
    access: typeof requireAccess,
  ) => void;
  start?: (context: { roles: ResolvedServiceRoles }) => Promise<void>;
}
