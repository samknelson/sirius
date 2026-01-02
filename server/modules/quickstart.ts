import type { Express } from "express";
import { z } from "zod";
import { exportQuickstart, importQuickstart, listQuickstarts, deleteQuickstart } from "../services/quickstart";
import { isAuthenticated } from "../replitAuth";
import { requireAccess } from "../accessControl";

const exportSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, "Name must contain only letters, numbers, hyphens, and underscores"),
});

const importSchema = z.object({
  name: z.string().min(1),
});

const deleteSchema = z.object({
  name: z.string().min(1),
});

export function registerQuickstartRoutes(app: Express) {
  // List all quickstart files
  app.get(
    "/api/quickstarts",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const quickstarts = await listQuickstarts();
        res.json(quickstarts);
      } catch (error: any) {
        console.error("Error listing quickstarts:", error);
        res.status(500).json({ message: error.message || "Failed to list quickstarts" });
      }
    }
  );

  // Export current database to a quickstart file
  app.post(
    "/api/quickstarts/export",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { name } = exportSchema.parse(req.body);
        const metadata = await exportQuickstart(name);
        res.json(metadata);
      } catch (error: any) {
        console.error("Error exporting quickstart:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to export quickstart" });
        }
      }
    }
  );

  // Import a quickstart file
  app.post(
    "/api/quickstarts/import",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { name } = importSchema.parse(req.body);
        const metadata = await importQuickstart(name);
        res.json(metadata);
      } catch (error: any) {
        console.error("Error importing quickstart:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to import quickstart" });
        }
      }
    }
  );

  // Delete a quickstart file
  app.delete(
    "/api/quickstarts/:name",
    isAuthenticated,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const { name } = deleteSchema.parse({ name: req.params.name });
        await deleteQuickstart(name);
        res.status(204).send();
      } catch (error: any) {
        console.error("Error deleting quickstart:", error);
        if (error.name === 'ZodError') {
          res.status(400).json({ message: "Invalid request data", errors: error.errors });
        } else {
          res.status(500).json({ message: error.message || "Failed to delete quickstart" });
        }
      }
    }
  );
}
