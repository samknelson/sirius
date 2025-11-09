import type { Express } from "express";
import { db } from "../db";
import { winstonLogs } from "@shared/schema";
import { desc, eq, and, sql, or, like } from "drizzle-orm";
import { z } from "zod";
import { requireAccess } from '../accessControl';
import * as policies from '../policies';

const logsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default("1"),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default("50"),
  module: z.string().optional(),
  operation: z.string().optional(),
  search: z.string().optional(),
});

export function registerLogRoutes(app: Express) {
  app.get("/api/logs", requireAccess(policies.logsView), async (req, res) => {
    try {
      const params = logsQuerySchema.parse(req.query);
      const page = Math.max(1, params.page);
      const limit = Math.min(100, Math.max(1, params.limit));
      const offset = (page - 1) * limit;

      // Build filter conditions
      const conditions = [];
      if (params.module) {
        conditions.push(eq(winstonLogs.module, params.module));
      }
      if (params.operation) {
        conditions.push(eq(winstonLogs.operation, params.operation));
      }
      if (params.search) {
        conditions.push(
          or(
            like(winstonLogs.description, `%${params.search}%`),
            like(winstonLogs.message, `%${params.search}%`),
            like(winstonLogs.entityId, `%${params.search}%`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(winstonLogs)
        .where(whereClause);

      // Get logs
      const logs = await db
        .select()
        .from(winstonLogs)
        .where(whereClause)
        .orderBy(desc(winstonLogs.timestamp), desc(winstonLogs.id))
        .limit(limit)
        .offset(offset);

      res.json({
        logs,
        pagination: {
          page,
          limit,
          total: count,
          totalPages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ 
        error: "Failed to fetch logs",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get unique modules and operations for filter dropdowns
  app.get("/api/logs/filters", requireAccess(policies.logsView), async (req, res) => {
    try {
      const [modules, operations] = await Promise.all([
        db.selectDistinct({ module: winstonLogs.module })
          .from(winstonLogs)
          .where(sql`${winstonLogs.module} IS NOT NULL`)
          .orderBy(winstonLogs.module),
        db.selectDistinct({ operation: winstonLogs.operation })
          .from(winstonLogs)
          .where(sql`${winstonLogs.operation} IS NOT NULL`)
          .orderBy(winstonLogs.operation),
      ]);

      res.json({
        modules: modules.map(m => m.module).filter(Boolean),
        operations: operations.map(o => o.operation).filter(Boolean),
      });
    } catch (error) {
      console.error("Error fetching log filters:", error);
      res.status(500).json({ 
        error: "Failed to fetch log filters",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get a single log by ID
  app.get("/api/logs/:id", requireAccess(policies.logsView), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
      }

      const [log] = await db
        .select()
        .from(winstonLogs)
        .where(eq(winstonLogs.id, id))
        .limit(1);

      if (!log) {
        return res.status(404).json({ error: "Log not found" });
      }

      res.json(log);
    } catch (error) {
      console.error("Error fetching log:", error);
      res.status(500).json({ 
        error: "Failed to fetch log",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}
