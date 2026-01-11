import type { Express, Request, Response } from "express";
import { getOptionsType, getAllOptionsTypes } from "./options-registry";
import { requireAccess } from "../services/access-policy-evaluator";

export function registerConsolidatedOptionsRoutes(app: Express) {
  app.get("/api/options", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      res.json({ types: getAllOptionsTypes() });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options types" });
    }
  });

  app.get("/api/options/:type", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const items = await config.getAll();
      res.json(items);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch options" });
    }
  });

  app.get("/api/options/:type/:id", requireAccess('authenticated'), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const item = await config.get(id);
      
      if (!item) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.json(item);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch option" });
    }
  });

  app.post("/api/options/:type", requireAccess('admin'), async (req: Request, res: Response) => {
    try {
      const { type } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      for (const field of config.requiredFields) {
        if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
          return res.status(400).json({ message: `${field} is required` });
        }
      }
      
      const data: Record<string, any> = {};
      for (const field of config.requiredFields) {
        data[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
      }
      for (const field of config.optionalFields) {
        if (req.body[field] !== undefined) {
          data[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
        }
      }
      
      const item = await config.create(data);
      res.status(201).json(item);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "An item with this value already exists" });
      }
      res.status(500).json({ message: `Failed to create option` });
    }
  });

  app.put("/api/options/:type/:id", requireAccess('admin'), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const updates: Record<string, any> = {};
      const allFields = [...config.requiredFields, ...config.optionalFields];
      
      for (const field of allFields) {
        if (req.body[field] !== undefined) {
          if (config.requiredFields.includes(field) && (req.body[field] === null || req.body[field] === '')) {
            return res.status(400).json({ message: `${field} cannot be empty` });
          }
          updates[field] = typeof req.body[field] === 'string' ? req.body[field].trim() : req.body[field];
        }
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      
      const item = await config.update(id, updates);
      
      if (!item) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.json(item);
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(400).json({ message: "An item with this value already exists" });
      }
      res.status(500).json({ message: `Failed to update option` });
    }
  });

  app.delete("/api/options/:type/:id", requireAccess('admin'), async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const config = getOptionsType(type);
      
      if (!config) {
        return res.status(404).json({ message: `Unknown options type: ${type}` });
      }
      
      const deleted = await config.delete(id);
      
      if (!deleted) {
        return res.status(404).json({ message: `${config.name} not found` });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: `Failed to delete option` });
    }
  });
}
