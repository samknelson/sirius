import type { Express } from "express";
import { requireAccess } from "../../services/access-policy-evaluator";
import { databaseSourceInfo } from "../../storage/db";

/**
 * Read-only admin visibility into which database this deployment is connected
 * to (Task #178): host, database name, which env var supplied the connection
 * string (EXTERNAL_DATABASE_URL vs DATABASE_URL), the active driver
 * (neon serverless vs node-postgres), and — for Neon — the endpoint ID so an
 * admin can match the deployment against the Neon console.
 *
 * The info is computed once at boot in server/storage/db.ts from the resolved
 * connection string; credentials are never included. This route is strictly
 * read-only and admin-gated like the other system routes.
 */
export function registerSystemInfoRoutes(app: Express) {
  app.get("/api/admin/system-info", requireAccess("admin"), (_req, res) => {
    res.json({ database: databaseSourceInfo });
  });
}
